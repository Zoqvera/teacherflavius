-- Schedule starts for Saturday classes. Preserve financial due dates and attendance history.
-- Individual first_lesson_date may delay a particular student's start beyond the class date.
alter table public.teacher_classes
  add column if not exists first_lesson_date date;

comment on column public.teacher_classes.first_lesson_date is
  'Earliest eligible lesson date for the entire class; null retains legacy scheduling.';

-- Keep the existing academic workflows, authorization and return types intact.
-- Fail closed if an upstream version differs from the known production definitions.
do $patch$
declare
  patch record;
  definition text;
  matching_count integer;
begin
  for patch in
    select * from (values
      (
        'public.get_teacher_lesson_plan(date)',
        'and membership.user_id is not null',
        'and membership.user_id is not null
    and (membership.first_lesson_date is null or effective_date >= membership.first_lesson_date)
    and (class.first_lesson_date is null or effective_date >= class.first_lesson_date)'
      ),
      (
        'public.get_teacher_students_of_day()',
        'and cs.user_id is not null',
        'and cs.user_id is not null
    and (cs.first_lesson_date is null or target_date >= cs.first_lesson_date)
    and (tc.first_lesson_date is null or target_date >= tc.first_lesson_date)'
      ),
      (
        'private.resolve_academic_lesson(text,uuid,date)',
        'where membership.id = target_entry_id',
        'where membership.id = target_entry_id
      and (membership.first_lesson_date is null or target_date >= membership.first_lesson_date)
      and (class.first_lesson_date is null or target_date >= class.first_lesson_date)'
      ),
      (
        'private.sync_lesson_credits_for_tuition(uuid)',
        'and extract(isodow from lesson_day)::integer = class.class_weekday',
        'and extract(isodow from lesson_day)::integer = class.class_weekday
      and (class.first_lesson_date is null or lesson_day::date >= class.first_lesson_date)'
      ),
      (
        'public.sync_auto_makeup_slots_30_days()',
        'and extract(isodow from d)::integer = tc.class_weekday',
        'and extract(isodow from d)::integer = tc.class_weekday
      and (tc.first_lesson_date is null or d::date >= tc.first_lesson_date)'
      )
    ) as expected(function_signature, original_fragment, guarded_fragment)
  loop
    select pg_get_functiondef(to_regprocedure(patch.function_signature))
      into definition;
    if definition is null then
      raise exception 'Required function not found: %', patch.function_signature;
    end if;
    if position(patch.guarded_fragment in definition) > 0 then
      continue;
    end if;
    matching_count := (length(definition) - length(replace(definition, patch.original_fragment, '')))
      / length(patch.original_fragment);
    if matching_count <> 1 then
      raise exception 'Unexpected SQL definition for %: % matching fragments',
        patch.function_signature, matching_count;
    end if;
    execute replace(definition, patch.original_fragment, patch.guarded_fragment);
  end loop;
end;
$patch$;

create or replace function public.get_teacher_class_first_lesson_date(
  target_class_number integer
)
returns date
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  configured_date date;
begin
  if (select auth.uid()) is null or not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso exclusivo do professor.' using errcode = '42501';
  end if;

  select classes.first_lesson_date into configured_date
  from public.teacher_classes classes
  where classes.class_number = target_class_number and classes.is_active = true;

  if not found then
    raise exception 'Turma ativa não encontrada.' using errcode = '22023';
  end if;
  return configured_date;
end;
$function$;

create or replace function public.set_teacher_class_first_lesson_date(
  target_class_number integer,
  target_first_lesson_date date
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  class_row public.teacher_classes%rowtype;
  affected_students integer;
  affected_tuitions integer := 0;
  tuition_row record;
  today_sp date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if (select auth.uid()) is null or not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso exclusivo do professor.' using errcode = '42501';
  end if;

  if target_first_lesson_date is null then
    raise exception 'Informe a data de início.' using errcode = '22023';
  end if;

  select * into class_row
  from public.teacher_classes
  where class_number = target_class_number and is_active = true
  for update;

  if not found then
    raise exception 'Turma ativa não encontrada.' using errcode = '22023';
  end if;

  if class_row.class_weekday is null
     or extract(isodow from target_first_lesson_date)::integer <> class_row.class_weekday then
    raise exception 'A data inicial deve corresponder ao dia da semana da turma.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from private.academic_lesson_occurrences occurrence
    where occurrence.class_number = target_class_number
      and (occurrence.starts_at at time zone 'America/Sao_Paulo')::date < target_first_lesson_date
      and occurrence.attendance_status in ('present', 'absent')
  ) or exists (
    select 1
    from public.class_lesson_records record
    where record.class_number = target_class_number
      and record.class_date < target_first_lesson_date
  ) then
    raise exception 'Existe histórico de aulas anteriores à data pretendida.'
      using errcode = '22023';
  end if;

  update public.teacher_classes
  set first_lesson_date = target_first_lesson_date
  where class_number = target_class_number;

  update public.class_students membership
  set first_lesson_date = target_first_lesson_date
  where membership.class_number = target_class_number
    and (
      membership.first_lesson_date is null
      or membership.first_lesson_date is not distinct from class_row.first_lesson_date
    );
  get diagnostics affected_students = row_count;

  for tuition_row in
    select distinct tuition.id
    from public.monthly_tuition tuition
    join public.class_students membership on membership.user_id = tuition.student_id
    where membership.class_number = target_class_number
      and (tuition.payment_date is not null or coalesce(tuition.is_exempt, false))
      and coalesce(private.get_tuition_coverage_end(tuition.id), tuition.due_date) >= today_sp
  loop
    perform private.sync_lesson_credits_for_tuition(tuition_row.id);
    affected_tuitions := affected_tuitions + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'class_number', target_class_number,
    'first_lesson_date', target_first_lesson_date,
    'updated_students', affected_students,
    'resynchronized_tuitions', affected_tuitions
  );
end;
$function$;

revoke all on function public.get_teacher_class_first_lesson_date(integer)
  from public, anon, authenticated;
grant execute on function public.get_teacher_class_first_lesson_date(integer)
  to authenticated;

revoke all on function public.set_teacher_class_first_lesson_date(integer,date)
  from public, anon, authenticated;
grant execute on function public.set_teacher_class_first_lesson_date(integer,date)
  to authenticated;

-- The two cohorts have not started. Existing tuition due dates are unchanged.
update public.teacher_classes
set first_lesson_date = '2026-10-24'
where class_number in (105,108) and first_lesson_date is null;

update public.class_students
set first_lesson_date = '2026-10-24'
where class_number in (105,108) and first_lesson_date is null;

-- Resynchronize settled current coverage after applying the exclusion date.
do $sync$
declare
  tuition_row record;
begin
  for tuition_row in
    select distinct tuition.id
    from public.monthly_tuition tuition
    join public.class_students membership on membership.user_id = tuition.student_id
    where membership.class_number in (105,108)
      and (tuition.payment_date is not null or coalesce(tuition.is_exempt, false))
      and coalesce(private.get_tuition_coverage_end(tuition.id), tuition.due_date)
        >= (now() at time zone 'America/Sao_Paulo')::date
  loop
    perform private.sync_lesson_credits_for_tuition(tuition_row.id);
  end loop;
end;
$sync$;
