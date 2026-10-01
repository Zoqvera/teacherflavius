-- Recovery overlay for server-side enrollment access-code enforcement.
-- The secret value must be provisioned separately in Supabase Vault.

create table if not exists private.student_enrollment_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  authorized_at timestamptz,
  failed_attempts smallint not null default 0
    check (failed_attempts between 0 and 4),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table private.student_enrollment_access enable row level security;
revoke all on table private.student_enrollment_access from public, anon, authenticated;
grant select, insert, update, delete on table private.student_enrollment_access to service_role;

create or replace function public.has_my_enrollment_access()
returns boolean
language plpgsql
stable
security definer
set search_path = public, private, auth, pg_temp
as $function$
declare
  requester_id uuid := auth.uid();
begin
  if requester_id is null then
    return false;
  end if;

  if coalesce(public.is_teacher_admin(), false) then
    return true;
  end if;

  return exists (
    select 1
    from private.student_enrollment_access access
    where access.user_id = requester_id
      and access.authorized_at is not null
  );
end;
$function$;

revoke all on function public.has_my_enrollment_access() from public, anon;
grant execute on function public.has_my_enrollment_access() to authenticated, service_role;

create or replace function public.authorize_my_enrollment(target_access_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, auth, vault, pg_temp
as $function$
declare
  requester_id uuid := auth.uid();
  provider_name text;
  expected_code text;
  access_row private.student_enrollment_access%rowtype;
  next_failed_attempts integer;
  new_locked_until timestamptz;
begin
  if requester_id is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'authentication_required',
      'error', 'Sua sessão expirou. Entre novamente com Google.'
    );
  end if;

  select coalesce(u.raw_app_meta_data ->> 'provider', '')
  into provider_name
  from auth.users u
  where u.id = requester_id;

  if provider_name <> 'google'
     and not coalesce(public.is_teacher_admin(), false)
  then
    return jsonb_build_object(
      'ok', false,
      'code', 'google_required',
      'error', 'Entre com sua conta Google para validar o código de matrícula.'
    );
  end if;

  insert into private.student_enrollment_access (user_id)
  values (requester_id)
  on conflict (user_id) do nothing;

  select access.*
  into access_row
  from private.student_enrollment_access access
  where access.user_id = requester_id
  for update;

  if access_row.authorized_at is not null then
    return jsonb_build_object('ok', true, 'already_authorized', true);
  end if;

  if access_row.locked_until is not null
     and access_row.locked_until > now()
  then
    return jsonb_build_object(
      'ok', false,
      'code', 'temporarily_locked',
      'error', 'Muitas tentativas incorretas. Tente novamente em 15 minutos.'
    );
  end if;

  if access_row.locked_until is not null then
    update private.student_enrollment_access
    set failed_attempts = 0,
        locked_until = null,
        updated_at = now()
    where user_id = requester_id;

    access_row.failed_attempts := 0;
    access_row.locked_until := null;
  end if;

  select secret.decrypted_secret
  into expected_code
  from vault.decrypted_secrets secret
  where secret.name = 'teacherflavius_enrollment_access_code'
  limit 1;

  if expected_code is null then
    raise exception 'O código de matrícula não está configurado no servidor.';
  end if;

  if length(coalesce(target_access_code, '')) > 64
     or btrim(coalesce(target_access_code, '')) <> expected_code
  then
    next_failed_attempts := access_row.failed_attempts + 1;

    if next_failed_attempts >= 5 then
      new_locked_until := now() + interval '15 minutes';
      update private.student_enrollment_access
      set failed_attempts = 0,
          locked_until = new_locked_until,
          updated_at = now()
      where user_id = requester_id;

      return jsonb_build_object(
        'ok', false,
        'code', 'temporarily_locked',
        'error', 'Muitas tentativas incorretas. Tente novamente em 15 minutos.'
      );
    end if;

    update private.student_enrollment_access
    set failed_attempts = next_failed_attempts,
        updated_at = now()
    where user_id = requester_id;

    return jsonb_build_object(
      'ok', false,
      'code', 'invalid_code',
      'error', 'Código de matrícula inválido.'
    );
  end if;

  update private.student_enrollment_access
  set authorized_at = now(),
      failed_attempts = 0,
      locked_until = null,
      updated_at = now()
  where user_id = requester_id;

  return jsonb_build_object('ok', true, 'already_authorized', false);
end;
$function$;

revoke all on function public.authorize_my_enrollment(text) from public, anon;
grant execute on function public.authorize_my_enrollment(text) to authenticated, service_role;

create or replace function public.activate_completed_google_student_profile()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'private', 'auth', 'pg_temp'
as $function$
declare
  provider_name text;
  candidate_code text;
begin
  if tg_op = 'INSERT' then
    return new;
  end if;

  select u.raw_app_meta_data ->> 'provider'
    into provider_name
  from auth.users u
  where u.id = new.id;

  if coalesce(new.profile_completed, false) = true
     and coalesce(new.enrolled, false) = false
     and provider_name = 'google'
     and not exists (
       select 1
       from public.teacher_admins ta
       where ta.user_id = new.id
          or lower(ta.email) = lower(coalesce(new.email, ''))
     ) then
    if not exists (
      select 1
      from private.student_enrollment_access access
      where access.user_id = new.id
        and access.authorized_at is not null
    ) then
      raise exception 'Valide o código de matrícula antes de concluir o cadastro.'
        using errcode = '42501';
    end if;

    new.enrolled := true;

    if nullif(btrim(new.enrollment_code), '') is null then
      loop
        candidate_code := upper(substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 5));
        exit when not exists (
          select 1
          from public.profiles p
          where p.enrollment_code = candidate_code
            and p.id <> new.id
        );
      end loop;
      new.enrollment_code := candidate_code;
    end if;

    if new.exercise_schedule_start_date is null then
      new.exercise_schedule_start_date := (now() at time zone 'America/Sao_Paulo')::date;
    end if;
  end if;

  return new;
end;
$function$;
