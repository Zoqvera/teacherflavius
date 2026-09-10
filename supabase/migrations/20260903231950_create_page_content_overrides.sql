create table if not exists public.page_content_overrides (
  page_key text primary key,
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.page_content_overrides enable row level security;

revoke all on table public.page_content_overrides from anon, authenticated;
grant select on table public.page_content_overrides to anon, authenticated;
grant insert, update on table public.page_content_overrides to authenticated;

drop policy if exists "Public can read page content overrides" on public.page_content_overrides;
create policy "Public can read page content overrides"
on public.page_content_overrides
for select
to anon, authenticated
using (true);

drop policy if exists "Teacher admin can insert page content overrides" on public.page_content_overrides;
create policy "Teacher admin can insert page content overrides"
on public.page_content_overrides
for insert
to authenticated
with check (
  (select public.is_teacher_admin())
  and updated_by = (select auth.uid())
);

drop policy if exists "Teacher admin can update page content overrides" on public.page_content_overrides;
create policy "Teacher admin can update page content overrides"
on public.page_content_overrides
for update
to authenticated
using ((select public.is_teacher_admin()))
with check (
  (select public.is_teacher_admin())
  and updated_by = (select auth.uid())
);

insert into public.page_content_overrides (page_key, content, updated_at)
values (
  'curso-de-ingles-ao-vivo-ou-gravado',
  jsonb_build_object(
    'hero_eyebrow', 'Formato de curso',
    'hero_title', 'Curso de inglês ao vivo ou gravado: qual escolher?',
    'hero_intro', 'O curso gravado oferece máxima flexibilidade. O curso ao vivo acrescenta interação, feedback e compromisso com horário. Para desenvolver produção oral, essa diferença é relevante.',
    'short_answer_label', 'Resposta curta',
    'short_answer_text', 'Prefira gravado se sua prioridade é estudar em qualquer horário e você tem alta autonomia. Prefira ao vivo se precisa de prática oral, feedback, interação e uma rotina com compromisso externo.',
    'recorded_title', 'O que um curso gravado oferece?',
    'recorded_p1', 'O principal benefício é a flexibilidade. O estudante pode pausar, repetir e assistir ao conteúdo quando quiser. Isso funciona bem para explicações gramaticais, revisão de vocabulário, leitura e estudo teórico.',
    'recorded_p2', 'O problema aparece quando assistir às aulas substitui o uso da língua. Reconhecer uma explicação não é o mesmo que produzir uma frase em tempo real, compreender um interlocutor ou sustentar uma conversa.',
    'live_title', 'O que muda em uma aula ao vivo?',
    'live_p1', 'Em uma aula ao vivo, o estudante precisa responder a situações que não estão totalmente previstas. O professor pode adaptar a explicação, perceber uma dificuldade, pedir reformulação e oferecer feedback naquele momento.',
    'live_p2', 'Além disso, existe um compromisso de horário. Para algumas pessoas isso parece menos conveniente; para outras, é justamente o que impede o curso de ser abandonado depois de poucas semanas.',
    'conversation_title', 'Qual formato ajuda mais na conversação?',
    'conversation_p1', 'Para conversação, o formato ao vivo tem uma vantagem estrutural porque cria interlocução real. O aluno precisa ouvir, interpretar e responder. Um curso gravado pode incluir exercícios de repetição e produção, mas não substitui completamente a imprevisibilidade de uma interação humana.',
    'hybrid_title', 'O melhor curso pode combinar os dois',
    'hybrid_p1', 'Os formatos não precisam ser tratados como opostos. Uma combinação eficiente usa o encontro ao vivo para interação, prática e feedback e deixa explicações, materiais, revisões e exercícios para o estudo assíncrono.',
    'hybrid_p2', 'Esse desenho preserva o tempo da aula para aquilo que exige presença de outras pessoas.',
    'choose_title', 'Como escolher?',
    'choose_item_1', 'Se sua agenda muda todos os dias, o gravado oferece mais liberdade.',
    'choose_item_2', 'Se você procrastina facilmente, encontros ao vivo podem ajudar na consistência.',
    'choose_item_3', 'Se seu objetivo principal é falar, dê peso maior à prática síncrona.',
    'choose_item_4', 'Se você já conversa em inglês com frequência e quer revisar conteúdo, um curso gravado pode atender melhor.',
    'choose_item_5', 'Se possível, prefira uma solução que combine aula ao vivo e material para estudo individual.',
    'related_title', 'Leituras relacionadas',
    'related_link_1', 'Como escolher um curso de inglês online?',
    'related_link_2', 'Vale a pena fazer curso de inglês online?',
    'cta_title', 'Curso online com aulas ao vivo',
    'cta_text', 'No TeacherFlavius.com, os encontros são ao vivo e o aluno também recebe material e orientação para estudar durante a semana.',
    'cta_button', 'Ver como funciona'
  ),
  now()
)
on conflict (page_key) do nothing;
