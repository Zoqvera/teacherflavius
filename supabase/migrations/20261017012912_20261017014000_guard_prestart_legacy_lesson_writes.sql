-- Refuse manual legacy attendance and lesson writes before a class actually starts.
-- Preserve existing teacher/MFA authorization and existing function signatures.
do $patch$
declare
  signature text;
  definition text;
  old_fragment text := 'perform public.assert_teacher_class_exists(target_class_number);';
  guard_fragment text := $guard$perform public.assert_teacher_class_exists(target_class_number);

  if exists (
    select 1
    from public.teacher_classes scheduled
    where scheduled.class_number = target_class_number
      and scheduled.first_lesson_date is not null
      and target_class_date < scheduled.first_lesson_date
  ) then
    raise exception 'Esta turma ainda não iniciou as aulas.'
      using errcode = '22023';
  end if;$guard$;
begin
  foreach signature in array array[
    'public.save_teacher_class_attendance(integer,date,text,jsonb)',
    'public.save_teacher_class_attendance_by_ref__mfa_inner(integer,date,text,jsonb)',
    'public.save_teacher_class_lesson_record_by_ref__mfa_inner(integer,text,text,date,text)'
  ] loop
    select pg_get_functiondef(to_regprocedure(signature)) into definition;
    if definition is null then
      raise exception 'Missing legacy function: %', signature;
    end if;
    if position(guard_fragment in definition) > 0 then
      continue;
    end if;
    if (length(definition) - length(replace(definition, old_fragment, '')))
      / length(old_fragment) <> 1 then
      raise exception 'Unexpected legacy function definition: %', signature;
    end if;
    execute replace(definition, old_fragment, guard_fragment);
  end loop;
end;
$patch$;
