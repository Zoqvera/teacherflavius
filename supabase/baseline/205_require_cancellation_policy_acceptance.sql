-- Recovery overlay for the mandatory student cancellation-policy acknowledgement.

create table if not exists private.student_policy_acceptances (
  student_id uuid not null references public.profiles(id) on delete cascade,
  policy_key text not null,
  policy_version text not null,
  accepted_at timestamptz not null default now(),
  primary key (student_id, policy_key, policy_version)
);

revoke all on table private.student_policy_acceptances
  from public, anon, authenticated;
grant select, insert, update, delete
  on table private.student_policy_acceptances
  to service_role;

create or replace function public.get_my_required_student_policy_notice()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  current_policy_key constant text := 'lesson-cancellation-makeup';
  current_policy_version constant text := '2026-10-05-v1';
  profile_row public.profiles%rowtype;
  accepted_at_value timestamptz;
begin
  if caller_id is null then
    raise exception 'Faça login para verificar o comunicado.' using errcode = '42501';
  end if;

  select profile.*
  into profile_row
  from public.profiles profile
  where profile.id = caller_id;

  if profile_row.id is null
     or coalesce(profile_row.enrolled, false) = false
     or coalesce(profile_row.archived, false) = true then
    return jsonb_build_object(
      'required', false,
      'policy_key', current_policy_key,
      'policy_version', current_policy_version
    );
  end if;

  if exists (
    select 1
    from public.teacher_admins admin
    where admin.user_id = caller_id
       or lower(admin.email) = lower(coalesce(profile_row.email, ''))
  ) then
    return jsonb_build_object(
      'required', false,
      'policy_key', current_policy_key,
      'policy_version', current_policy_version
    );
  end if;

  select acceptance.accepted_at
  into accepted_at_value
  from private.student_policy_acceptances acceptance
  where acceptance.student_id = caller_id
    and acceptance.policy_key = current_policy_key
    and acceptance.policy_version = current_policy_version;

  return jsonb_build_object(
    'required', accepted_at_value is null,
    'policy_key', current_policy_key,
    'policy_version', current_policy_version,
    'accepted_at', accepted_at_value
  );
end;
$function$;

revoke execute on function public.get_my_required_student_policy_notice()
  from public, anon;
grant execute on function public.get_my_required_student_policy_notice()
  to authenticated, service_role;

create or replace function public.accept_my_student_policy_notice(
  target_policy_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  current_policy_key constant text := 'lesson-cancellation-makeup';
  current_policy_version constant text := '2026-10-05-v1';
  profile_row public.profiles%rowtype;
  accepted_at_value timestamptz;
begin
  if caller_id is null then
    raise exception 'Faça login para aceitar o comunicado.' using errcode = '42501';
  end if;

  if nullif(btrim(target_policy_version), '') is null
     or target_policy_version is distinct from current_policy_version then
    raise exception 'O comunicado foi atualizado. Recarregue a página antes de continuar.';
  end if;

  select profile.*
  into profile_row
  from public.profiles profile
  where profile.id = caller_id
  for update;

  if profile_row.id is null
     or coalesce(profile_row.enrolled, false) = false
     or coalesce(profile_row.archived, false) = true then
    raise exception 'Apenas alunos ativos podem aceitar este comunicado.'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.teacher_admins admin
    where admin.user_id = caller_id
       or lower(admin.email) = lower(coalesce(profile_row.email, ''))
  ) then
    raise exception 'Este comunicado é destinado aos alunos.'
      using errcode = '42501';
  end if;

  insert into private.student_policy_acceptances (
    student_id,
    policy_key,
    policy_version,
    accepted_at
  )
  values (
    caller_id,
    current_policy_key,
    current_policy_version,
    now()
  )
  on conflict (student_id, policy_key, policy_version) do nothing;

  select acceptance.accepted_at
  into accepted_at_value
  from private.student_policy_acceptances acceptance
  where acceptance.student_id = caller_id
    and acceptance.policy_key = current_policy_key
    and acceptance.policy_version = current_policy_version;

  return jsonb_build_object(
    'ok', true,
    'policy_key', current_policy_key,
    'policy_version', current_policy_version,
    'accepted_at', accepted_at_value
  );
end;
$function$;

revoke execute on function public.accept_my_student_policy_notice(text)
  from public, anon;
grant execute on function public.accept_my_student_policy_notice(text)
  to authenticated, service_role;

notify pgrst, 'reload schema';
