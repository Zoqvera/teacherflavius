-- Standardize experimental class capacities to 30 places per dated session.
-- Regular QUINTETO and INDIVIDUAL capacities remain untouched.
set lock_timeout = '5s';
set statement_timeout = '60s';

update public.teacher_classes
set capacity_override = 30,
    updated_at = now()
where class_type = 'experimental'
  and capacity_override is distinct from 30;

-- The default for newly created EXPERIMENTAL classes is also 30.
do $patch$
declare
  existing_definition text;
  updated_definition text;
begin
  select pg_get_functiondef(
    'public.create_teacher_class_with_type__mfa_inner(text,text)'::regprocedure
  ) into existing_definition;

  if position(
    $old$case when normalized_type in ('quintet','experimental') then 8 else null end$old$
    in existing_definition
  ) = 0 then
    raise exception 'Unexpected teacher class creation function. No changes applied.';
  end if;

  updated_definition := replace(
    existing_definition,
    $old$case when normalized_type in ('quintet','experimental') then 8 else null end$old$,
    $new$case
      when normalized_type = 'quintet' then 8
      when normalized_type = 'experimental' then 30
      else null
    end$new$
  );
  execute updated_definition;
end;
$patch$;

-- Preserve the 30-place setting on normal edits. Converting an existing
-- regular class to EXPERIMENTAL initializes the new capacity at 30.
do $patch$
declare
  existing_definition text;
  updated_definition text;
begin
  select pg_get_functiondef(
    'public.set_teacher_class_type__mfa_inner(integer,text)'::regprocedure
  ) into existing_definition;

  if position(
    $old$when normalized_type = 'experimental' then coalesce(capacity_override, 8)$old$
    in existing_definition
  ) = 0 then
    raise exception 'Unexpected teacher class configuration function. No changes applied.';
  end if;

  updated_definition := replace(
    existing_definition,
    $old$when normalized_type = 'experimental' then coalesce(capacity_override, 8)$old$,
    $new$when normalized_type = 'experimental' then
             case
               when class_type = 'experimental' then coalesce(capacity_override, 30)
               else 30
             end$new$
  );
  execute updated_definition;
end;
$patch$;

-- Reject a partial application if any experimental class is not 30.
do $verify$
begin
  if exists (
    select 1
    from public.teacher_classes
    where class_type = 'experimental'
      and (capacity_override is distinct from 30
        or private.get_class_operational_capacity(class_number) is distinct from 30)
  ) then
    raise exception 'Experimental capacity verification failed.';
  end if;
end;
$verify$;