-- TAREFAS PARA CASA - ETAPA 4 (sem lancamento).
-- Acesso estudantil permanece desligado ate autorizacao expressa do proprietario.
create table public.homework_release_control (
  id integer primary key default 1 check (id = 1),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.homework_release_control (id, enabled) values (1, false);
alter table public.homework_release_control enable row level security;
revoke all on public.homework_release_control from public, anon, authenticated;
grant select on public.homework_release_control to service_role;

-- RLS pode consultar somente a chave de bloqueio, nunca uma credencial de usuario.
create function public.homework_is_released()
returns boolean language sql stable security definer set search_path = ''
as $sql$
  select coalesce((select enabled from public.homework_release_control where id = 1), false);
$sql$;
revoke all on function public.homework_is_released() from public, anon, authenticated;
grant execute on function public.homework_is_released() to authenticated, service_role;

alter table public.exercise_assignments drop constraint exercise_assignments_status_check;
alter table public.exercise_assignments add constraint exercise_assignments_status_check
  check (status in ('held', 'assigned'));
alter table public.exercise_attempts drop constraint exercise_attempts_status_check;
alter table public.exercise_attempts add constraint exercise_attempts_status_check
  check (status in ('draft', 'submitted', 'evaluating', 'evaluated'));
alter table public.exercise_attempts
  add column submission_key uuid,
  add column evaluation_token uuid,
  add column evaluation_started_at timestamptz;
create unique index exercise_attempts_submission_key_unique
  on public.exercise_attempts(student_id, submission_key) where submission_key is not null;
-- Uma entrega oficial por atribuicao; reenvios identicos devolvem a mesma tentativa.
create unique index exercise_attempts_one_official_submission
  on public.exercise_attempts(assignment_id) where submission_key is not null;
create unique index exercise_feedback_one_ai_per_attempt
  on public.exercise_feedback(attempt_id) where source = 'ai';
create unique index exercise_feedback_one_auto_per_attempt
  on public.exercise_feedback(attempt_id) where source = 'automatic';

-- Leituras estudantis sao individualizadas e ainda bloqueadas pela chave global.
create policy homework_student_assignment_read on public.exercise_assignments
  for select to authenticated
  using (student_id = (select auth.uid()) and status = 'assigned'
    and (select public.homework_is_released()));
create policy homework_student_attempt_read on public.exercise_attempts
  for select to authenticated
  using (student_id = (select auth.uid()) and (select public.homework_is_released())
    and exists (
      select 1 from public.exercise_assignments a
      where a.id = assignment_id and a.student_id = (select auth.uid()) and a.status = 'assigned'
    ));
create policy homework_student_answer_read on public.exercise_answers
  for select to authenticated
  using ((select public.homework_is_released()) and exists (
    select 1 from public.exercise_attempts t
    where t.id = attempt_id and t.student_id = (select auth.uid())
  ));
create policy homework_student_feedback_read on public.exercise_feedback
  for select to authenticated
  using ((select public.homework_is_released()) and exists (
    select 1 from public.exercise_attempts t
    where t.id = attempt_id and t.student_id = (select auth.uid())
  ));
grant select on public.exercise_assignments to authenticated;
grant select (id, assignment_id, version_id, student_id, attempt_number, status,
  score, started_at, submitted_at, evaluated_at) on public.exercise_attempts to authenticated;
grant select on public.exercise_answers, public.exercise_feedback to authenticated;
-- Nenhuma permissao de INSERT/UPDATE/DELETE para aluno nas tabelas de respostas.

-- Criar atribuicoes retidas sem disponibilizar nada aos alunos.
create function public.homework_assign_held(p_exercise_id uuid, p_student_id uuid)
returns uuid language plpgsql security invoker set search_path = ''
as $fn$
declare
  target public.exercises;
  result_id uuid;
begin
  if not (select public.is_teacher_admin()) or
     coalesce((select auth.jwt()->>'aal'), '') <> 'aal2' then
    raise exception 'Acesso exclusivo ao professor com MFA.' using errcode='42501';
  end if;
  select * into target from public.exercises where id = p_exercise_id;
  if not found or target.status <> 'published' or target.published_version_id is null then
    raise exception 'Somente atividades aprovadas e publicadas podem ser atribuidas.';
  end if;
  if not exists (select 1 from public.profiles
                 where id = p_student_id and enrolled is true and coalesce(archived,false) is false) then
    raise exception 'Aluno nao matriculado ou arquivado.';
  end if;
  insert into public.exercise_assignments
    (exercise_id, version_id, student_id, status, assigned_by)
  values (target.id, target.published_version_id, p_student_id, 'held', auth.uid())
  returning id into result_id;
  return result_id;
end;
$fn$;
revoke all on function public.homework_assign_held(uuid,uuid) from public, anon, authenticated;
grant execute on function public.homework_assign_held(uuid,uuid) to authenticated;
grant insert on public.exercise_assignments to authenticated;

-- Chamadas de escrita acontecem exclusivamente pelo servidor com service_role.
-- O chamador Edge valida auth.getUser() e passa seu user.id, nunca um ID fornecido pelo cliente.
create function public.homework_submit(
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
  pending_review int := 0;
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
      answer_correct := false;
      for accepted in
        select value from jsonb_array_elements_text(
          case when jsonb_typeof(question_row.answer_key->'accepted') = 'array'
            then question_row.answer_key->'accepted'
            else jsonb_build_array(question_row.answer_key->>'correct') end
        )
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
      if answer_correct then
        points_earned := points_earned + question_points;
      elsif question_row.question_type = 'short_answer' then
        pending_review := pending_review + 1;
      end if;
      insert into public.exercise_answers(attempt_id,question_id,answer,score)
        values (attempt_id,question_row.id,jsonb_build_object('response',response_text),
          case when answer_correct then 10
               when question_row.question_type = 'multiple_choice' then 0
               else null end);
    end loop;
    if pending_review = 0 then
      final_score := round(10 * points_earned / nullif(points_total,0),2);
      result_status := 'evaluated';
      update public.exercise_attempts set score=final_score,status=result_status,
        evaluated_at=now() where id=attempt_id;
      insert into public.exercise_feedback
        (attempt_id,source,score,general_comment)
      values (attempt_id,'automatic',final_score,
        'Resultado automatico por correspondencia com o gabarito. Respostas abertas divergentes exigem revisao.');
    end if;
  end if;
  return jsonb_build_object('attempt_id',attempt_id,'status',result_status,
    'score',final_score,'pending_review',pending_review,'activity_type',activity,'reused',false);
end;
$fn$;

create function public.homework_claim_writing(p_student_id uuid, p_attempt_id uuid)
returns jsonb language plpgsql security invoker set search_path = ''
as $fn$
declare
  target public.exercise_attempts;
  response_text text;
  activity_prompt text;
  lease uuid;
begin
  if not (select public.homework_is_released()) then
    raise exception 'Recurso nao liberado.' using errcode='42501';
  end if;
  select * into target from public.exercise_attempts where id=p_attempt_id for update;
  if not found or target.student_id <> p_student_id or not exists (
      select 1 from public.exercise_assignments a
      join public.exercises e on e.id=a.exercise_id
      where a.id=target.assignment_id and a.student_id=p_student_id
        and a.status='assigned' and e.activity_type='writing'
        and e.status='published' and e.published_version_id=target.version_id
    ) then
    raise exception 'Envio de Writing indisponivel.' using errcode='42501';
  end if;
  if target.status='evaluated' then
    return jsonb_build_object('status','evaluated','attempt_id',target.id);
  end if;
  if target.status='evaluating' and
     target.evaluation_started_at > now() - interval '2 minutes' then
    return jsonb_build_object('status','processing','attempt_id',target.id);
  end if;
  if target.status not in ('submitted','evaluating') then
    raise exception 'Tentativa nao pronta.';
  end if;
  select answer->>'text' into response_text from public.exercise_answers
    where attempt_id=target.id and question_id is null order by saved_at limit 1;
  select content->>'prompt' into activity_prompt from public.exercise_versions
    where id=target.version_id;
  if response_text is null or activity_prompt is null then
    raise exception 'Texto de avaliacao indisponivel.';
  end if;
  lease := gen_random_uuid();
  update public.exercise_attempts set status='evaluating',evaluation_token=lease,
    evaluation_started_at=now() where id=target.id;
  return jsonb_build_object('status','claimed','attempt_id',target.id,
    'token',lease,'text',response_text,'prompt',activity_prompt);
end;
$fn$;

create function public.homework_complete_writing(
  p_student_id uuid, p_attempt_id uuid, p_token uuid, p_score numeric,
  p_comment text, p_corrected text, p_explanations jsonb, p_model text
)
returns jsonb language plpgsql security invoker set search_path = ''
as $fn$
declare
  target public.exercise_attempts;
  original text;
  feedback_row public.exercise_feedback;
begin
  select * into target from public.exercise_attempts where id=p_attempt_id for update;
  if not found or target.student_id <> p_student_id or target.status <> 'evaluating'
    or target.evaluation_token is distinct from p_token then
    raise exception 'Token de avaliacao invalido.' using errcode='42501';
  end if;
  if p_score is null or p_score < 0 or p_score > 10
    or char_length(trim(coalesce(p_comment,''))) not between 10 and 2000
    or char_length(trim(coalesce(p_corrected,''))) not between 1 and 5000
    or jsonb_typeof(p_explanations) <> 'array' or jsonb_array_length(p_explanations) > 12
    or exists(select 1 from jsonb_array_elements(p_explanations) x(v)
              where jsonb_typeof(x.v) <> 'string' or char_length(x.v #>> '{}') > 600)
    or nullif(trim(p_model),'') is null then
    raise exception 'Avaliacao de IA fora da rubrica.';
  end if;
  select answer->>'text' into original from public.exercise_answers
    where attempt_id=target.id and question_id is null order by saved_at limit 1;
  if original is null then raise exception 'Texto original ausente.'; end if;
  insert into public.exercise_feedback
    (attempt_id,source,score,general_comment,original_text,corrected_text,explanations,evaluator_model)
  values (target.id,'ai',round(p_score,2),trim(p_comment),original,trim(p_corrected),
          p_explanations,p_model) returning * into feedback_row;
  update public.exercise_attempts set status='evaluated',score=round(p_score,2),
    evaluated_at=now(),evaluation_token=null,evaluation_started_at=null where id=target.id;
  return to_jsonb(feedback_row);
end;
$fn$;

create function public.homework_release_writing_lease(
  p_student_id uuid, p_attempt_id uuid, p_token uuid
)
returns void language plpgsql security invoker set search_path = ''
as $fn$
begin
  update public.exercise_attempts
  set status='submitted',evaluation_token=null,evaluation_started_at=null
  where id=p_attempt_id and student_id=p_student_id
    and status='evaluating' and evaluation_token=p_token;
end;
$fn$;

revoke all on function public.homework_submit(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.homework_claim_writing(uuid,uuid) from public,anon,authenticated;
revoke all on function public.homework_complete_writing(uuid,uuid,uuid,numeric,text,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.homework_release_writing_lease(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.homework_submit(uuid,uuid,uuid,jsonb) to service_role;
grant execute on function public.homework_claim_writing(uuid,uuid) to service_role;
grant execute on function public.homework_complete_writing(uuid,uuid,uuid,numeric,text,text,jsonb,text) to service_role;
grant execute on function public.homework_release_writing_lease(uuid,uuid,uuid) to service_role;

comment on table public.homework_release_control is
  'Bloqueio operacional. enabled=false em producao ate autorizacao expressa do professor.';
comment on function public.homework_submit(uuid,uuid,uuid,jsonb) is
  'Somente servidor autenticado: RLS de aluno nao permite escritas diretas.';

-- Testes transacionais anteriores consumiram valores da identity mesmo apos ROLLBACK.
-- Recupera a numeracao inicial somente quando ainda nao ha atividade cadastrada.
do $sequence$
begin
  if not exists (select 1 from public.exercises) then
    perform setval('public.exercises_exercise_number_seq'::regclass, 1, false);
  end if;
end;
$sequence$;
