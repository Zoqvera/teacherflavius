-- ETAPA 5: teste integrado exclusivamente em Postgres descartável do CI.
-- Nunca executar em produção. Todas as alterações ficam em uma transação revertida.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL app.homework_budget_notify = 'false';

DO $preflight$
begin
  if current_database() <> 'postgres' or
     to_regprocedure('public.homework_submit(uuid,uuid,uuid,jsonb)') is null then
    raise exception 'Homologação exige banco local com todas as migrações de Homeworks.';
  end if;
  if (select enabled from public.homework_release_control where id = 1) is distinct from false then
    raise exception 'O padrão de lançamento precisa continuar bloqueado.';
  end if;
  if to_regprocedure('public.homework_review_answer(uuid,numeric,text)') is not null or
     to_regprocedure('public.homework_review_queue(integer)') is not null then
    raise exception 'Correção manual de Reading/Grammar reapareceu.';
  end if;
end;
$preflight$;

-- Contas e perfis fictícios são criados com permissões normais.
-- O CI não altera triggers de auth.users nem de profiles, e valida
-- as mesmas chaves estrangeiras, políticas RLS e funções da aplicação.

DO $homework_cases$
declare
  teacher_id constant uuid := '09000000-0000-4000-8000-000000000001';
  student_a constant uuid := '09000000-0000-4000-8000-000000000002';
  student_b constant uuid := '09000000-0000-4000-8000-000000000003';
  submission_key constant uuid := '09000000-0000-4000-8000-000000000004';
  second_key constant uuid := '09000000-0000-4000-8000-000000000005';
  writing_key constant uuid := '09000000-0000-4000-8000-000000000006';
  reading_id uuid;
  writing_id uuid;
  grammar_id uuid;
  reading_version uuid;
  writing_version uuid;
  grammar_version uuid;
  reading_assignment uuid;
  writing_assignment uuid;
  grammar_assignment uuid;
  writing_attempt uuid;
  writing_token uuid;
  reading_payload jsonb;
  grammar_payload jsonb;
  output jsonb;
  seen uuid;
  i integer;
  failed boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at)
  values
    (teacher_id, '00000000-0000-0000-0000-000000000000',
      'authenticated','authenticated','test-teacher@example.invalid','not-a-password',now(),now(),now()),
    (student_a, '00000000-0000-0000-0000-000000000000',
      'authenticated','authenticated','test-student-a@example.invalid','not-a-password',now(),now(),now()),
    (student_b, '00000000-0000-0000-0000-000000000000',
      'authenticated','authenticated','test-student-b@example.invalid','not-a-password',now(),now(),now());

  insert into public.profiles (id, name, enrolled, archived)
  values (teacher_id,'Professor fictício',false,false),
         (student_a,'Aluno fictício A',true,false),
         (student_b,'Aluno fictício B',true,false);

  insert into public.exercises (title) values ('Leitura fictícia')
    returning id into reading_id;
  insert into public.exercises (title) values ('Writing fictício')
    returning id into writing_id;
  insert into public.exercises (title) values ('Gramática fictícia')
    returning id into grammar_id;

  if (select activity_type from public.exercises where id=reading_id) <> 'reading' or
     (select activity_type from public.exercises where id=writing_id) <> 'writing' or
     (select activity_type from public.exercises where id=grammar_id) <> 'grammar' then
    raise exception 'Sequência Reading, Writing, Grammar divergente.';
  end if;

  insert into public.exercise_versions
    (exercise_id,version_number,content,status,approved_by,approved_at)
  values (reading_id,1,'{"passage":"Hello world."}'::jsonb,'approved',teacher_id,now())
  returning id into reading_version;

  for i in 1..10 loop
    insert into public.exercise_questions
      (version_id,position,question_type,prompt,options,answer_key,points)
    values (reading_version,i,'short_answer','Question '||i,'[]'::jsonb,
      case when i = 1 then '{"accepted":["Hello World","Hi world"]}'::jsonb
           when i = 2 then '{"accepted":["correct"]}'::jsonb
           else '{"accepted":["OK"]}'::jsonb end,
      case when i=1 then 2 else 1 end);
  end loop;

  insert into public.exercise_versions
    (exercise_id,version_number,content,status,approved_by,approved_at)
  values (writing_id,1,'{"prompt":"Write about a recent school day."}'::jsonb,
    'approved',teacher_id,now()) returning id into writing_version;

  insert into public.exercise_versions
    (exercise_id,version_number,content,status,approved_by,approved_at)
  values (grammar_id,1,'{"explanation":"Present tense."}'::jsonb,'approved',teacher_id,now())
  returning id into grammar_version;
  insert into public.exercise_questions
    (version_id,position,question_type,prompt,options,answer_key,points)
  values (grammar_version,1,'multiple_choice','Choose one',
    '["go","goes"]','{"accepted":["goes"]}',1);

  update public.exercises set status='published',
    published_version_id=reading_version,approved_by=teacher_id,published_at=now()
    where id=reading_id;
  update public.exercises set status='published',
    published_version_id=writing_version,approved_by=teacher_id,published_at=now()
    where id=writing_id;
  update public.exercises set status='published',
    published_version_id=grammar_version,approved_by=teacher_id,published_at=now()
    where id=grammar_id;

  insert into public.exercise_assignments (exercise_id,version_id,student_id)
  values (reading_id,reading_version,student_a) returning id into reading_assignment;
  insert into public.exercise_assignments (exercise_id,version_id,student_id)
  values (grammar_id,grammar_version,student_b) returning id into grammar_assignment;
  insert into public.exercise_assignments (exercise_id,version_id,student_id)
  values (writing_id,writing_version,student_a) returning id into writing_assignment;

  select jsonb_agg(jsonb_build_object(
      'question_id', q.id,
      'response', case when q.position=1 then '  HELLO    WORLD '
                       when q.position=2 then 'incorrect'
                       else 'ok' end
    ) order by q.position)
    into reading_payload
  from public.exercise_questions q where q.version_id=reading_version;

  -- O bloqueio global sempre prevalece, mesmo com sessão/perfil válido.
  failed := false;
  begin
    perform public.homework_submit(student_a,reading_assignment,submission_key,reading_payload);
  exception when sqlstate '42501' then failed := true;
  end;
  if not failed then raise exception 'Bloqueio global não impediu envio.'; end if;

  -- Liberação transitória SOMENTE na transação revertida do CI.
  update public.homework_release_control set enabled=true where id=1;
  failed := false;
  begin
    perform public.homework_submit(student_a,reading_assignment,submission_key,reading_payload);
  exception when sqlstate '42501' then failed := true;
  end;
  if not failed then raise exception 'Atribuição held aceitou envio.'; end if;

  update public.exercise_assignments set status='assigned'
    where id in (reading_assignment,writing_assignment,grammar_assignment);

  -- Impedir tentativa de ler/responder atividade de outro aluno.
  failed := false;
  begin
    perform public.homework_submit(student_b,reading_assignment,submission_key,reading_payload);
  exception when sqlstate '42501' then failed := true;
  end;
  if not failed then raise exception 'Aluno B conseguiu enviar tarefa do aluno A.'; end if;

  -- Questionário incompleto deve falhar atomicamente.
  failed := false;
  begin
    perform public.homework_submit(student_a,reading_assignment,submission_key,
      '[]'::jsonb);
  exception when others then failed := true;
  end;
  if not failed then raise exception 'Questionário vazio foi aceito.'; end if;
  if exists(select 1 from public.exercise_attempts where assignment_id=reading_assignment) then
    raise exception 'Falha de validação deixou tentativa gravada.';
  end if;

  -- Comparação por gabarito: normalização de caixa e espaços; nota ponderada.
  output := public.homework_submit(student_a,reading_assignment,submission_key,reading_payload);
  if output->>'status' <> 'evaluated' or (output->>'score')::numeric <> 9.09 or
     (output->>'activity_type') <> 'reading' or (output->>'pending_review') <> '0' then
    raise exception 'Resultado Reading incorreto: %',output;
  end if;
  seen := (output->>'attempt_id')::uuid;
  if (select count(*) from public.exercise_answers where attempt_id=seen and score=0) <> 1 or
     (select count(*) from public.exercise_answers where attempt_id=seen and score=10) <> 9 or
     (select count(*) from public.exercise_feedback where attempt_id=seen and source='automatic') <> 1 then
    raise exception 'Pontuação por questão/feedback automático inconsistente.';
  end if;

  -- A mesma chave é reutilizável, mas uma chave diferente não duplica a entrega.
  output := public.homework_submit(student_a,reading_assignment,submission_key,reading_payload);
  if output->>'reused' <> 'true' or (output->>'attempt_id')::uuid <> seen then
    raise exception 'Idempotência não preservou a tentativa original.';
  end if;
  failed := false;
  begin
    perform public.homework_submit(student_a,reading_assignment,second_key,reading_payload);
  exception when others then failed := true;
  end;
  if not failed then raise exception 'Reenvio com chave diferente criou nova tentativa.'; end if;

  select jsonb_build_array(jsonb_build_object('question_id',q.id,'response','goes'))
    into grammar_payload
  from public.exercise_questions q where q.version_id=grammar_version;
  output := public.homework_submit(student_b,grammar_assignment,second_key,grammar_payload);
  if output->>'status' <> 'evaluated' or (output->>'score')::numeric <> 10 then
    raise exception 'Grammar correto não recebeu nota 10: %',output;
  end if;

  -- Sem revisão manual: uma alternativa errada é sempre 0.
  if (select count(*) from public.exercise_attempts where status='submitted') <> 0 then
    raise exception 'Reading/Grammar deixaram tentativas pendentes.';
  end if;
  -- A mesma RPC real persiste Writing sem nota; a IA só é acionada pela
  -- Edge Function, portanto esta prova usa um feedback simulado sem HTTP.
  output := public.homework_submit(student_a,writing_assignment,writing_key,
    '{"text":"Yesterday I goes to school with my friends."}'::jsonb);
  if output->>'activity_type' <> 'writing' or output->>'status' <> 'submitted'
     or output->>'score' is not null then
    raise exception 'Writing recebeu nota indevida na submissão: %',output;
  end if;
  writing_attempt := (output->>'attempt_id')::uuid;
  if (select count(*) from public.exercise_answers
      where attempt_id=writing_attempt and question_id is null) <> 1 then
    raise exception 'Texto Writing original não foi persistido.';
  end if;

  -- Apenas uma avaliação por vez pode obter lease e ler o original.
  output := public.homework_claim_writing(student_a,writing_attempt);
  if output->>'status' <> 'claimed'
    or output->>'text' <> 'Yesterday I goes to school with my friends.'
    or output->>'prompt' <> 'Write about a recent school day.' then
    raise exception 'Lease Writing não retornou texto/enunciado aprovados: %', output;
  end if;
  writing_token := (output->>'token')::uuid;
  -- Somente quem possui o lease real pode reservar orçamento.
  output := public.homework_ai_budget_reserve(writing_attempt,writing_token);
  if output->>'allowed' <> 'true' or
     (output->>'reserved_micro_usd')::bigint <> 4700 then
    raise exception 'Orçamento Writing não reservou a chamada: %',output;
  end if;
  output := public.homework_ai_budget_reserve(writing_attempt,writing_token);
  if output->>'reused' <> 'true' then
    raise exception 'Reserva por token repetido criou gasto duplicado: %',output;
  end if;
  output := public.homework_ai_budget_settle(writing_attempt,writing_token,1000,200);
  if output->>'settled' <> 'true' or
     (output->>'charged_micro_usd')::bigint <> 200 then
    raise exception 'Uso real de tokens não foi reconciliado: %',output;
  end if;
  output := public.homework_ai_budget_settle(writing_attempt,writing_token,1000,200);
  if output->>'reused' <> 'true' then
    raise exception 'Liquidação repetida não foi idempotente: %',output;
  end if;
  if (select spent_micro_usd from public.homework_ai_budget_months limit 1) <> 200
    or (select reserved_micro_usd from public.homework_ai_budget_months limit 1) <> 0 then
    raise exception 'Contabilidade mensal inesperada.';
  end if;

  output := public.homework_claim_writing(student_a,writing_attempt);
  if output->>'status' <> 'processing' then
    raise exception 'Lease concorrente não foi recusado: %',output;
  end if;

  -- Token forjado ou de uma concessão antiga não pode fechar a avaliação.
  failed := false;
  begin
    perform public.homework_complete_writing(student_a,writing_attempt,
      '09000000-0000-4000-8000-000000000099'::uuid,
      8,'Um texto fictício com conteúdo compreensível.',
      'Yesterday I went to school with my friends.',
      '["Use went no passado."]'::jsonb,'test-provider');
  exception when sqlstate '42501' then failed := true;
  end;
  if not failed then raise exception 'Token inválido concluiu a correção.'; end if;

  -- A queda do provedor devolve status submitted, sem perder a resposta.
  perform public.homework_release_writing_lease(student_a,writing_attempt,writing_token);
  if (select status from public.exercise_attempts where id=writing_attempt) <> 'submitted' then
    raise exception 'Falha de Writing não recuperou a tentativa.';
  end if;
  output := public.homework_claim_writing(student_a,writing_attempt);
  if output->>'status' <> 'claimed' or (output->>'token')::uuid = writing_token then
    raise exception 'Retomada Writing não criou um novo lease: %',output;
  end if;
  writing_token := (output->>'token')::uuid;

  -- Simula avanço do consumo mensal sem realizar nenhuma requisição à IA.
  update public.homework_ai_budget_months set spent_micro_usd=3996000;
  output := public.homework_ai_budget_reserve(writing_attempt,writing_token);
  if output->>'allowed' <> 'true' or
     not (select alert_80_sent from public.homework_ai_budget_months limit 1) then
    raise exception 'Aviso de 80%% não foi marcado ao cruzar US$ 4: %',output;
  end if;
  perform public.homework_ai_budget_settle(writing_attempt,writing_token,1000,200);

  -- Nova concessão ao atingir o teto: bloqueia antes de gerar despesas.
  update public.homework_ai_budget_months set spent_micro_usd=4997000;
  update public.exercise_attempts
    set evaluation_token='09000000-0000-4000-8000-000000000097'::uuid
    where id=writing_attempt;
  output := public.homework_ai_budget_reserve(writing_attempt,
    '09000000-0000-4000-8000-000000000097'::uuid);
  if output->>'allowed' <> 'false'
    or output->>'reason' <> 'monthly_budget_exceeded'
    or not (select alert_cap_sent from public.homework_ai_budget_months limit 1) then
    raise exception 'Teto mensal US$ 5 não bloqueou a avaliação: %',output;
  end if;
  if (select count(*) from public.homework_ai_budget_calls) <> 2 then
    raise exception 'Bloqueio criou reserva indevida.';
  end if;
  update public.exercise_attempts set evaluation_token=writing_token
    where id=writing_attempt;

  output := public.homework_complete_writing(student_a,writing_attempt,writing_token,
    8,'Um texto fictício com conteúdo compreensível.',
    'Yesterday I went to school with my friends.',
    '["Use went no passado."]'::jsonb,'test-provider');
  if output->>'source' <> 'ai' or (output->>'score')::numeric <> 8
     or output->>'original_text' <> 'Yesterday I goes to school with my friends.'
     or (select status from public.exercise_attempts where id=writing_attempt) <> 'evaluated' then
    raise exception 'Correção Writing não concluiu corretamente: %',output;
  end if;
  if (select count(*) from public.exercise_feedback
      where attempt_id=writing_attempt and source='ai') <> 1 then
    raise exception 'Feedback IA não foi persistido unicamente.';
  end if;
  failed := false;
  begin
    perform public.homework_complete_writing(student_a,writing_attempt,writing_token,
      8,'Correção duplicada não deve acontecer.',
      'Yesterday I went to school with my friends.',
      '[]'::jsonb,'test-provider');
  exception when sqlstate '42501' then failed := true;
  end;
  if not failed then raise exception 'Token já consumido gerou avaliação duplicada.'; end if;

  -- Retry idempotente e sem segunda nota. Nova chave permanece recusada.
  output := public.homework_submit(student_a,writing_assignment,writing_key,
    '{"text":"Yesterday I goes to school with my friends."}'::jsonb);
  if output->>'reused' <> 'true' or output->>'status' <> 'evaluated'
     or (output->>'score')::numeric <> 8 then
    raise exception 'Reenvio Writing não recuperou a nota armazenada: %',output;
  end if;
  failed := false;
  begin
    perform public.homework_submit(student_a,writing_assignment,second_key,
      '{"text":"Yesterday I goes to school with my friends."}'::jsonb);
  exception when others then failed := true;
  end;
  if not failed then raise exception 'Writing criou segunda tentativa oficial.'; end if;

  -- Recurso bloqueado impede reivindicar até tentativas válidas já salvas.
  update public.homework_release_control set enabled=false where id=1;
  failed := false;
  begin
    perform public.homework_claim_writing(student_a,writing_attempt);
  exception when sqlstate '42501' then failed := true;
  end;
  if not failed then raise exception 'A trava global não bloqueou a correção.'; end if;
  update public.homework_release_control set enabled=true where id=1;

  if (select count(*) from public.exercise_attempts) <> 3 then
    raise exception 'Quantidade de tentativas Reading/Writing/Grammar inesperada.';
  end if;
end;
$homework_cases$;

-- RLS real da role de navegador: aluno A não enxerga tentativa de B.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '09000000-0000-4000-8000-000000000002';
SET LOCAL request.jwt.claims = '{"sub":"09000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}';

DO $student_a_rls$
declare exported jsonb;
begin
  exported := public.get_my_data_export();
  if coalesce(jsonb_array_length(exported->'homework_assignments'), -1) <> 2
    or exported::text not like '%Yesterday I goes to school%'
    or exported::text not like '%Yesterday I went to school%'
    or exported::text like '%answer_key%' then
    raise exception 'Exportação LGPD do aluno A omitiu sua produção ou expôs gabarito.';
  end if;
  if (select count(*) from public.exercise_attempts) <> 2 then
    raise exception 'Aluno A deveria enxergar apenas Reading e Writing próprios.';
  end if;
  if (select count(*) from public.exercise_feedback) <> 2 then
    raise exception 'Aluno A conseguiu ver feedback de terceiros ou perdeu o próprio.';
  end if;
  if exists (select 1 from public.exercise_questions) then
    raise exception 'Gabarito/questões privadas acessíveis sem MFA de professor.';
  end if;
  if has_function_privilege('authenticated',
    'public.homework_submit(uuid,uuid,uuid,jsonb)', 'EXECUTE') then
    raise exception 'RPC de submissão exposta diretamente ao navegador.';
  end if;
  if has_function_privilege('authenticated',
    'public.homework_ai_budget_reserve(uuid,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated',
    'public.homework_ai_budget_settle(uuid,uuid,integer,integer)', 'EXECUTE')
    or has_table_privilege('authenticated', 'public.homework_ai_budget_months', 'SELECT')
    or has_table_privilege('anon', 'public.homework_ai_budget_calls', 'SELECT') then
    raise exception 'Orçamento confidencial acessível ao navegador.';
  end if;
end;
$student_a_rls$;

SET LOCAL request.jwt.claim.sub = '09000000-0000-4000-8000-000000000003';
SET LOCAL request.jwt.claims = '{"sub":"09000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}';

DO $student_b_rls$
declare exported jsonb;
begin
  exported := public.get_my_data_export();
  if coalesce(jsonb_array_length(exported->'homework_assignments'), -1) <> 1
    or exported::text like '%Yesterday I goes to school%'
    or exported::text like '%answer_key%' then
    raise exception 'Exportação LGPD do aluno B expôs resposta de outro estudante ou gabarito.';
  end if;
  if (select count(*) from public.exercise_attempts) <> 1 then
    raise exception 'Aluno B deve ver apenas a própria atividade.';
  end if;
  if exists (select 1 from public.exercise_questions) then
    raise exception 'Aluno B pode ler gabaritos administrativos.';
  end if;
end;
$student_b_rls$;

RESET ROLE;

-- ETAPA 5: política de retenção — nenhum prazo nasce de mero arquivamento.
-- As contas e atividades são inteiramente fictícias; o ROLLBACK preserva produção.
DO $relationship_retention$
declare
  student_a constant uuid := '09000000-0000-4000-8000-000000000002';
  student_b constant uuid := '09000000-0000-4000-8000-000000000003';
  teacher_id constant uuid := '09000000-0000-4000-8000-000000000001';
  eligible_count integer;
  writing_count bigint;
begin
  if to_regclass('public.homework_relationship_events') is null or
     to_regprocedure('public.homework_retention_preview(integer)') is null then
    raise exception 'Fluxo de desligamento formal não está instalado.';
  end if;
  if has_table_privilege('anon', 'public.homework_relationship_events', 'SELECT')
     or has_table_privilege('authenticated', 'public.homework_relationship_events', 'INSERT')
     or has_function_privilege('anon', 'public.homework_retention_preview(integer)', 'EXECUTE')
     or has_function_privilege('anon',
       'public.homework_record_relationship_event(uuid,text)', 'EXECUTE') then
    raise exception 'Histórico administrativo de desligamento está exposto.';
  end if;
  if date '2024-02-29' + interval '12 months' <>
     timestamp '2025-02-28' then
    raise exception 'Intervalo de 12 meses civis não tratou ano bissexto.';
  end if;

  -- Arquivamento de A e B NÃO registra desligamento de forma implícita.
  update public.profiles set archived=true,
    archived_at=now()-interval '14 months'
    where id in (student_a, student_b);
  if exists (select 1 from private.homework_retention_candidates()) then
    raise exception 'Arquivamento isolado antecipou retenção.';
  end if;
  insert into public.homework_relationship_events
    (student_id,event_type,occurred_at,recorded_by)
  values (student_a,'ended',now()-interval '13 months',teacher_id);
  select count(*), max(attempt_count) into eligible_count, writing_count
    from private.homework_retention_candidates();
  if eligible_count <> 1 or writing_count <> 2 then
    raise exception 'Prévia deveria conter só A e duas tentativas.';
  end if;

  -- Encerramento há 11 meses ainda não vence.
  insert into public.homework_relationship_events
    (student_id,event_type,occurred_at,recorded_by)
  values (student_b,'ended',now()-interval '11 months',teacher_id);
  if (select count(*) from private.homework_retention_candidates()) <> 1 then
    raise exception 'Prazo de onze meses não deveria vencer.';
  end if;

  -- Retomada explícita invalida desligamento anterior.
  update public.profiles set archived=false,archived_at=null where id=student_b;
  insert into public.homework_relationship_events
    (student_id,event_type,recorded_by)
  values (student_b,'resumed',teacher_id);
  if (select count(*) from private.homework_retention_candidates()) <> 1 then
    raise exception 'Retomada não preservou exclusão da prévia.';
  end if;

  -- Reativação não registrada, seguida de novo arquivamento, não pode
  -- reutilizar um evento antigo e provocar eliminação prematura.
  update public.profiles set archived=false,archived_at=null where id=student_a;
  if exists(select 1 from private.homework_retention_candidates()) then
    raise exception 'Aluno reativado permaneceu elegível.';
  end if;
  update public.profiles set archived=true,archived_at=now()-interval '1 month'
    where id=student_a;
  if exists(select 1 from private.homework_retention_candidates()) then
    raise exception 'Novo arquivamento reutilizou desligamento antigo.';
  end if;

  if (select count(*) from public.exercise_attempts) <> 3 or
     (select count(*) from public.exercise_feedback) <> 3 then
    raise exception 'Prévia de retenção alterou histórico acadêmico.';
  end if;
end;
$relationship_retention$;

-- Uma sessão comum do estudante não pode registrar encerramentos,
-- consultar prévias com identificadores ou acessar a função interna.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '09000000-0000-4000-8000-000000000002';
SET LOCAL request.jwt.claims = '{"sub":"09000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}';
DO $relationship_student_denied$
declare
  denied boolean := false;
begin
  begin
    perform public.homework_record_relationship_event(
      '09000000-0000-4000-8000-000000000002'::uuid, 'ended');
  exception when sqlstate '42501' then denied := true;
  end;
  if not denied then
    raise exception 'Aluno conseguiu registrar encerramento formal.';
  end if;

  denied := false;
  begin
    perform public.homework_retention_preview(100);
  exception when sqlstate '42501' then denied := true;
  end;
  if not denied then
    raise exception 'Aluno conseguiu acessar prévia de retenção.';
  end if;

  denied := false;
  begin
    perform private.homework_retention_candidates();
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then
    raise exception 'Aluno conseguiu acessar consulta interna de retenção.';
  end if;
end;
$relationship_student_denied$;
RESET ROLE;
-- Garante que nem as identidades fictícias nem a liberação temporária persistam.
ROLLBACK;
