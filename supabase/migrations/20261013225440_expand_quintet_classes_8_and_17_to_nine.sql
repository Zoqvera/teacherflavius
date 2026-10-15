-- Preserve the eight-student default while allowing nine regular students
-- specifically in TURMA 8 (MON 20H, class_number 47) and TURMA 17 (TUE 20H, class_number 52).
-- The class numbers are persistent internal identifiers, not their displayed numbers.
set lock_timeout = '5s';
set statement_timeout = '60s';

do $guard$
begin
  if (
    select count(*)
    from public.teacher_classes
    where class_number in (47, 52)
      and class_type = 'quintet'
      and is_active = true
  ) <> 2 then
    raise exception 'Expected both selected classes to be active QUINTETO classes.';
  end if;
end;
$guard$;

update public.teacher_classes
set capacity_override = 9,
    updated_at = now()
where class_number in (47, 52)
  and class_type = 'quintet'
  and capacity_override is distinct from 9;

-- This helper drives admission constraints, vacancy reports, self-service
-- transfers, replacement booking capacity and data-quality checks.
create or replace function private.get_class_operational_capacity(
  target_class_number integer
)
returns integer
language sql
stable
security definer
set search_path to ''
as $function$
  select case
    when tc.class_type = 'quintet' and tc.class_number in (47, 52) then 9
    when tc.class_type = 'quintet' then 8
    else coalesce(
      tc.capacity_override::integer,
      case
        when tc.class_type = 'individual' then 1
        else null
      end
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

-- Re-saving a class classification in the admin UI must not erase the exception.
-- Patch the currently deployed function without replacing unrelated MFA checks.
do $patch$
declare
  existing_definition text;
  updated_definition text;
  old_expression constant text := $old$when normalized_type = 'quintet' then 8$old$;
  new_expression constant text := $new$when normalized_type = 'quintet' then
             case when target_class_number in (47, 52) then 9 else 8 end$new$;
begin
  select pg_get_functiondef(
    'public.set_teacher_class_type__mfa_inner(integer,text)'::regprocedure
  ) into existing_definition;

  if position(new_expression in existing_definition) > 0 then
    return;
  end if;

  if position(old_expression in existing_definition) = 0 then
    raise exception 'Class configuration implementation changed; check before applying.';
  end if;

  updated_definition := replace(
    existing_definition,
    old_expression,
    new_expression
  );
  execute updated_definition;
end;
$patch$;

do $verify$
begin
  if exists (
    select 1
    from public.teacher_classes tc
    where tc.class_number in (47, 52)
      and (
        tc.capacity_override is distinct from 9
        or private.get_class_operational_capacity(tc.class_number) is distinct from 9
      )
  ) then
    raise exception 'Nine-student exceptions failed verification.';
  end if;

  if exists (
    select 1
    from public.teacher_classes tc
    where tc.class_type = 'quintet'
      and tc.class_number not in (47, 52)
      and private.get_class_operational_capacity(tc.class_number) is distinct from 8
  ) then
    raise exception 'Unrelated QUINTETO class capacity unexpectedly changed.';
  end if;
end;
$verify$;
