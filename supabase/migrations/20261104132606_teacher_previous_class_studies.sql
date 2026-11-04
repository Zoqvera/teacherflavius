-- Read-only, teacher-restricted view of questions marked as studied for the preceding class occurrence.
create or replace function public.get_teacher_previous_class_studies(target_date date default null)
returns table (
  entry_id uuid,
  student_id uuid,
  class_number integer,
  previous_starts_at timestamp with time zone,
  questions jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  effective_date date := coalesce(target_date, (now() at time zone 'America/Sao_Paulo')::date);
begin
  if auth.uid() is null or not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso administrativo do professor obrigatório.' using errcode = '42501';
  end if;

  return query
  with roster as (
    select plan.entry_id, plan.student_id, plan.class_number, plan.starts_at
    from public.get_teacher_lesson_plan(effective_date) plan
    where plan.lesson_kind = 'regular'
  ),
  previous_lessons as (
    select roster.*, previous.starts_at as previous_starts_at
    from roster
    left join lateral (
      select occurrence.starts_at
      from private.academic_lesson_occurrences occurrence
      where occurrence.student_id = roster.student_id
        and occurrence.class_number = roster.class_number
        and occurrence.starts_at < roster.starts_at
        and occurrence.attendance_status in ('present', 'absent')
        and not exists (
          select 1
          from private.academic_non_instructional_class_dates excluded_date
          where excluded_date.class_number = occurrence.class_number
            and excluded_date.class_date =
              (occurrence.starts_at at time zone 'America/Sao_Paulo')::date
        )
      order by occurrence.starts_at desc
      limit 1
    ) previous on true
  ),
  study_cycles as (
    select previous_lessons.*, earlier.starts_at as cycle_starts_at
    from previous_lessons
    left join lateral (
      select occurrence.starts_at
      from private.academic_lesson_occurrences occurrence
      where occurrence.student_id = previous_lessons.student_id
        and occurrence.class_number = previous_lessons.class_number
        and occurrence.starts_at < previous_lessons.previous_starts_at
        and occurrence.attendance_status in ('present', 'absent')
        and not exists (
          select 1
          from private.academic_non_instructional_class_dates excluded_date
          where excluded_date.class_number = occurrence.class_number
            and excluded_date.class_date =
              (occurrence.starts_at at time zone 'America/Sao_Paulo')::date
        )
      order by occurrence.starts_at desc
      limit 1
    ) earlier on true
  )
  select
    cycle.entry_id,
    cycle.student_id,
    cycle.class_number,
    cycle.previous_starts_at,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', question.id,
          'display_order', question.display_order,
          'text', question.question_text,
          'translation', question.question_translation,
          'examples', question.answer_examples
        )
        order by question.display_order, question.id
      )
      from private.student_question_studies study
      join public.conversation_questions question on question.id = study.question_id
      where study.student_id = cycle.student_id
        and cycle.previous_starts_at is not null
        and study.studied_at >= coalesce(cycle.cycle_starts_at, '-infinity'::timestamptz)
        and study.studied_at < cycle.previous_starts_at
    ), '[]'::jsonb)
  from study_cycles cycle
  order by cycle.class_number, cycle.student_id;
end;
$function$;

revoke all on function public.get_teacher_previous_class_studies(date) from public, anon, authenticated;
grant execute on function public.get_teacher_previous_class_studies(date) to authenticated, service_role;