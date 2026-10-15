-- ETAPA 5 — Reading/Grammar 100% automáticos por comparação ao gabarito.
-- Não modifica a tabela de liberação, atribuições nem dados de alunos.
-- Histórico anterior de migrações é preservado. Nenhuma revisão humana é exigida.
create or replace function public.homework_submit(
  p_student_id uuid, p_assignment_id uuid, p_submission_key uuid, p_payload jsonb
)
returns jsonb language plpgsql security invoker set search_path = ''
as $fn$
declare
  assigned public.exercise_assignments;
  target public.exercises;
  prior public.exercise_attempts;
  attempt_id uuid;
  activity text;
  questions_total int;
  questions_seen uuid[] := '{}';
  item jsonb;
  question_row public.exercise_questions;
  response_text text;
  answer_correct boolean;
  accepted text;
  question_points numeric;
  points_total numeric := 0;
  points_earned numeric := 0;
  accepted_answers jsonb;
  result_status text := 'submitted';
  final_score numeric(4,2);
begin
  if not (select public.homework_is_released()) then
    raise exception 'Tarefas para Casa ainda nao foi liberado.' using errcode='42501';
  end if;
  if p_student_id is null or p_assignment_id is null or p_submission_key is null
     or p_payload is null or pg_column_size(p_payload) > 12000 then
    raise exception 'Requisicao invalida.';
  end if;
  select * into assigned from public.exercise_assignments
    where id = p_assignment_id for update;
  if not found or assigned.student_id <> p_student_id or assigned.status <> 'assigned'
    or not exists (select 1 from public.profiles
        where id = p_student_id and enrolled is true and coalesce(archived,false) is false) then
    raise exception 'Atividade nao atribuida a este aluno.' using errcode='42501';
  end if;
  select * into target from public.exercises where id = assigned.exercise_id;
  if not found or target.status <> 'published' or
     target.published_version_id is distinct from assigned.version_id then
    raise exception 'Versao da atividade indisponivel.';
  end if;
  select * into prior from public.exercise_attempts
    where assignment_id = assigned.id and submission_key is not null for update;
  if found then
    if prior.student_id <> p_student_id or prior.submission_key <> p_submission_key then
      raise exception 'Esta atividade ja foi enviada.';
    end if;
    return jsonb_build_object('attempt_id',prior.id,'status',prior.status,
      'score',prior.score,'activity_type',target.activity_type,'reused',true);
  end if;
  if exists (select 1 from public.exercise_attempts
      where student_id = p_student_id and submission_key = p_submission_key) then
    raise exception 'Identificador de envio utilizado em outra atividade.';
  end if;
  activity := target.activity_type;
  if activity = 'writing' then
    if jsonb_typeof(p_payload) <> 'object' or
      (select count(*) from jsonb_object_keys(p_payload)) <> 1 or
      jsonb_typeof(p_payload->'text') <> 'string' or
      char_length(trim(p_payload->>'text')) not between 20 and 3000 then
      raise exception 'Writing requer texto de 20 a 3000 caracteres.';
    end if;
    if exists (select 1 from public.exercise_questions where version_id = assigned.version_id) then
      raise exception 'Writing nao pode conter questoes objetivas.';
    end if;
  else
    if jsonb_typeof(p_payload) <> 'array' or jsonb_array_length(p_payload) > 40 then
      raise exception 'Respostas em formato invalido.';
    end if;
    select count(*) into questions_total from public.exercise_questions
      where version_id = assigned.version_id;
    if questions_total = 0 or jsonb_array_length(p_payload) <> questions_total then
      raise exception 'Todas as questoes precisam ser respondidas.';
    end if;
  end if;
  insert into public.exercise_attempts
    (assignment_id,version_id,student_id,attempt_number,status,submission_key,submitted_at)
  values (assigned.id, assigned.version_id, p_student_id, 1, 'submitted',
          p_submission_key, now()) returning id into attempt_id;
  if activity = 'writing' then
    insert into public.exercise_answers(attempt_id,answer)
      values (attempt_id, jsonb_build_object('text',trim(p_payload->>'text')));
  else
    for item in select value from jsonb_array_elements(p_payload) loop
      if jsonb_typeof(item) <> 'object' or jsonb_typeof(item->'response') <> 'string'
        or jsonb_typeof(item->'question_id') <> 'string' then
        raise exception 'Questao ou resposta invalida.';
      end if;
      select * into question_row from public.exercise_questions
        where id = (item->>'question_id')::uuid and version_id = assigned.version_id;
      if not found or question_row.id = any(questions_seen) then
        raise exception 'Questao repetida ou pertencente a outra atividade.';
      end if;
      questions_seen := array_append(questions_seen, question_row.id);
      response_text := trim(item->>'response');
      if char_length(response_text) not between 1 and 2000 then
        raise exception 'Respostas nao podem estar vazias nem exceder 2000 caracteres.';
      end if;
      -- Gabaritos incompletos não geram notas artificiais.
      accepted_answers := case
        when jsonb_typeof(question_row.answer_key->'accepted') = 'array'
          then question_row.answer_key->'accepted'
        when jsonb_typeof(question_row.answer_key->'correct') = 'string'
          then jsonb_build_array(question_row.answer_key->>'correct')
        else '[]'::jsonb end;
      if jsonb_array_length(accepted_answers) = 0 or exists (
        select 1 from jsonb_array_elements(accepted_answers) candidate(value)
        where jsonb_typeof(candidate.value) <> 'string'
          or char_length(trim(candidate.value #>> '{}')) = 0
      ) then
        raise exception 'Gabarito ausente ou inválido: a atividade não pode ser corrigida.';
      end if;
      answer_correct := false;
      for accepted in select value from jsonb_array_elements_text(accepted_answers)
      loop
        if lower(regexp_replace(response_text,'[[:space:]]+',' ','g')) =
           lower(regexp_replace(trim(accepted),'[[:space:]]+',' ','g')) then
          answer_correct := true;
          exit;
        end if;
      end loop;
      if question_row.question_type = 'multiple_choice' and
        not exists (select 1 from jsonb_array_elements_text(question_row.options) o(value)
          where o.value = response_text) then
        raise exception 'Alternativa nao cadastrada.';
      end if;
      question_points := question_row.points;
      points_total := points_total + question_points;
      if answer_correct then points_earned := points_earned + question_points; end if;
      insert into public.exercise_answers(attempt_id,question_id,answer,score)
        values (attempt_id,question_row.id,jsonb_build_object('response',response_text),
          case when answer_correct then 10 else 0 end);
    end loop;
    if points_total <= 0 then
      raise exception 'Atividade sem pontuação válida.';
    end if;
    final_score := round(10 * points_earned / points_total,2);
    result_status := 'evaluated';
    update public.exercise_attempts set score=final_score,status=result_status,
      evaluated_at=now() where id=attempt_id;
    insert into public.exercise_feedback
      (attempt_id,source,score,general_comment)
    values (attempt_id,'automatic',final_score,
      'Correção automática: respostas comparadas ao gabarito aprovado, com pesos por questão.');
  end if;
  return jsonb_build_object('attempt_id',attempt_id,'status',result_status,
    'score',final_score,'pending_review',0,'activity_type',activity,'reused',false);
end;
$fn$;


-- Retira a funcionalidade rejeitada de revisão manual.
drop function if exists public.homework_review_answer(uuid,numeric,text);
drop function if exists public.homework_review_queue(integer);

-- A RPC de submissão permanece executável apenas no backend service_role.
revoke all on function public.homework_submit(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.homework_submit(uuid,uuid,uuid,jsonb) to service_role;
comment on function public.homework_submit(uuid,uuid,uuid,jsonb) is
  'Writing usa IA; Reading/Grammar recebem nota imediata pela comparação normalizada ao gabarito aprovado, sem revisão humana.';
