-- Student classification and class assignment are separate states.
-- A classified active student may legitimately be awaiting placement in a class.
-- Keep this count as an informational metric instead of degrading system health.

do $migration$
declare
  current_definition text;
  updated_definition text;
  old_issue_fragment text := $old$
  if typed_student_without_active_class > 0 then insert into pg_temp.operational_data_quality_issues values ('data_quality_typed_student_without_active_class','warning',jsonb_build_object('count',typed_student_without_active_class)); end if;
$old$;
  old_metric_fragment text := $metric_old$
    'typed_student_without_active_class',typed_student_without_active_class,
$metric_old$;
  new_metric_fragment text := $metric_new$
    'typed_student_without_active_class_info',typed_student_without_active_class,
$metric_new$;
begin
  select pg_get_functiondef(
    'private.run_operational_data_quality_check(boolean)'::regprocedure
  )
  into current_definition;

  if current_definition is null then
    raise exception 'Operational data quality function not found.';
  end if;

  updated_definition := replace(
    current_definition,
    old_issue_fragment,
    '  -- Classified students without a class are valid while awaiting placement.'
  );

  if updated_definition = current_definition then
    raise exception 'Expected typed-student-without-active-class warning was not found.';
  end if;

  current_definition := updated_definition;
  updated_definition := replace(
    current_definition,
    old_metric_fragment,
    new_metric_fragment
  );

  if updated_definition = current_definition then
    raise exception 'Expected typed-student-without-active-class metric was not found.';
  end if;

  execute updated_definition;
end
$migration$;

select private.run_operational_data_quality_check(false);
