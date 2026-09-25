alter table public.teacher_classes
  add column if not exists capacity_override smallint;

alter table public.teacher_classes
  drop constraint if exists teacher_classes_capacity_override_range;

alter table public.teacher_classes
  add constraint teacher_classes_capacity_override_range
  check (capacity_override is null or capacity_override between 1 and 50);

update public.teacher_classes
set capacity_override = 10,
    updated_at = now()
where class_number = 36;

create or replace function private.get_class_operational_capacity(target_class_number integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    tc.capacity_override::integer,
    case
      when tc.class_type = 'individual' then 1
      when tc.class_type in ('quartet', 'quintet') then 5
      when tc.class_type = 'eight_students' then 8
      else null
    end
  )
  from public.teacher_classes tc
  where tc.class_number = target_class_number
  limit 1;
$function$;

revoke all on function private.get_class_operational_capacity(integer)
  from public, anon, authenticated;
grant execute on function private.get_class_operational_capacity(integer)
  to service_role;
