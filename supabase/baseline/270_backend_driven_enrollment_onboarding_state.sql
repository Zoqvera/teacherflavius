-- Let the backend decide whether the authenticated user is completing a
-- new enrollment or only filling missing data on an existing enrollment.

create or replace function public.get_my_enrollment_onboarding_state()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  profile_row public.profiles%rowtype;
  access_authorized boolean := false;
  flow_mode text;
begin
  if caller_id is null then
    raise exception 'Faça login para continuar a matrícula.'
      using errcode = '42501';
  end if;

  select profile.*
  into profile_row
  from public.profiles profile
  where profile.id = caller_id;

  if profile_row.id is null then
    return jsonb_build_object(
      'mode', 'new_enrollment',
      'profile_exists', false,
      'profile_completed', false,
      'enrolled', false,
      'requires_access_code', true,
      'enrollment_access_authorized', false,
      'requires_class_mode', true,
      'requires_tuition_due_date', true,
      'requires_commercial_setup', true,
      'form_unlocked', false
    );
  end if;

  if coalesce(profile_row.archived, false) then
    raise exception 'Perfil de aluno arquivado.'
      using errcode = '42501';
  end if;

  access_authorized := coalesce(public.has_my_enrollment_access(), false);

  flow_mode := case
    when coalesce(profile_row.profile_completed, false) then 'complete'
    when coalesce(profile_row.enrolled, false) then 'existing_student_profile_completion'
    else 'new_enrollment'
  end;

  return jsonb_build_object(
    'mode', flow_mode,
    'profile_exists', true,
    'profile_completed', coalesce(profile_row.profile_completed, false),
    'enrolled', coalesce(profile_row.enrolled, false),
    'requires_access_code', flow_mode = 'new_enrollment',
    'enrollment_access_authorized', access_authorized,
    'requires_class_mode', flow_mode = 'new_enrollment',
    'requires_tuition_due_date', flow_mode = 'new_enrollment',
    'requires_commercial_setup', flow_mode = 'new_enrollment',
    'form_unlocked',
      flow_mode = 'existing_student_profile_completion'
      or (flow_mode = 'new_enrollment' and access_authorized)
  );
end;
$function$;

revoke all on function public.get_my_enrollment_onboarding_state()
  from public, anon;
grant execute on function public.get_my_enrollment_onboarding_state()
  to authenticated, service_role;

notify pgrst, 'reload schema';
