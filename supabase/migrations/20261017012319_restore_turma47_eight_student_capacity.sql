-- Revert the one-off nine-seat exception for TURMA 47 - SAT 10H.
-- Preserve the pre-existing nine-seat rules for internal classes 47 and 52.
set lock_timeout = '5s';
set statement_timeout = '60s';

do $guard$
begin
  if not exists (
    select 1 from public.teacher_classes
    where class_number=105
      and class_name='TURMA 47 - SAT 10H'
      and class_type='quintet'
      and is_active=true
      and class_weekday=6
      and class_start_time=time '10:00'
  ) then
    raise exception 'Unexpected identity for Saturday 10h class';
  end if;
  perform 1 from public.teacher_classes where class_number=105 for update;
  perform pg_catalog.pg_advisory_xact_lock(73008, 105);
  if (select count(*) from public.class_students where class_number=105)>8 then
    raise exception 'Cannot restore eight-seat cap while class has more than eight members';
  end if;
  if (select private.get_class_operational_capacity(105)) is distinct from 9 then
    raise exception 'Operational capacity changed unexpectedly; inspect before rollback';
  end if;
end;
$guard$;

update public.teacher_classes
set capacity_override=8, updated_at=now()
where class_number=105 and class_type='quintet' and capacity_override=9;

create or replace function private.get_class_operational_capacity(target_class_number integer)
returns integer
language sql
stable security definer
set search_path to ''
as $function$
  select case
    when tc.class_type = 'quintet' and tc.class_number in (47, 52) then 9
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

do $restore_admin$
declare
  deployed_definition text;
  expanded_expression constant text :=
    'case when target_class_number in (47, 52, 105) then 9 else 8 end';
  original_expression constant text :=
    'case when target_class_number in (47, 52) then 9 else 8 end';
begin
  select pg_get_functiondef(
    'public.set_teacher_class_type__mfa_inner(integer,text)'::regprocedure
  ) into deployed_definition;
  if position(expanded_expression in deployed_definition)=0 then
    raise exception 'Expected expanded class rule absent in admin function';
  end if;
  execute replace(deployed_definition,expanded_expression,original_expression);
end;
$restore_admin$;

do $verify$
begin
  if exists (
    select 1
    from public.teacher_classes tc
    where tc.class_number=105
      and (tc.capacity_override is distinct from 8
        or private.get_class_operational_capacity(tc.class_number) is distinct from 8)
  ) then
    raise exception 'Saturday 10h capacity rollback failed';
  end if;
  if exists (
    select 1
    from public.teacher_classes tc
    where tc.class_type='quintet'
      and tc.class_number not in (47, 52)
      and private.get_class_operational_capacity(tc.class_number) is distinct from 8
  ) then
    raise exception 'Unexpected capacity in another quintet class';
  end if;
  if exists (
    select 1
    from public.teacher_classes tc
    where tc.class_type='quintet'
      and tc.class_number in (47,52)
      and private.get_class_operational_capacity(tc.class_number) is distinct from 9
  ) then
    raise exception 'Original exceptions lost';
  end if;
end;
$verify$;