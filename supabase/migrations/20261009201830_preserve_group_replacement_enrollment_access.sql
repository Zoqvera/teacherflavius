-- Preserve existing QUINTETO replacement access; INDIVIDUAL requires a regular individual class.
CREATE OR REPLACE FUNCTION private.student_replacement_target_type(target_student_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case upper(btrim(coalesce(profile.class_type, '')))
    when 'INDIVIDUAL' then 'individual'
    when 'QUINTETO' then 'quintet'
    else null
  end
  from public.profiles profile
  where profile.id = target_student_id
    and profile.enrolled = true
    and coalesce(profile.archived, false) = false
    and upper(btrim(coalesce(profile.class_type, ''))) in ('INDIVIDUAL', 'QUINTETO')
    and (
      upper(btrim(profile.class_type)) = 'QUINTETO'
      or exists (
        select 1
        from public.class_students membership
        join public.teacher_classes regular_class
          on regular_class.class_number = membership.class_number
         and regular_class.is_active = true
        where membership.user_id = profile.id
          and regular_class.class_type = 'individual'
      )
    )
  limit 1;
$function$;
revoke all on function private.student_replacement_target_type(uuid) from public,anon,authenticated;
