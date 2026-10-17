-- ETAPA 1B: ensaio RLS integrado com o bootstrap canonico local.
-- SOMENTE banco Supabase CLI descartavel; sem dados, conexoes ou segredos de producao.
-- -v ON_ERROR_STOP=1 deve ser aplicado pelo chamador.
begin;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
)
select
  '00000000-0000-0000-0000-000000000000'::uuid,
  case n
    when 1 then '11111111-1111-4111-8111-111111111111'::uuid
    when 2 then '22222222-2222-4222-8222-222222222222'::uuid
    else '33333333-3333-4333-8333-333333333333'::uuid
  end,
  'authenticated', 'authenticated',
  'lesson-stage1b-' || n || '@invalid.test',
  '', now(), now(), now()
from generate_series(1, 3) as n;

insert into public.profiles (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333')
on conflict (id) do nothing;

insert into public.teacher_admins (user_id, email)
values ('33333333-3333-4333-8333-333333333333', 'lesson-stage1b-3@invalid.test');

insert into public.study_lesson_pages (
  id, lesson_number_label, title, objective, example, translation,
  practical_exercise, useful_vocabulary
) values (
  '44444444-4444-4444-8444-444444444444', 'TESTE',
  'Lição sintética', 'Objetivo fictício', 'Example for test only.',
  'Tradução de teste', 'Exercício sintético', 'Vocabulário fictício'
);

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

insert into public.lesson_presentations (
  student_id, lesson_number, body, revision_number, created_at
) values (
  '11111111-1111-4111-8111-111111111111', 12,
  '  Minha primeira apresentação.  ', 999, '2000-01-01'
);

update public.lesson_presentations
set body = 'Minha segunda apresentação.'
where lesson_key = 'lesson:12';

update public.lesson_presentations
set body = 'Minha terceira apresentação.'
where lesson_key = 'lesson:12';

insert into public.lesson_presentations (student_id, lesson_page_id, body)
values (
  '11111111-1111-4111-8111-111111111111',
  '44444444-4444-4444-8444-444444444444',
  'Apresentação da página sem número.'
);

do $test_student$
begin
  if (select revision_number from public.lesson_presentations
      where lesson_key = 'lesson:12') <> 3 then
    raise exception 'Revisões não foram incrementadas.';
  end if;

  if (select count(*) from public.lesson_presentation_versions) <> 4 then
    raise exception 'Histórico de versões incompleto.';
  end if;

  if (select body from public.lesson_presentations
      where lesson_key = 'lesson:12') <> 'Minha terceira apresentação.' then
    raise exception 'Versão atual incorreta.';
  end if;

  if (select created_at::date from public.lesson_presentations
      where lesson_key = 'lesson:12') = '2000-01-01'::date then
    raise exception 'Data enviada pelo cliente foi aceita.';
  end if;

  begin
    insert into public.lesson_presentations (student_id, lesson_number, body)
    values ('11111111-1111-4111-8111-111111111111', 12, 'Duplicata');
    raise exception 'Duplicata aceita.';
  exception when unique_violation then null; end;

  begin
    update public.lesson_presentations set revision_number = 999
    where lesson_key = 'lesson:12';
    raise exception 'Manipulação de revisão aceita.';
  exception when insufficient_privilege then null; end;

  begin
    insert into public.lesson_presentation_versions
      (presentation_id, revision_number, body, saved_at)
    select id, 99, 'Versão falsa', now()
    from public.lesson_presentations where lesson_key = 'lesson:12';
    raise exception 'Histórico editável pelo aluno.';
  exception when insufficient_privilege then null; end;
end;
$test_student$;

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

do $test_other_student$
declare affected integer;
begin
  if (select count(*) from public.lesson_presentations) <> 0
     or (select count(*) from public.lesson_presentation_versions) <> 0 then
    raise exception 'Outro aluno consegue visualizar apresentações.';
  end if;

  update public.lesson_presentations
  set body = 'Tentativa de alteração.'
  where lesson_key = 'lesson:12';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'Outro aluno conseguiu editar a apresentação.';
  end if;

  begin
    insert into public.lesson_presentations (student_id, lesson_number, body)
    values ('11111111-1111-4111-8111-111111111111', 13, 'Impersonação.');
    raise exception 'Outro aluno conseguiu enviar em nome do autor.';
  exception when insufficient_privilege then null; end;
end;
$test_other_student$;

select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);

do $test_teacher$
declare affected integer;
begin
  if not public.is_teacher_admin() then
    raise exception 'Autorização real de professor não reconheceu conta fictícia.';
  end if;

  if (select count(*) from public.lesson_presentations) <> 2
     or (select count(*) from public.lesson_presentation_versions) <> 4 then
    raise exception 'Professor não consegue consultar as apresentações.';
  end if;

  update public.lesson_presentations set body = 'Professor alterou.'
  where lesson_key = 'lesson:12';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'Professor conseguiu alterar o texto do aluno.';
  end if;
end;
$test_teacher$;

set local role anon;
do $test_anon$
begin
  begin
    perform count(*) from public.lesson_presentations;
    raise exception 'Acesso anonimo aceito.';
  exception when insufficient_privilege then null; end;
end;
$test_anon$;

reset role;
select 'LESSON_PRESENTATIONS_STAGE1B_INTEGRATED_RLS_PASSED' as verdict;
rollback;
