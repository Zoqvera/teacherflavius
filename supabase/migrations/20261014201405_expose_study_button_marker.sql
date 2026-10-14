-- Add a permanent button-click marker without changing existing
-- action-plan study/completion semantics or disclosing private tables.
-- Students receive only their own marker through auth.uid().
create or replace function public.get_my_action_plan()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  next_lesson integer;
  lesson_page_id uuid;
  prepared_at timestamptz;
  question_plan jsonb := '[]'::jsonb;
  question_count integer := 0;
  studied_count integer := 0;
  worked_count integer := 0;
begin
  if caller_id is null then
    raise exception 'Faça login para visualizar o que fazer.' using errcode = '42501';
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

  next_lesson := private.academic_next_lesson_number(caller_id);

  if next_lesson is not null then
    select page.id
    into lesson_page_id
    from public.study_lesson_pages page
    where page.roadmap_lesson_number = next_lesson
    limit 1;

    select preparation.prepared_at
    into prepared_at
    from private.student_lesson_preparations preparation
    where preparation.student_id = caller_id
      and preparation.lesson_number = next_lesson;
  end if;

  with all_questions as (
    select
      question.id,
      question.question_text,
      question.display_order,
      (
        exists (
          select 1
          from private.student_question_studies study
          where study.student_id = caller_id
            and study.question_id = question.id
        )
        and not exists (
          select 1
          from private.conversation_question_practice_log practice
          where practice.student_id = caller_id
            and practice.question_id = question.id
        )
        and not exists (
          select 1
          from public.conversation_question_completions completion
          where completion.student_id = caller_id
            and completion.question_id = question.id
        )
      ) as studied,
      -- Preserve the historical button click even when a teacher later
      -- marks this question as worked.
      exists (
        select 1
        from private.student_question_studies study
        where study.student_id = caller_id
          and study.question_id = question.id
      ) as marked_studied,
      (
        exists (
          select 1
          from private.conversation_question_practice_log practice
          where practice.student_id = caller_id
            and practice.question_id = question.id
        )
        or exists (
          select 1
          from public.conversation_question_completions completion
          where completion.student_id = caller_id
            and completion.question_id = question.id
        )
      ) as worked
    from public.conversation_questions question
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', question.id,
          'text', question.question_text,
          'display_order', question.display_order,
          'studied', question.studied,
          'marked_studied', question.marked_studied,
          'worked', question.worked
        )
        order by question.display_order, question.id
      ),
      '[]'::jsonb
    ),
    count(*)::integer,
    count(*) filter (where question.studied)::integer,
    count(*) filter (where question.worked)::integer
  into question_plan, question_count, studied_count, worked_count
  from all_questions question;

  return jsonb_build_object(
    'lesson',
    case
      when next_lesson is null then null
      else jsonb_build_object(
        'number', next_lesson,
        'page_id', lesson_page_id,
        'prepared', prepared_at is not null,
        'prepared_at', prepared_at,
        'has_material', lesson_page_id is not null or next_lesson between 1 and 20
      )
    end,
    'questions', question_plan,
    'questions_studied',
      question_count > 0 and studied_count + worked_count = question_count,
    'questions_studied_count', studied_count,
    'questions_worked_count', worked_count,
    'questions_complete',
      question_count > 0 and worked_count = question_count
  );
end;
$function$;

revoke execute on function public.get_my_action_plan() from public, anon;
grant execute on function public.get_my_action_plan() to authenticated, service_role;

notify pgrst, 'reload schema';
