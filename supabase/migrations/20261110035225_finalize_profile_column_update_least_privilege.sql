-- Restrict UPDATE on authorization-owned profile columns after client cache refresh.
-- Existing student onboarding uses administrator-checked RPCs for these fields.
do $preflight$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass) then
    raise exception 'RLS on public.profiles must be enabled.';
  end if;

  if not has_function_privilege(
    'authenticated', 'public.set_teacher_student_profile_class_type(uuid,text)', 'EXECUTE'
  ) then
    raise exception 'Administrative class-type RPC must be available.';
  end if;

  if has_table_privilege('authenticated', 'public.profiles', 'UPDATE') then
    raise exception 'Broad authenticated UPDATE privilege must already be revoked.';
  end if;

  if not has_column_privilege('authenticated', 'public.profiles', 'date_of_birth', 'UPDATE') then
    raise exception 'Student profile editor is not configured.';
  end if;
end;
$preflight$;

revoke update (enrolled, enrollment_code, class_type)
on table public.profiles from authenticated;

do $verify$
declare
  denied_field text;
  allowed_field text;
begin
  foreach denied_field in array array[
    'enrolled', 'enrollment_code', 'class_type', 'archived', 'tuition_first_due_date'
  ] loop
    if has_column_privilege('authenticated', 'public.profiles', denied_field, 'UPDATE') then
      raise exception 'Protected field still writable by authenticated: %', denied_field;
    end if;
  end loop;

  foreach allowed_field in array array[
    'name', 'cpf', 'whatsapp', 'pix_key', 'availability',
    'date_of_birth', 'profile_completed'
  ] loop
    if not has_column_privilege('authenticated', 'public.profiles', allowed_field, 'UPDATE') then
      raise exception 'Student profile field unexpectedly blocked: %', allowed_field;
    end if;
  end loop;

  if not has_table_privilege('service_role', 'public.profiles', 'UPDATE') then
    raise exception 'Service role lost administrative UPDATE privilege.';
  end if;
end;
$verify$;