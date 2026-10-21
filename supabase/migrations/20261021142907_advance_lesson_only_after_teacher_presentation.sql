-- Progress is defined solely by the teacher's APRESENTOU action in Roteiro da Aula.
-- Historic L# attendance records never advance the student preparatory lesson.
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

revoke execute on function private.academic_next_lesson_number(uuid)
  from public, anon, authenticated;
grant execute on function private.academic_next_lesson_number(uuid)
  to service_role;