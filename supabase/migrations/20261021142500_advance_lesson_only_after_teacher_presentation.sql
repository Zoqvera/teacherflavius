-- Only an explicit teacher confirmation in Roteiro da Aula advances the study lesson.
-- Legacy class_lesson_records (including L1/L2 entries) remain valid as history,
-- but do not constitute confirmation that a lesson was presented.
create or replace function private.academic_next_lesson_number(target_student_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $function$
  with teacher_confirmed_progress as (
    select max(occurrence.presented_lesson_number) as last_presented_lesson
    from private.academic_lesson_occurrences occurrence
    where occurrence.student_id = target_student_id
      and occurrence.attendance_status = 'present'
      and occurrence.presented_lesson_number between 1 and 74
  )
  select case
    when progress.last_presented_lesson is null then 1
    when progress.last_presented_lesson >= 74 then null
    else progress.last_presented_lesson + 1
  end
  from teacher_confirmed_progress progress;
$function$;

-- Preserve the helper's private, service-only execution contract.
revoke execute on function private.academic_next_lesson_number(uuid)
  from public, anon, authenticated;
grant execute on function private.academic_next_lesson_number(uuid)
  to service_role;
