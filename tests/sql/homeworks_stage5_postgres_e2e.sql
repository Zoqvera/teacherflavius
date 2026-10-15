-- ETAPA 5: teste integrado exclusivamente em Postgres descartável do CI.
-- Nunca executar em produção. Todas as alterações ficam em uma transação revertida.
\set ON_ERROR_STOP on
BEGIN;

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
  reading_id uuid;
  writing_id uuid;
  grammar_id uuid;
  reading_version uuid;
  grammar_version uuid;
  reading_assignment uuid;
  grammar_assignment uuid;
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
    published_version_id=grammar_version,approved_by=teacher_id,published_at=now()
    where id=grammar_id;

  insert into public.exercise_assignments (exercise_id,version_id,student_id)
  values (reading_id,reading_version,student_a) returning id into reading_assignment;
  insert into public.exercise_assignments (exercise_id,version_id,student_id)
  values (grammar_id,grammar_version,student_b) returning id into grammar_assignment;

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
    where id in (reading_assignment,grammar_assignment);

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
  if (select count(*) from public.exercise_attempts) <> 2 then
    raise exception 'Quantidade de tentativas inesperada.';
  end if;
end;
$homework_cases$;

-- RLS real da role de navegador: aluno A não enxerga tentativa de B.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '09000000-0000-4000-8000-000000000002';
SET LOCAL request.jwt.claims = '{"sub":"09000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}';

DO $student_a_rls$
begin
  if (select count(*) from public.exercise_attempts) <> 1 then
    raise exception 'Aluno A deveria enxergar apenas a própria tentativa.';
  end if;
  if (select count(*) from public.exercise_feedback) <> 1 then
    raise exception 'Aluno A conseguiu ver feedback de terceiros ou perdeu o próprio.';
  end if;
  if exists (select 1 from public.exercise_questions) then
    raise exception 'Gabarito/questões privadas acessíveis sem MFA de professor.';
  end if;
  if has_function_privilege('authenticated',
    'public.homework_submit(uuid,uuid,uuid,jsonb)', 'EXECUTE') then
    raise exception 'RPC de submissão exposta diretamente ao navegador.';
  end if;
end;
$student_a_rls$;

SET LOCAL request.jwt.claim.sub = '09000000-0000-4000-8000-000000000003';
SET LOCAL request.jwt.claims = '{"sub":"09000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}';

DO $student_b_rls$
begin
  if (select count(*) from public.exercise_attempts) <> 1 then
    raise exception 'Aluno B deve ver apenas a própria atividade.';
  end if;
  if exists (select 1 from public.exercise_questions) then
    raise exception 'Aluno B pode ler gabaritos administrativos.';
  end if;
end;
$student_b_rls$;

RESET ROLE;
-- Garante que nem as identidades fictícias nem a liberação temporária persistam.
ROLLBACK;
