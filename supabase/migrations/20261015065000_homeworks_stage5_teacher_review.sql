-- ETAPA 5: revisão pedagógica de respostas abertas pendentes.
-- Não altera o bloqueio global, nem libera as atribuições held.
-- Executadas somente por professor autenticado com MFA AAL2.
create function public.homework_review_queue(p_limit integer default 100)
returns table (
  answer_id uuid,
  attempt_id uuid,
  student_id uuid,
  exercise_number bigint,
  activity_type text,
  submitted_at timestamptz,
  question_prompt text,
  response_text text,
  accepted_answers jsonb,
  question_points numeric
)
language plpgsql security definer set search_path = ''
as $review$
begin
  if auth.uid() is null or
     coalesce((select public.is_teacher_admin()),false) is not true or
     coalesce((select auth.jwt()->>'aal'),'') <> 'aal2' then
    raise exception 'Acesso exclusivo ao professor com MFA.' using errcode='42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Limite de resultados inválido.';
  end if;

  return query
    select a.id, t.id, t.student_id, e.exercise_number, e.activity_type,
           t.submitted_at, q.prompt, a.answer->>'response',
           coalesce(q.answer_key->'accepted', '[]'::jsonb), q.points
    from public.exercise_attempts t
    join public.exercise_assignments asg on asg.id=t.assignment_id
      and asg.version_id=t.version_id and asg.student_id=t.student_id
    join public.exercises e on e.id=asg.exercise_id
      and e.published_version_id=t.version_id and e.status='published'
    join public.exercise_answers a on a.attempt_id=t.id
    join public.exercise_questions q on q.id=a.question_id
      and q.version_id=t.version_id
    where t.status='submitted' and a.score is null
      and q.question_type='short_answer'
      and e.activity_type in ('reading','grammar')
    order by t.submitted_at, e.exercise_number, q.position
    limit p_limit;
end;
$review$;

create function public.homework_review_answer(
  p_answer_id uuid, p_score numeric, p_comment text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $review$
declare
  target public.exercise_attempts;
  answer_row public.exercise_answers;
  candidate_answer_id uuid;
  question_row public.exercise_questions;
  activity text;
  question_total integer;
  answer_total integer;
  pending integer;
  grade numeric(4,2);
begin
  if auth.uid() is null or
     coalesce((select public.is_teacher_admin()),false) is not true or
     coalesce((select auth.jwt()->>'aal'),'') <> 'aal2' then
    raise exception 'Acesso exclusivo ao professor com MFA.' using errcode='42501';
  end if;
  if p_answer_id is null or p_score is null or p_score < 0 or p_score > 10
     or char_length(trim(coalesce(p_comment,''))) not between 10 and 1000 then
    raise exception 'Nota ou justificativa inválida.';
  end if;

  select a.attempt_id into candidate_answer_id
  from public.exercise_answers a where a.id=p_answer_id;
  if candidate_answer_id is null then
    raise exception 'Resposta não localizada.';
  end if;

  -- A tentativa é o bloqueio único por operação, inclusive ao rever
  -- respostas diferentes simultaneamente. Evita notas finais concorrentes.
  select * into target from public.exercise_attempts
    where id=candidate_answer_id for update;
  if not found or target.status <> 'submitted' then
    raise exception 'Tentativa indisponível para revisão.';
  end if;
  select * into answer_row from public.exercise_answers
    where id=p_answer_id and attempt_id=target.id for update;
  if not found or answer_row.score is not null or answer_row.question_id is null then
    raise exception 'Resposta já corrigida ou inválida.';
  end if;
  select * into question_row from public.exercise_questions
    where id=answer_row.question_id and version_id=target.version_id;
  if not found or question_row.question_type <> 'short_answer' then
    raise exception 'Apenas respostas abertas divergentes podem ser revistas.';
  end if;

  select e.activity_type into activity
  from public.exercise_assignments asg
  join public.exercises e on e.id=asg.exercise_id
  where asg.id=target.assignment_id and asg.version_id=target.version_id
    and asg.student_id=target.student_id and e.status='published'
    and e.published_version_id=target.version_id;
  if activity not in ('reading','grammar') or activity is null then
    raise exception 'Revisão permitida somente em Reading e Grammar.';
  end if;

  update public.exercise_answers
    set score=round(p_score,2), saved_at=now()
    where id=answer_row.id;

  insert into public.exercise_feedback
    (attempt_id,answer_id,source,score,general_comment)
  values (target.id,answer_row.id,'teacher',round(p_score,2),trim(p_comment));

  select count(*) into question_total from public.exercise_questions
    where version_id=target.version_id;
  select count(*),count(*) filter (where a.score is null)
    into answer_total,pending
  from public.exercise_answers a
    where a.attempt_id=target.id;

  if question_total <> answer_total or question_total = 0 then
    raise exception 'Respostas incompletas: nota final bloqueada.';
  end if;

  if pending = 0 then
    select round(sum(a.score*q.points)/nullif(sum(q.points),0),2)
      into grade
    from public.exercise_answers a
    join public.exercise_questions q on q.id=a.question_id
    where a.attempt_id=target.id and q.version_id=target.version_id;
    if grade is null or grade < 0 or grade > 10 then
      raise exception 'Pontuação fora do intervalo permitido.';
    end if;
    update public.exercise_attempts
      set score=grade,status='evaluated',evaluated_at=now()
      where id=target.id;
    insert into public.exercise_feedback
      (attempt_id,source,score,general_comment)
    values (target.id,'teacher',grade,
      'Revisão pedagógica concluída pelo professor. Nota final ponderada por questão.');
  end if;
  return jsonb_build_object(
    'attempt_id',target.id,
    'status',case when pending=0 then 'evaluated' else 'submitted' end,
    'score',grade,
    'pending_review',pending
  );
end;
$review$;

revoke all on function public.homework_review_queue(integer) from public,anon,authenticated;
revoke all on function public.homework_review_answer(uuid,numeric,text) from public,anon,authenticated;
grant execute on function public.homework_review_queue(integer) to authenticated;
grant execute on function public.homework_review_answer(uuid,numeric,text) to authenticated;

comment on function public.homework_review_queue(integer) is
  'Professor MFA AAL2: lista respostas abertas divergentes ainda sem nota.';
comment on function public.homework_review_answer(uuid,numeric,text) is
  'Professor MFA AAL2: registra nota e comentário com fechamento transacional.';
