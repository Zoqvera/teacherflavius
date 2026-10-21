-- Hide every student from the Roteiro da Aula after the class occurrence is finalized.
-- Keep cancelled lessons visible before finalization, without modifying cancellation records
-- or replacing the existing academic workflow and first-lesson-date guards.
do $patch$
declare
  definition text;
  legacy_filter constant text := 'where enriched.is_cancelled or not exists (';
  finalized_filter constant text := 'where not exists (';
  matching_count integer;
begin
  select pg_get_functiondef(to_regprocedure('public.get_teacher_lesson_plan(date)'))
    into definition;

  if definition is null then
    raise exception 'Required function not found: public.get_teacher_lesson_plan(date)';
  end if;

  if position(legacy_filter in definition) = 0 then
    if position(finalized_filter in definition) > 0 then
      return;
    end if;
    raise exception 'Unexpected finalization filter in public.get_teacher_lesson_plan(date)';
  end if;

  matching_count := (length(definition) - length(replace(definition, legacy_filter, '')))
    / length(legacy_filter);
  if matching_count <> 1 then
    raise exception 'Expected one legacy finalization filter, found %', matching_count;
  end if;

  execute replace(definition, legacy_filter, finalized_filter);
end;
$patch$;
