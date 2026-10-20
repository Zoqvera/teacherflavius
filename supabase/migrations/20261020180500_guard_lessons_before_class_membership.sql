-- Prevent billing credits from scheduling a regular lesson before the student joined.
-- Preserve existing historical credit slots and explicit teacher-configured start dates.
-- Existing memberships are NOT resynchronized by this migration.
do $patch$
declare
  current_definition text;
  expected_fragment text := $expected$
      and (class.first_lesson_date is null or lesson_day::date >= class.first_lesson_date)
      and (
        membership.first_lesson_date is null
        or lesson_day::date >= membership.first_lesson_date
      )$expected$;
  corrected_fragment text := $corrected$
      and (class.first_lesson_date is null or lesson_day::date >= class.first_lesson_date)
      and (
        membership.first_lesson_date is null
        or lesson_day::date >= membership.first_lesson_date
      )
      -- A new student's contract cannot include a lesson that began before joining.
      -- Explicit first dates take precedence; already-allocated slots remain intact.
      and (
        membership.first_lesson_date is not null
        or ((lesson_day::date + class.class_start_time) at time zone 'America/Sao_Paulo') >= membership.created_at
        or exists (
          select 1
          from private.lesson_credits historical_credit
          where historical_credit.student_id = tuition_row.student_id
            and historical_credit.tuition_id = tuition_row.id
            and historical_credit.credit_origin = 'contract'
            and historical_credit.regular_class_number = class.class_number
            and historical_credit.regular_starts_at =
              ((lesson_day::date + class.class_start_time) at time zone 'America/Sao_Paulo')
        )
      )$corrected$;
  occurrence_count integer;
begin
  select pg_get_functiondef(to_regprocedure('private.sync_lesson_credits_for_tuition(uuid)'))
    into current_definition;

  if current_definition is null then
    raise exception 'The lesson-credit synchronization function is missing.';
  end if;

  if position(corrected_fragment in current_definition) > 0 then
    return;
  end if;

  occurrence_count :=
    (length(current_definition) - length(replace(current_definition, expected_fragment, '')))
    / length(expected_fragment);

  if occurrence_count <> 1 then
    raise exception 'Unexpected lesson-credit function definition (matches: %).', occurrence_count;
  end if;

  execute replace(current_definition, expected_fragment, corrected_fragment);
end;
$patch$;
