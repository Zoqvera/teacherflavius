-- Histórico pedagógico somente para o professor e limitado aos alunos do roteiro.
-- O marco do ciclo é o início da última aula registrada (presença ou ausência).
-- Apenas o primeiro clique em "ESTUDEI A PERGUNTA" é persistido atualmente.
create or replace function public.get_teacher_study_history_for_plan(target_date date default null)
returns table (
  student_id uuid,
  starts_at timestamptz,
  previously_studied_numbers jsonb,
  today_questions jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  effective_date date := coalesce(target_date, (now() at time zone 'America/Sao_Paulo')::date);
  study_cutoff timestamptz := least(
    now(),
    ((coalesce(target_date, (now() at time zone 'America/Sao_Paulo')::date) + 1)::timestamp
      at time zone 'America/Sao_Paulo')
  );
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso administrativo do professor obrigatório.' using errcode = '42501';
  end if;

  return query
  with scheduled_students as (
    select distinct plan.student_id, plan.starts_at
    from public.get_teacher_lesson_plan(effective_date) plan
  ),
  study_cycles as (
    select
      scheduled.student_id,
      scheduled.starts_at,
      (
        select prior.starts_at
        from private.academic_lesson_occurrences prior
        where prior.student_id = scheduled.student_id
          and prior.starts_at < scheduled.starts_at
          and prior.attendance_status in ('present', 'absent')
        order by prior.starts_at desc
        limit 1
      ) as previous_class_start
    from scheduled_students scheduled
  )
  select
    cycle.student_id,
    cycle.starts_at,
    coalesce((
      select jsonb_agg(distinct question.display_order order by question.display_order)
      from private.student_question_studies study
      join public.conversation_questions question on question.id = study.question_id
      where study.student_id = cycle.student_id
        and study.studied_at < cycle.previous_class_start
        and study.studied_at < study_cutoff
        and question.display_order > 0
    ), '[]'::jsonb) as previously_studied_numbers,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', question.id,
          'text', question.question_text,
          'display_order', question.display_order,
          'source', 'new'
        )
        order by question.display_order, question.id
      )
      from private.student_question_studies study
      join public.conversation_questions question on question.id = study.question_id
      where study.student_id = cycle.student_id
        and study.studied_at >= coalesce(cycle.previous_class_start, '-infinity'::timestamptz)
        and study.studied_at < study_cutoff
    ), '[]'::jsonb) as today_questions
  from study_cycles cycle
  order by cycle.starts_at, cycle.student_id;
end;
$function$;

revoke all on function public.get_teacher_study_history_for_plan(date) from public, anon;
grant execute on function public.get_teacher_study_history_for_plan(date)
  to authenticated, service_role;
comment on function public.get_teacher_study_history_for_plan(date) is
  'Professor: perguntas já estudadas antes da última aula registrada e primeiro estudo no ciclo atual.';
notify pgrst, 'reload schema';
