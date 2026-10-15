-- TAREFAS PARA CASA — etapa 2. Catalogo totalmente separado dos exercicios legados.
-- Todos os registros sao privados ao professor; nenhuma policy concede leitura a alunos.
create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  exercise_number bigint generated always as identity unique,
  activity_type text generated always as (
    case exercise_number % 3 when 1 then 'reading' when 2 then 'writing' else 'grammar' end
  ) stored,
  title text not null default 'Rascunho' check (char_length(trim(title)) between 1 and 160),
  status text not null default 'draft' check (status in ('draft','published','archived')),
  published_version_id uuid,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  approved_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint homework_published_requires_approval check (
    status <> 'published' or
    (published_version_id is not null and approved_by is not null and published_at is not null)
  )
);

create table public.exercise_versions (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid not null references public.exercises(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  content jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
  status text not null default 'draft' check (status in ('draft','approved')),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (exercise_id, version_number),
  constraint homework_version_approval_consistent check (
    (status = 'draft' and approved_at is null and approved_by is null) or
    (status = 'approved' and approved_at is not null and approved_by is not null)
  )
);

alter table public.exercises
  add constraint exercises_published_version_fk
  foreign key (published_version_id) references public.exercise_versions(id)
  deferrable initially immediate;

create table public.exercise_questions (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.exercise_versions(id) on delete cascade,
  position integer not null check (position > 0),
  question_type text not null check (question_type in ('short_answer','multiple_choice')),
  prompt text not null check (char_length(trim(prompt)) between 1 and 2000),
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  answer_key jsonb,
  explanation text,
  points numeric(6,2) not null default 1 check (points > 0 and points <= 100),
  unique (version_id, position)
);

create table public.exercise_assignments (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid not null references public.exercises(id),
  version_id uuid not null references public.exercise_versions(id),
  student_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'held' check (status = 'held'),
  due_at timestamptz,
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (student_id, exercise_id)
);

create table public.exercise_attempts (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.exercise_assignments(id) on delete cascade,
  version_id uuid not null references public.exercise_versions(id),
  student_id uuid not null references public.profiles(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  status text not null default 'draft' check (status in ('draft','submitted','evaluated')),
  score numeric(4,2) check (score between 0 and 10),
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  evaluated_at timestamptz,
  unique (assignment_id, attempt_number)
);

create table public.exercise_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.exercise_attempts(id) on delete cascade,
  question_id uuid references public.exercise_questions(id),
  answer jsonb not null default '{}'::jsonb,
  score numeric(4,2) check (score between 0 and 10),
  saved_at timestamptz not null default now(),
  unique (attempt_id, question_id)
);

create table public.exercise_feedback (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.exercise_attempts(id) on delete cascade,
  answer_id uuid references public.exercise_answers(id) on delete cascade,
  source text not null check (source in ('ai','teacher','automatic')),
  score numeric(4,2) not null check (score between 0 and 10),
  general_comment text not null,
  original_text text,
  corrected_text text,
  explanations jsonb not null default '[]'::jsonb check (jsonb_typeof(explanations) = 'array'),
  evaluator_model text,
  created_at timestamptz not null default now()
);

create index exercise_versions_exercise_idx on public.exercise_versions(exercise_id, version_number desc);
create index exercise_questions_version_idx on public.exercise_questions(version_id, position);
create index exercise_assignments_student_idx on public.exercise_assignments(student_id);
create index exercise_attempts_student_idx on public.exercise_attempts(student_id, started_at desc);
create index exercise_feedback_attempt_idx on public.exercise_feedback(attempt_id);

-- Evita que um exercicio publicado aponte para versao de outro exercicio,
-- ou para conteudo nao aprovado. Rascunhos publicados ficam congelados.
create function public.homework_guard_publication()
returns trigger language plpgsql set search_path = ''
as $guard$
declare
  checked_version record;
begin
  if old.status = 'published' and (
    new.status <> 'published' or
    new.published_version_id is distinct from old.published_version_id or
    new.title is distinct from old.title
  ) then
    raise exception 'Uma atividade publicada nao pode ser alterada; crie uma nova versao em outra atividade.';
  end if;
  if new.status = 'published' then
    select v.exercise_id, v.status, v.approved_by into checked_version
      from public.exercise_versions v where v.id = new.published_version_id;
    if not found or checked_version.exercise_id is distinct from new.id
      or checked_version.status <> 'approved'
      or checked_version.approved_by is distinct from new.approved_by then
      raise exception 'A publicacao exige versao aprovada deste exercicio.';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$guard$;

create trigger homework_publication_guard before update on public.exercises
for each row execute function public.homework_guard_publication();

-- Evita alteracao de questoes de uma versao aprovada ou publicada.
create function public.homework_guard_question_mutation()
returns trigger language plpgsql set search_path = ''
as $guard$
declare
  v_status text;
begin
  select v.status into v_status from public.exercise_versions v
    where v.id = coalesce(old.version_id, new.version_id);
  if v_status <> 'draft' or v_status is null then
    raise exception 'Questoes de versoes aprovadas nao podem ser editadas.';
  end if;
  return coalesce(new, old);
end;
$guard$;

create trigger homework_question_guard before update or delete on public.exercise_questions
for each row execute function public.homework_guard_question_mutation();

-- Aprovacao congela o texto da versao. Nao se edita conteudo ja avaliado.
create function public.homework_guard_version_mutation()
returns trigger language plpgsql set search_path = ''
as $guard$
begin
  if old.status = 'approved' and (
    tg_op = 'DELETE' or
    new.content is distinct from old.content or
    new.status is distinct from old.status
  ) then
    raise exception 'Versao aprovada e imutavel.';
  end if;
  return coalesce(new, old);
end;
$guard$;

create trigger homework_version_guard before update or delete on public.exercise_versions
for each row execute function public.homework_guard_version_mutation();

-- Criacao sequencial e exclusiva de rascunhos. O banco atribui o numero.
create function public.homework_create_draft()
returns public.exercises language plpgsql set search_path = ''
as $function$
declare
  created public.exercises;
begin
  if not (select public.is_teacher_admin()) then
    raise exception 'Acesso exclusivo ao professor.' using errcode = '42501';
  end if;
  insert into public.exercises default values returning * into created;
  update public.exercises
    set title = 'ATIVIDADE ' || created.exercise_number || ' — ' ||
      case created.activity_type when 'reading' then 'Reading'
        when 'writing' then 'Writing' else 'Grammar' end
    where id = created.id returning * into created;
  return created;
end;
$function$;

-- Cada salvamento gera nova versao: sem sobrescrever snapshots anteriores.
create function public.homework_save_version(
  p_exercise_id uuid, p_title text, p_content jsonb, p_questions jsonb
)
returns uuid language plpgsql set search_path = ''
as $function$
declare
  target public.exercises;
  new_version_id uuid;
  next_version integer;
  question jsonb;
  question_index integer := 0;
begin
  if not (select public.is_teacher_admin()) then
    raise exception 'Acesso exclusivo ao professor.' using errcode = '42501';
  end if;
  select * into target from public.exercises where id = p_exercise_id for update;
  if not found or target.status <> 'draft' then
    raise exception 'Apenas rascunhos podem ser editados.';
  end if;
  if nullif(trim(p_title), '') is null or char_length(trim(p_title)) > 160 or
    jsonb_typeof(p_content) is distinct from 'object' or
    jsonb_typeof(p_questions) is distinct from 'array' or
    jsonb_array_length(p_questions) > 40 then
    raise exception 'Titulo, conteudo ou lista de questoes invalida.';
  end if;
  if target.activity_type = 'reading' and
       nullif(trim(p_content->>'passage'), '') is null then
    raise exception 'Reading precisa de um texto.';
  elsif target.activity_type = 'writing' and
       nullif(trim(p_content->>'prompt'), '') is null then
    raise exception 'Writing precisa de um enunciado.';
  elsif target.activity_type = 'grammar' and
       nullif(trim(p_content->>'explanation'), '') is null then
    raise exception 'Grammar precisa de uma explicacao.';
  end if;
  select coalesce(max(version_number), 0) + 1 into next_version
    from public.exercise_versions where exercise_id = p_exercise_id;
  insert into public.exercise_versions (exercise_id, version_number, content)
    values (p_exercise_id, next_version, p_content) returning id into new_version_id;
  for question in select value from jsonb_array_elements(p_questions) loop
    question_index := question_index + 1;
    if nullif(trim(question->>'prompt'), '') is null or
      coalesce(question->>'type','short_answer') not in ('short_answer','multiple_choice') then
      raise exception 'Questao % invalida.', question_index;
    end if;
    insert into public.exercise_questions
      (version_id, position, prompt, question_type, options, answer_key, explanation)
    values (
      new_version_id, question_index, question->>'prompt',
      coalesce(question->>'type','short_answer'),
      coalesce(question->'options', '[]'::jsonb),
      question->'answer_key', question->>'explanation'
    );
  end loop;
  update public.exercises set title = trim(p_title) where id = p_exercise_id;
  return new_version_id;
end;
$function$;

create function public.homework_approve_version(p_version_id uuid)
returns void language plpgsql set search_path = ''
as $function$
declare
  selected public.exercise_versions;
  target public.exercises;
  question_total integer;
  unanswered integer;
begin
  if not (select public.is_teacher_admin()) then
    raise exception 'Acesso exclusivo ao professor.' using errcode = '42501';
  end if;
  select * into selected from public.exercise_versions where id = p_version_id for update;
  if not found or selected.status <> 'draft' then
    raise exception 'Versao indisponivel para aprovacao.';
  end if;
  select * into target from public.exercises where id = selected.exercise_id for update;
  if target.status <> 'draft' then
    raise exception 'A atividade nao esta em rascunho.';
  end if;
  select count(*),count(*) filter (where answer_key is null)
    into question_total, unanswered from public.exercise_questions
    where version_id = p_version_id;
  if (target.activity_type = 'reading' and question_total <> 10)
    or (target.activity_type = 'writing' and question_total <> 0)
    or (target.activity_type = 'grammar' and question_total < 1)
    or (target.activity_type <> 'writing' and unanswered > 0) then
    raise exception 'Revise a quantidade de questoes e o gabarito antes de aprovar.';
  end if;
  update public.exercise_versions set status = 'approved',
    approved_by = auth.uid(), approved_at = now() where id = p_version_id;
end;
$function$;

create function public.homework_publish(p_version_id uuid)
returns void language plpgsql set search_path = ''
as $function$
declare
  selected public.exercise_versions;
begin
  if not (select public.is_teacher_admin()) then
    raise exception 'Acesso exclusivo ao professor.' using errcode = '42501';
  end if;
  select * into selected from public.exercise_versions where id = p_version_id for update;
  if not found or selected.status <> 'approved' then
    raise exception 'A versao precisa ser aprovada pelo professor.';
  end if;
  update public.exercises set status = 'published',
    published_version_id = selected.id, approved_by = selected.approved_by,
    published_at = now()
  where id = selected.exercise_id and status = 'draft';
  if not found then
    raise exception 'Esta atividade nao esta mais em rascunho.';
  end if;
  -- Publicado no cadastro do professor; atribuicao e acesso de alunos seguem desativados.
end;
$function$;

-- Autorizacao efetiva no banco para todas as sete entidades.
do $policies$
declare
  table_name text;
begin
  foreach table_name in array array[
    'exercises','exercise_versions','exercise_questions','exercise_assignments',
    'exercise_attempts','exercise_answers','exercise_feedback'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
    execute format(
      'create policy homework_teacher_only on public.%I for all to authenticated using ((select public.is_teacher_admin())) with check ((select public.is_teacher_admin()))',
      table_name
    );
  end loop;
end;
$policies$;

-- Somente professor logado le e edita o catalogo. Resultados e respostas sao server-only.
grant select, insert, update on public.exercises to authenticated;
grant select, insert, update on public.exercise_versions to authenticated;
grant select, insert on public.exercise_questions to authenticated;
grant usage, select on sequence public.exercises_exercise_number_seq to authenticated;

revoke all on function public.homework_guard_publication() from public,anon,authenticated;
revoke all on function public.homework_guard_question_mutation() from public,anon,authenticated;
revoke all on function public.homework_guard_version_mutation() from public,anon,authenticated;
revoke all on function public.homework_create_draft() from public,anon,authenticated;
revoke all on function public.homework_save_version(uuid,text,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.homework_approve_version(uuid) from public,anon,authenticated;
revoke all on function public.homework_publish(uuid) from public,anon,authenticated;
grant execute on function public.homework_create_draft() to authenticated;
grant execute on function public.homework_save_version(uuid,text,jsonb,jsonb) to authenticated;
grant execute on function public.homework_approve_version(uuid) to authenticated;
grant execute on function public.homework_publish(uuid) to authenticated;

comment on table public.exercises is 'TAREFAS PARA CASA: catalogo privado, sem acesso estudantil ate liberacao explicita.';
comment on table public.exercise_feedback is 'Historico de correcao; IA sera implementada numa etapa posterior, exclusivamente no servidor.';
