-- Prioritize teacher-planned lessons for student preparation.
-- This supports non-sequential presentations without rewriting the completed history.
-- Once the earliest planned lesson is presented, the next scheduled plan takes over.

create or replace function private.academic_next_lesson_number(target_student_id uuid)
returns integer
language sql
stable security definer
set search_path to ''
as $function$
  with upcoming_teacher_plan as (
    select occurrence.planned_lesson_number
    from private.academic_lesson_occurrences occurrence
    where occurrence.student_id = target_student_id
      and occurrence.planned_lesson_number between 1 and 74
      and occurrence.presented_lesson_number is null
      and occurrence.attendance_status is distinct from 'absent'
      and occurrence.starts_at >= (
        (now() at time zone 'America/Sao_Paulo')::date
        at time zone 'America/Sao_Paulo'
      )
    order by occurrence.starts_at, occurrence.id
    limit 1
  ),
  teacher_confirmed_progress as (
    select max(occurrence.presented_lesson_number) as last_presented_lesson
    from private.academic_lesson_occurrences occurrence
    where occurrence.student_id = target_student_id
      and occurrence.attendance_status = 'present'
      and occurrence.presented_lesson_number between 1 and 74
  )
  select coalesce(
    (select plan.planned_lesson_number from upcoming_teacher_plan plan),
    (
      select case
        when progress.last_presented_lesson is null then 1
        when progress.last_presented_lesson >= 74 then null
        else progress.last_presented_lesson + 1
      end
      from teacher_confirmed_progress progress
    )
  );
$function$;

-- Keep the internal progression function inaccessible from browser roles.
revoke execute on function private.academic_next_lesson_number(uuid)
  from public, anon, authenticated;
