create or replace function private.get_class_operational_capacity(target_class_number integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when tc.class_type = 'individual' then 1
    when tc.class_type = 'quartet' and tc.class_number in (55, 73, 75) then 5
    when tc.class_type = 'quartet' then 4
    when tc.class_type = 'quintet' then 5
    when tc.class_type = 'eight_students' then 8
    else null
  end
  from public.teacher_classes tc
  where tc.class_number = target_class_number
  limit 1;
$function$;

revoke all on function private.get_class_operational_capacity(integer)
  from public, anon, authenticated;
grant execute on function private.get_class_operational_capacity(integer)
  to service_role;
