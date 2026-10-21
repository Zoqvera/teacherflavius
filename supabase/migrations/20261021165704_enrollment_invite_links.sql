-- Invitation-based enrollment plans. Existing access codes remain valid during migration.
-- Prices, frequency and class type are persisted server-side; the URL never sets them.
create table if not exists private.enrollment_invite_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  seed_key text unique,
  label text not null check (char_length(btrim(label)) between 3 and 80),
  monthly_fee numeric(10, 2) not null check (monthly_fee > 0),
  classes_per_month smallint not null check (classes_per_month between 1 and 31),
  class_mode text not null check (class_mode in ('group', 'individual')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table private.enrollment_invite_links enable row level security;
revoke all on table private.enrollment_invite_links from public, anon, authenticated;
grant all on table private.enrollment_invite_links to service_role;

insert into private.enrollment_invite_links
  (seed_key, label, monthly_fee, classes_per_month, class_mode)
values
  ('grupo-semanal-50', 'Grupo · 1 aula por semana', 50, 4, 'group'),
  ('individual-semanal-250', 'Individual · 1 aula por semana', 250, 4, 'individual')
on conflict (seed_key) do nothing;

alter table private.student_enrollment_access
  add column if not exists invite_link_id uuid references private.enrollment_invite_links(id),
  add column if not exists authorized_class_mode text
    check (authorized_class_mode is null or authorized_class_mode in ('group', 'individual'));

-- This is the only interface exposing invitation tokens, restricted to the teacher.
create or replace function public.manage_enrollment_invite_links(
  target_action text,
  target_id uuid default null,
  target_label text default null,
  target_monthly_fee numeric default null,
  target_classes_per_month integer default null,
  target_class_mode text default null,
  target_active boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  action_name text := lower(btrim(coalesce(target_action, '')));
  clean_label text := btrim(coalesce(target_label, ''));
  clean_mode text := lower(btrim(coalesce(target_class_mode, '')));
  changed_id uuid;
begin
  if auth.uid() is null or not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Apenas o professor pode administrar links de matrícula.'
      using errcode = '42501';
  end if;

  if action_name = 'list' then
    return jsonb_build_object(
      'ok', true,
      'links', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', link.id,
            'token', link.token,
            'label', link.label,
            'monthly_fee', link.monthly_fee,
            'classes_per_month', link.classes_per_month,
            'class_mode', link.class_mode,
            'active', link.active
          ) order by link.created_at, link.id
        )
        from private.enrollment_invite_links link
      ), '[]'::jsonb)
    );
  end if;

  if action_name = 'create' then
    if char_length(clean_label) not between 3 and 80
       or target_monthly_fee is null
       or target_monthly_fee <= 0
       or target_monthly_fee > 10000
       or target_classes_per_month not between 1 and 31
       or clean_mode not in ('group', 'individual')
    then
      raise exception 'Informe nome, valor, quantidade de aulas e modalidade válidos.';
    end if;

    insert into private.enrollment_invite_links
      (label, monthly_fee, classes_per_month, class_mode)
    values
      (clean_label, round(target_monthly_fee, 2), target_classes_per_month, clean_mode)
    returning id into changed_id;
  elsif action_name = 'set_active' then
    if target_id is null or target_active is null then
      raise exception 'Informe o link e seu novo estado.';
    end if;

    update private.enrollment_invite_links
    set active = target_active, updated_at = now()
    where id = target_id
    returning id into changed_id;
  elsif action_name = 'rotate' then
    if target_id is null then
      raise exception 'Selecione o link a renovar.';
    end if;

    update private.enrollment_invite_links
    set token = encode(extensions.gen_random_bytes(24), 'hex'), updated_at = now()
    where id = target_id
    returning id into changed_id;
  else
    raise exception 'Ação de gerenciamento inválida.';
  end if;

  if changed_id is null then
    raise exception 'Link de matrícula não encontrado.';
  end if;

  return jsonb_build_object('ok', true, 'id', changed_id);
end;
$function$;
revoke all on function public.manage_enrollment_invite_links(text, uuid, text, numeric, integer, text, boolean)
  from public, anon;
grant execute on function public.manage_enrollment_invite_links(text, uuid, text, numeric, integer, text, boolean)
  to authenticated, service_role;

-- Authorize only an authenticated Google student. Links cannot change a previously
-- authorized plan or an already-enrolled student. Invalid tokens share code throttling.
create or replace function public.authorize_my_enrollment_link(target_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  requester_id uuid := auth.uid();
  provider_name text;
  selected_link private.enrollment_invite_links%rowtype;
  access_row private.student_enrollment_access%rowtype;
  attempts integer;
  token_value text := lower(btrim(coalesce(target_token, '')));
begin
  if requester_id is null then
    raise exception 'Entre com sua conta Google para continuar.'
      using errcode = '42501';
  end if;

  select coalesce(account.raw_app_meta_data ->> 'provider', '')
  into provider_name
  from auth.users account
  where account.id = requester_id;

  if provider_name <> 'google' and not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Use sua conta Google para abrir o link de matrícula.'
      using errcode = '42501';
  end if;

  if exists (
    select 1 from public.profiles profile
    where profile.id = requester_id
      and (coalesce(profile.enrolled, false)
           or coalesce(profile.profile_completed, false)
           or coalesce(profile.archived, false))
  ) then
    raise exception 'Esta conta já possui uma matrícula. O link não altera matrículas existentes.'
      using errcode = '42501';
  end if;

  insert into private.student_enrollment_access (user_id)
  values (requester_id)
  on conflict (user_id) do nothing;

  select access.* into access_row
  from private.student_enrollment_access access
  where access.user_id = requester_id
  for update;

  if access_row.invite_link_id is not null
     and access_row.authorized_at is not null
  then
    select link.* into selected_link
    from private.enrollment_invite_links link
    where link.id = access_row.invite_link_id;

    -- Already-authorized students keep their original terms, even after a link rotates.
    return jsonb_build_object('ok', true, 'already_authorized', true);
  end if;

  if access_row.authorized_at is not null then
    raise exception 'Esta matrícula já foi autorizada com um código de acesso.';
  end if;

  if access_row.locked_until is not null and access_row.locked_until > now() then
    return jsonb_build_object('ok', false, 'error',
      'Muitas tentativas. Tente novamente em 15 minutos.');
  end if;

  if length(token_value) = 48 and token_value ~ '^[0-9a-f]+$' then
    select link.* into selected_link
    from private.enrollment_invite_links link
    where link.token = token_value and link.active = true;
  end if;

  if selected_link.id is null then
    attempts := case
      when access_row.locked_until is not null and access_row.locked_until <= now() then 1
      else access_row.failed_attempts + 1
    end;

    update private.student_enrollment_access
    set failed_attempts = case when attempts >= 5 then 0 else attempts end,
        locked_until = case when attempts >= 5 then now() + interval '15 minutes' else null end,
        updated_at = now()
    where user_id = requester_id;

    return jsonb_build_object('ok', false, 'error',
      'Link de matrícula inválido ou desativado.');
  end if;

  update private.student_enrollment_access
  set authorized_at = now(),
      monthly_fee = selected_link.monthly_fee,
      classes_per_month = selected_link.classes_per_month,
      authorized_class_mode = selected_link.class_mode,
      invite_link_id = selected_link.id,
      failed_attempts = 0,
      locked_until = null,
      updated_at = now()
  where user_id = requester_id;

  return jsonb_build_object('ok', true, 'already_authorized', false);
end;
$function$;
revoke all on function public.authorize_my_enrollment_link(text) from public, anon;
grant execute on function public.authorize_my_enrollment_link(text) to authenticated, service_role;

create or replace function public.get_my_authorized_enrollment_plan()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  requester_id uuid := auth.uid();
begin
  if requester_id is null then
    raise exception 'Faça login para consultar seu plano.' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_build_object(
      'monthly_fee', access.monthly_fee,
      'classes_per_month', access.classes_per_month,
      'class_mode', access.authorized_class_mode,
      'label', link.label
    )
    from private.student_enrollment_access access
    left join private.enrollment_invite_links link on link.id = access.invite_link_id
    where access.user_id = requester_id and access.authorized_at is not null
  ), '{}'::jsonb);
end;
$function$;
revoke all on function public.get_my_authorized_enrollment_plan() from public, anon;
grant execute on function public.get_my_authorized_enrollment_plan() to authenticated, service_role;

-- Preserve legacy code enrollments while locking invite enrollments to their
-- server-authorized modality.
create or replace function public.set_my_enrollment_class_mode(target_mode text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  profile_row public.profiles%rowtype;
  normalized_mode text := lower(btrim(coalesce(target_mode, '')));
  target_class_type text;
  server_mode text;
begin
  if caller_id is null then
    raise exception 'Faça login para informar o tipo de aula.' using errcode = '42501';
  end if;

  select profile.* into profile_row
  from public.profiles profile
  where profile.id = caller_id
  for update;

  if profile_row.id is null or coalesce(profile_row.archived, false) then
    raise exception 'Perfil de aluno ativo não encontrado.';
  end if;

  if coalesce(profile_row.enrolled, false)
     or coalesce(profile_row.profile_completed, false) then
    raise exception 'O tipo de aula só pode ser definido antes da conclusão da matrícula.';
  end if;

  select access.authorized_class_mode into server_mode
  from private.student_enrollment_access access
  where access.user_id = caller_id and access.authorized_at is not null;

  if not found then
    raise exception 'Valide o acesso à matrícula antes de continuar.'
      using errcode = '42501';
  end if;

  target_class_type := case normalized_mode
    when 'group' then 'QUINTETO'
    when 'individual' then 'INDIVIDUAL'
    else null
  end;

  if target_class_type is null or
     (server_mode is not null and server_mode <> normalized_mode) then
    raise exception 'O tipo de aula não corresponde ao plano autorizado.'
      using errcode = '42501';
  end if;

  update public.profiles set class_type = target_class_type where id = caller_id;

  return jsonb_build_object('ok', true, 'mode', normalized_mode, 'class_type', target_class_type);
end;
$function$;
revoke all on function public.set_my_enrollment_class_mode(text) from public, anon;
grant execute on function public.set_my_enrollment_class_mode(text) to authenticated, service_role;

-- Defense in depth: a direct profile write cannot activate a mismatched modality.
create or replace function private.enforce_link_enrollment_class_mode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  bound_mode text;
begin
  if coalesce(new.profile_completed, false)
     and not coalesce(old.profile_completed, false) then
    select access.authorized_class_mode into bound_mode
    from private.student_enrollment_access access
    where access.user_id = new.id and access.authorized_at is not null;

    if (bound_mode = 'group' and new.class_type is distinct from 'QUINTETO')
       or (bound_mode = 'individual' and new.class_type is distinct from 'INDIVIDUAL')
    then
      raise exception 'O tipo de aula não corresponde ao link de matrícula autorizado.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function private.enforce_link_enrollment_class_mode() from public, anon, authenticated;

drop trigger if exists zz_enforce_link_enrollment_class_mode on public.profiles;
create trigger zz_enforce_link_enrollment_class_mode
before update of profile_completed, class_type on public.profiles
for each row execute function private.enforce_link_enrollment_class_mode();

notify pgrst, 'reload schema';
