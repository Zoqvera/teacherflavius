-- Expose only each authenticated active student's reviews due at the next attended lesson.
-- Reuses the attendance-based intervals already used by the teacher's lesson plan.

create or replace function public.get_my_review_questions()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  next_attendance_sequence integer;
  due_questions jsonb;
begin
  if caller_id is null then
    raise exception 'Faça login para visualizar suas revisões.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = caller_id
      and coalesce(profile.enrolled, false) = true
      and coalesce(profile.archived, false) = false
  ) then
    raise exception 'Esta página está disponível apenas para alunos ativos.' using errcode = '42501';
  end if;

  next_attendance_sequence := private.academic_planned_attendance_sequence(
    caller_id,
    (now() at time zone 'America/Sao_Paulo')::date
  );

  with latest_practice as (
    select distinct on (practice.question_id)
      practice.question_id,
      practice.due_attendance_sequence
    from private.conversation_question_practice_log practice
    where practice.student_id = caller_id
    order by
      practice.question_id,
      practice.attendance_sequence desc,
      practice.practiced_at desc
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', question.id,
        'text', question.question_text,
        'display_order', question.display_order
      )
      order by latest.due_attendance_sequence, question.display_order, question.id
    ),
    '[]'::jsonb
  )
  into due_questions
  from latest_practice latest
  join public.conversation_questions question on question.id = latest.question_id
  where latest.due_attendance_sequence <= next_attendance_sequence;

  return due_questions;
end;
$function$;

revoke execute on function public.get_my_review_questions() from public, anon;
grant execute on function public.get_my_review_questions() to authenticated, service_role;

notify pgrst, 'reload schema';
