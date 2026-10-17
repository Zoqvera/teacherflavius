-- Keep eight seats as the QUINTETO default. Extend the existing nine-seat
-- exception only to TURMA 47 - SAT 10H (internal class_number = 105).
set lock_timeout = '5s';
set statement_timeout = '60s';

do $guard$
begin
  if not exists (
    select 1
    from public.teacher_classes
    where class_number = 105
      and class_name = 'TURMA 47 - SAT 10H'
      and class_type = 'quintet'
      and is_active = true
      and class_weekday = 6
      and class_start_time = time '10:00'
  ) then
    raise exception 'Expected TURMA 47 (SAT 10H) as an active QUINTETO class.';
  end if;
  if (select count(*) from public.class_students where class_number = 105) > 9 then
    raise exception 'TURMA 47 already exceeds nine linked students.';
  end if;
end;
$guard$;

update public.teacher_classes
set capacity_override = 9,
    updated_at = now()
where class_number = 105
  and class_type = 'quintet'
  and capacity_override is distinct from 9;

create or replace function private.get_class_operational_capacity(target_class_number integer)
returns integer
language sql
stable
security definer
set search_path to ''
as $function$
  select case
    when tc.class_type = 'quintet' and tc.class_number in (47, 52, 105) then 9
    when tc.class_type = 'quintet' then 8
    else coalesce(
      tc.capacity_override::integer,
      case when tc.class_type = 'individual' then 1 else null end
    )
  end
  from public.teacher_classes tc
  where tc.class_number = target_class_number
  limit 1;
$function$;

revoke all on function private.get_class_operational_capacity(integer)
  from public, anon, authenticated;
grant execute on function private.get_class_operational_capacity(integer)
  to service_role;

-- Keep the exception when the teacher resaves the class type in the admin UI.
-- Preserve the existing MFA and authorization logic of the admin function.
do $patch$
declare
  original_definition text;
  old_expression constant text := 'case when target_class_number in (47, 52) then 9 else 8 end';
  new_expression constant text := 'case when target_class_number in (47, 52, 105) then 9 else 8 end';
begin
  select pg_get_functiondef(
    'public.set_teacher_class_type__mfa_inner(integer,text)'::regprocedure
  ) into original_definition;
  if position(new_expression in original_definition) > 0 then
    return;
  end if;
  if position(old_expression in original_definition) = 0 then
    raise exception 'Class configuration implementation changed; check before applying.';
  end if;
  execute replace(original_definition, old_expression, new_expression);
end;
$patch$;

do $verify$
begin
  if private.get_class_operational_capacity(105) is distinct from 9
     or (select capacity_override from public.teacher_classes where class_number = 105) is distinct from 9 then
    raise exception 'TURMA 47 nine-seat capacity verification failed.';
  end if;
  if exists (
    select 1 from public.teacher_classes tc
    where tc.class_type = 'quintet'
      and tc.class_number not in (47, 52, 105)
      and private.get_class_operational_capacity(tc.class_number) is distinct from 8
  ) then
    raise exception 'Other QUINTETO classes unexpectedly changed capacity.';
  end if;
  if exists (
    select 1 from public.teacher_classes tc
    where tc.class_type = 'quintet'
      and tc.class_number in (47, 52)
      and private.get_class_operational_capacity(tc.class_number) is distinct from 9
  ) then
    raise exception 'Existing nine-seat exceptions must remain intact.';
  end if;
end;
$verify$;
