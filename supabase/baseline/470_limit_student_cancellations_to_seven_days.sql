-- Reconstruct the current student cancellation boundary without activating
-- forecast RPCs that are not part of the schema-only recovery baseline.
-- The 12-hour replacement credit rule and teacher controls are unchanged.

create or replace function private.lesson_can_be_cancelled(
  target_starts_at timestamptz,
  evaluated_at timestamptz
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $function$
  select target_starts_at is not null
    and evaluated_at >= target_starts_at - interval '7 days'
    and evaluated_at < target_starts_at;
$function$;

revoke execute on function private.lesson_can_be_cancelled(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function private.lesson_can_be_cancelled(timestamptz, timestamptz)
  to service_role;

revoke execute on function public.cancel_my_lesson_replacement(uuid)
  from public, anon, authenticated;
revoke execute on function public.cancel_my_makeup_class_booking(uuid)
  from public, anon, authenticated;

-- A changed contractual cancellation policy requires renewed student acknowledgement.
-- Historical acceptance records remain intact under their previous policy version.

CREATE OR REPLACE FUNCTION public.accept_my_student_policy_notice(target_policy_version text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  caller_id uuid := auth.uid();
  current_policy_key constant text := 'lesson-cancellation-makeup';
  current_policy_version constant text := '2026-11-05-v2';
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

CREATE OR REPLACE FUNCTION public.get_my_required_student_policy_notice()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  caller_id uuid := auth.uid();
  current_policy_key constant text := 'lesson-cancellation-makeup';
  current_policy_version constant text := '2026-11-05-v2';
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
