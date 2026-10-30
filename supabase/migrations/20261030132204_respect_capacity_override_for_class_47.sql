create or replace function private.get_class_operational_capacity(target_class_number integer)
returns integer
language sql
stable
security definer
set search_path to ''
as $function$
  select case
    when tc.class_type = 'quintet' and tc.class_number = 52
      then coalesce(tc.capacity_override::integer, 9)
    when tc.class_type = 'quintet' and tc.class_number = 47
      then coalesce(tc.capacity_override::integer, 9)
    when tc.class_type = 'quintet'
      then coalesce(tc.capacity_override::integer, 8)
    else coalesce(
      tc.capacity_override::integer,
      case when tc.class_type = 'individual' then 1 else null end
    )
  end
  from public.teacher_classes as tc
  where tc.class_number = target_class_number
  limit 1;
$function$;