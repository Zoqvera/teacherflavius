-- Etapa 4/5: fluxo integral de apresentacoes (dados e identidades sinteticos).
-- Apenas Supabase local descartavel. O teste inteiro termina em ROLLBACK.
begin;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
)
select '00000000-0000-0000-0000-000000000000'::uuid,
  case value
    when 1 then '11111111-1111-4111-8111-111111111111'::uuid
    when 2 then '22222222-2222-4222-8222-222222222222'::uuid
    when 3 then '33333333-3333-4333-8333-333333333333'::uuid
    else '44444444-4444-4444-8444-444444444444'::uuid
  end, 'authenticated', 'authenticated',
  'lesson-stage4-' || value || '@invalid.test',
  '', now(), now(), now()
from generate_series(1, 4) value;

insert into public.profiles (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333'),
  ('44444444-4444-4444-8444-444444444444')
on conflict (id) do nothing;

insert into public.teacher_admins (user_id, email) values
  ('33333333-3333-4333-8333-333333333333', 'lesson-stage4-3@invalid.test'),
  ('44444444-4444-4444-8444-444444444444', 'lesson-stage4-4@invalid.test');

insert into public.study_lesson_pages (
  id, lesson_number_label, title, objective, example, translation,
  practical_exercise, useful_vocabulary
) values (
  '55555555-5555-4555-8555-555555555555', 'TESTE 4',
  'Pagina sintetica', 'Objetivo ficticio', 'Example for test.',
  'Traducao ficticia', 'Exercicio ficticio', 'Vocabulario ficticio'
);

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

-- Mesma identidade numerica para rota direta e pagina vinculada.
insert into public.lesson_presentations (student_id, lesson_number, body)
values (
  '11111111-1111-4111-8111-111111111111', 12,
  '  Apresentacao inicial do aluno um.  '
);

-- Pagina nao numerada mantem uma chave independente.
insert into public.lesson_presentations (student_id, lesson_page_id, body)
values (
  '11111111-1111-4111-8111-111111111111',
  '55555555-5555-4555-8555-555555555555',
  'Apresentacao avulsa.'
);

do $student_first_save$
begin
  if (select count(*) from public.lesson_presentations
      where student_id = auth.uid()) <> 2 then
    raise exception 'O aluno nao criou duas apresentacoes independentes.';
  end if;
  if (select count(*) from public.lesson_presentation_versions
      where presentation_id in (
        select id from public.lesson_presentations where student_id = auth.uid()
      )) <> 2 then
    raise exception 'A primeira versao nao foi registrada.';
  end if;
  if (select body from public.lesson_presentations
      where lesson_key = 'lesson:12') <> 'Apresentacao inicial do aluno um.' then
    raise exception 'O texto do aluno nao foi normalizado.';
  end if;
  if (select count(*) from public.lesson_presentation_views) <> 0 then
    raise exception 'Houve visualizacao sem a acao do professor.';
  end if;
end;
$student_first_save$;

-- Outro aluno com a mesma licao nao deve substituir nem ver a primeira.
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

do $second_student_cannot_read$
begin
  if (select count(*) from public.lesson_presentations) <> 0
     or (select count(*) from public.lesson_presentation_versions) <> 0
     or (select count(*) from public.lesson_presentation_views) <> 0 then
    raise exception 'Isolamento de alunos quebrado.';
  end if;
end;
$second_student_cannot_read$;

insert into public.lesson_presentations (student_id, lesson_number, body)
values (
  '22222222-2222-4222-8222-222222222222', 12,
  'Apresentacao independente do aluno dois.'
);

-- Professor le o texto, mas leitura so nao grava recibo.
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);

do $teacher_receives$
declare presentation_uuid uuid;
begin
  if not public.is_teacher_admin() then
    raise exception 'Conta docente sintetica nao autorizada.';
  end if;
  if (select count(*) from public.lesson_presentations) <> 3 then
    raise exception 'Professor nao consegue ler os textos enviados.';
  end if;
  select id into presentation_uuid
  from public.lesson_presentations
  where student_id = '11111111-1111-4111-8111-111111111111'
    and lesson_key = 'lesson:12';
  if presentation_uuid is null then
    raise exception 'Professor nao localizou a licao numerada.';
  end if;
  if (select count(*) from public.lesson_presentation_views) <> 0 then
    raise exception 'Leitura passiva registrou visualizacao.';
  end if;
end;
$teacher_receives$;

insert into public.lesson_presentation_views
  (presentation_id, revision_number, teacher_id)
select id, revision_number, auth.uid()
from public.lesson_presentations
where student_id = '11111111-1111-4111-8111-111111111111'
  and lesson_key = 'lesson:12';

do $teacher_view_one$
begin
  if (select count(*) from public.lesson_presentation_views) <> 1 then
    raise exception 'Recibo da revisao 1 nao foi registrado.';
  end if;
end;
$teacher_view_one$;

-- Retorno do autor: recibo antigo visivel, mas nova revisao nao visualizada.
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

update public.lesson_presentations set body = 'Apresentacao revisada do aluno um.'
where student_id = auth.uid() and lesson_key = 'lesson:12'
  and revision_number = 1;

do $student_second_save$
begin
  if (select revision_number from public.lesson_presentations
      where lesson_key = 'lesson:12') <> 2 then
    raise exception 'Edicao nao incrementou a revisao.';
  end if;
  if (select count(*) from public.lesson_presentation_versions
      where presentation_id = (
        select id from public.lesson_presentations where lesson_key = 'lesson:12'
      )) <> 2 then
    raise exception 'Historico anterior nao foi preservado.';
  end if;
  if (select count(*) from public.lesson_presentation_views v
      join public.lesson_presentations p on p.id = v.presentation_id
      where p.lesson_key = 'lesson:12'
        and v.revision_number = p.revision_number) <> 0 then
    raise exception 'O recibo anterior marcou a revisao nova.';
  end if;
end;
$student_second_save$;

do $optimistic_update_protection$
declare updated_rows integer;
begin
  update public.lesson_presentations
  set body = 'Texto obsoleto nao autorizado.'
  where student_id = auth.uid() and lesson_key = 'lesson:12'
    and revision_number = 1;
  get diagnostics updated_rows = row_count;
  if updated_rows <> 0 then
    raise exception 'Uma revisao obsoleta foi sobrescrita.';
  end if;
end;
$optimistic_update_protection$;

-- Outro professor tenta forjar leitura da revisao antiga: proibido pelo RLS.
select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
do $stale_teacher_read$
declare presentation_uuid uuid;
begin
  select id into presentation_uuid from public.lesson_presentations
  where student_id = '11111111-1111-4111-8111-111111111111'
    and lesson_key = 'lesson:12';
  begin
    insert into public.lesson_presentation_views
      (presentation_id, revision_number, teacher_id)
    values (presentation_uuid, 1, auth.uid());
    raise exception 'Revisao antiga aceita como visualizacao atual.';
  exception when insufficient_privilege or check_violation then null; end;
end;
$stale_teacher_read$;

-- Leitura real da segunda revisao, distinta da primeira.
insert into public.lesson_presentation_views
  (presentation_id, revision_number, teacher_id)
select id, revision_number, auth.uid()
from public.lesson_presentations
where student_id = '11111111-1111-4111-8111-111111111111'
  and lesson_key = 'lesson:12';

do $teacher_current_read$
begin
  if (select count(*) from public.lesson_presentation_views
      where presentation_id in (
        select id from public.lesson_presentations
        where lesson_key = 'lesson:12'
          and student_id = '11111111-1111-4111-8111-111111111111'
      )) <> 2 then
    raise exception 'Historico de visualizacao nao preservou as duas revisoes.';
  end if;
end;
$teacher_current_read$;

-- O aluno dois nao pode ver o historico do aluno um.
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
do $second_student_still_isolated$
begin
  if (select count(*) from public.lesson_presentations) <> 1
    or (select count(*) from public.lesson_presentation_versions) <> 1
    or (select count(*) from public.lesson_presentation_views) <> 0 then
    raise exception 'A segunda identidade viu apresentacoes de outra pessoa.';
  end if;
end;
$second_student_still_isolated$;

set local role anon;
do $anonymous_cannot_consult$
begin
  begin
    perform count(*) from public.lesson_presentation_views;
    raise exception 'Recibo consultavel por anon.';
  exception when insufficient_privilege then null; end;
end;
$anonymous_cannot_consult$;

reset role;
select 'LESSON_PRESENTATIONS_STAGE4_FULL_CYCLE_PASSED' as verdict;
rollback;
