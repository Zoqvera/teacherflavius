-- Allow students to mark conversation questions as studied one at a time.
-- Keep the current batch stable until the teacher practices those marked questions.

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

  with candidate_questions as (
    select
      question.id,
      question.question_text,
      question.display_order,
      exists (
        select 1
        from private.student_question_studies study
        where study.student_id = caller_id
          and study.question_id = question.id
          and not exists (
            select 1
            from private.conversation_question_practice_log practice
            where practice.student_id = caller_id
              and practice.question_id = question.id
          )
      ) as studied
    from public.conversation_questions question
    where
      exists (
        select 1
        from private.student_question_studies study
        where study.student_id = caller_id
          and study.question_id = question.id
          and not exists (
            select 1
            from private.conversation_question_practice_log practice
            where practice.student_id = caller_id
              and practice.question_id = question.id
          )
      )
      or (
        not exists (
          select 1
          from private.student_question_studies study_history
          where study_history.student_id = caller_id
            and study_history.question_id = question.id
        )
        and not exists (
          select 1
          from public.conversation_question_completions completion
          where completion.student_id = caller_id
            and completion.question_id = question.id
        )
      )
    order by question.display_order, question.id
    limit 10
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', candidate.id,
          'text', candidate.question_text,
          'display_order', candidate.display_order,
          'studied', candidate.studied
        )
        order by candidate.display_order, candidate.id
      ),
      '[]'::jsonb
    ),
    count(*)::integer,
    count(*) filter (where candidate.studied)::integer
  into question_plan, question_count, studied_count
  from candidate_questions candidate;

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
    'questions_studied', question_count > 0 and studied_count = question_count,
    'questions_studied_count', studied_count,
    'questions_complete', question_count = 0
  );
end;
$function$;

revoke execute on function public.get_my_action_plan() from public, anon;
grant execute on function public.get_my_action_plan() to authenticated, service_role;

create or replace function public.mark_my_questions_studied(target_question_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  expected_ids uuid[];
  invalid_count integer := 0;
  saved_count integer := 0;
  studied_count integer := 0;
begin
  if caller_id is null then
    raise exception 'Faça login para registrar as perguntas estudadas.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = caller_id
      and coalesce(profile.enrolled, false) = true
      and coalesce(profile.archived, false) = false
  ) then
    raise exception 'Apenas alunos ativos podem registrar estudo.' using errcode = '42501';
  end if;

  with candidate_questions as (
    select question.id, question.display_order
    from public.conversation_questions question
    where
      exists (
        select 1
        from private.student_question_studies study
        where study.student_id = caller_id
          and study.question_id = question.id
          and not exists (
            select 1
            from private.conversation_question_practice_log practice
            where practice.student_id = caller_id
              and practice.question_id = question.id
          )
      )
      or (
        not exists (
          select 1
          from private.student_question_studies study_history
          where study_history.student_id = caller_id
            and study_history.question_id = question.id
        )
        and not exists (
          select 1
          from public.conversation_question_completions completion
          where completion.student_id = caller_id
            and completion.question_id = question.id
        )
      )
    order by question.display_order, question.id
    limit 10
  )
  select coalesce(
    array_agg(candidate.id order by candidate.display_order, candidate.id),
    '{}'::uuid[]
  )
  into expected_ids
  from candidate_questions candidate;

  if cardinality(expected_ids) = 0 then
    return jsonb_build_object('ok', true, 'saved_count', 0, 'complete', true);
  end if;

  if target_question_ids is null or cardinality(target_question_ids) = 0 then
    raise exception 'Selecione ao menos uma pergunta para registrar.';
  end if;

  select count(*)::integer
  into invalid_count
  from unnest(target_question_ids) as selected(question_id)
  where selected.question_id is null
     or not (selected.question_id = any(expected_ids));

  if invalid_count > 0 then
    raise exception 'O conjunto de perguntas mudou. Atualize a página e tente novamente.';
  end if;

  insert into private.student_question_studies (student_id, question_id)
  select distinct caller_id, selected.question_id
  from unnest(target_question_ids) as selected(question_id)
  where selected.question_id = any(expected_ids)
  on conflict (student_id, question_id) do nothing;

  get diagnostics saved_count = row_count;

  select count(*)::integer
  into studied_count
  from unnest(expected_ids) as expected(question_id)
  where exists (
    select 1
    from private.student_question_studies study
    where study.student_id = caller_id
      and study.question_id = expected.question_id
      and not exists (
        select 1
        from private.conversation_question_practice_log practice
        where practice.student_id = caller_id
          and practice.question_id = expected.question_id
      )
  );

  return jsonb_build_object(
    'ok', true,
    'saved_count', saved_count,
    'all_studied', studied_count = cardinality(expected_ids),
    'complete', false
  );
end;
$function$;

revoke execute on function public.mark_my_questions_studied(uuid[]) from public, anon;
grant execute on function public.mark_my_questions_studied(uuid[]) to authenticated, service_role;

notify pgrst, 'reload schema';
