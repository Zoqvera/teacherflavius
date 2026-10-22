-- Student-only history of questions explicitly marked with "ESTUDEI A PERGUNTA".
-- Keep the first-click timestamp and catalog numbering; do not conflate teacher practice with study.

create or replace function public.get_my_studied_questions()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := (select auth.uid());
begin
  if caller_id is null then
    raise exception 'Faça login para consultar suas perguntas estudadas.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = caller_id
      and profile.enrolled is true
      and profile.archived is false
  ) then
    raise exception 'Esta página está disponível apenas para alunos ativos.' using errcode = '42501';
  end if;

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', question.id,
          'question_text', question.question_text,
          'question_translation', question.question_translation,
          'answer_examples', question.answer_examples,
          'display_order', question.display_order,
          'studied_at', study.studied_at
        )
        order by study.studied_at desc nulls last, question.display_order, question.id
      ),
      '[]'::jsonb
    )
    from private.student_question_studies study
    join public.conversation_questions question
      on question.id = study.question_id
    where study.student_id = caller_id
  );
end;
$function$;

revoke all on function public.get_my_studied_questions() from public, anon;
grant execute on function public.get_my_studied_questions() to authenticated, service_role;
comment on function public.get_my_studied_questions() is
  'Read-only first-click study history scoped to the authenticated active student.';

notify pgrst, 'reload schema';
