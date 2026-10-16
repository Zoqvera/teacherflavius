-- TAREFAS PARA CASA — fixture de HTTP E2E no Supabase local DESCARTÁVEL.
-- Somente no CI; nunca executar num projeto remoto. Nenhum e-mail é disparado.
\set ON_ERROR_STOP on

DO $preflight$
begin
  if current_database() <> 'postgres' or
    not exists (select 1 from public.homework_release_control where id=1 and enabled=false) or
    exists (select 1 from public.exercises) then
    raise exception 'HTTP E2E exige banco local limpo e liberação desligada.';
  end if;
end;
$preflight$;

insert into public.profiles (id,name,enrolled,archived,date_of_birth)
values
  (:'student_a'::uuid,'HTTP E2E - Aluno fictício A',true,false,'1990-03-04'::date),
  (:'student_b'::uuid,'HTTP E2E - Aluno fictício B',true,false,'1992-05-06'::date)
on conflict(id) do update
  set name=excluded.name,enrolled=true,archived=false,
      date_of_birth=excluded.date_of_birth;

-- Only disposable synthetic adult A is entitled to contact the test provider.
-- The approval is administrative, not inferred from editable profiles.
insert into public.homework_writing_age_verifications (student_id, verified_adult)
values (:'student_a'::uuid,true), (:'student_b'::uuid,true)
on conflict (student_id) do update set verified_adult=excluded.verified_adult;

-- Um teste anterior faz ROLLBACK; seu incremento de identity não retrocede.
select setval('public.exercises_exercise_number_seq'::regclass,1,false);
insert into public.exercises (id,title)
values
  ('25000000-0000-4000-8000-000000000001','Leitura HTTP fictícia'),
  ('25000000-0000-4000-8000-000000000002','Writing HTTP fictício'),
  ('25000000-0000-4000-8000-000000000003','Gramática HTTP fictícia');

DO $types$
begin
  if (select string_agg(activity_type,',' order by exercise_number)
      from public.exercises) <> 'reading,writing,grammar' then
    raise exception 'Sequência de atividades incorreta no HTTP E2E.';
  end if;
end;
$types$;

insert into public.exercise_versions
  (id,exercise_id,version_number,content,status,approved_by,approved_at)
values
  ('25000000-0000-4000-8000-000000000011',
   '25000000-0000-4000-8000-000000000001',1,
   '{"passage":"The class starts at nine.", "secret_answer":"never-disclose"}',
   'approved',:'student_a'::uuid,now()),
  ('25000000-0000-4000-8000-000000000012',
   '25000000-0000-4000-8000-000000000002',1,
   '{"prompt":"Describe your last school day in English."}',
   'approved',:'student_a'::uuid,now()),
  ('25000000-0000-4000-8000-000000000013',
   '25000000-0000-4000-8000-000000000003',1,
   '{"explanation":"Simple present examples."}',
   'approved',:'student_a'::uuid,now());

insert into public.exercise_questions
  (version_id,position,question_type,prompt,answer_key,points)
select
  '25000000-0000-4000-8000-000000000011',n,'short_answer',
  'Reading question '||n, '{"correct":"yes"}'::jsonb,1
from generate_series(1,10) n;

insert into public.exercise_questions
  (version_id,position,question_type,prompt,options,answer_key,points)
values ('25000000-0000-4000-8000-000000000013',1,'multiple_choice',
  'She ____ English.', '["study","studies"]','{"correct":"studies"}',1);

update public.exercises
set published_version_id=case exercise_number
    when 1 then '25000000-0000-4000-8000-000000000011'::uuid
    when 2 then '25000000-0000-4000-8000-000000000012'::uuid
    else '25000000-0000-4000-8000-000000000013'::uuid end,
    status='published', approved_by=:'student_a'::uuid, published_at=now();

insert into public.exercise_assignments (id,exercise_id,version_id,student_id,status)
values
  ('25000000-0000-4000-8000-000000000021',
   '25000000-0000-4000-8000-000000000001',
   '25000000-0000-4000-8000-000000000011',:'student_a'::uuid,'assigned'),
  ('25000000-0000-4000-8000-000000000022',
   '25000000-0000-4000-8000-000000000002',
   '25000000-0000-4000-8000-000000000012',:'student_a'::uuid,'assigned'),
  ('25000000-0000-4000-8000-000000000023',
   '25000000-0000-4000-8000-000000000003',
   '25000000-0000-4000-8000-000000000013',:'student_b'::uuid,'assigned');
