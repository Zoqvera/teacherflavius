-- Conversation Question card content reconstruction overlay.
-- Generated from the verified production catalog after migration 20261004085216.
-- This keeps disaster recovery self-contained without replaying the incomplete
-- historical migration chain.

alter table public.conversation_questions
  add column if not exists question_translation text,
  add column if not exists answer_examples jsonb;

comment on column public.conversation_questions.question_translation is
  'Portuguese translation displayed with the English conversation question.';

comment on column public.conversation_questions.answer_examples is
  'Exactly five modeled answers. Each item stores answer, Portuguese translation, and usage note.';

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'How are you?',
  1,
  'Como você está?',
  '[{"note":"Uma resposta clássica, educada e segura para praticamente qualquer situação, seja formal ou informal.","answer":"I''m doing well, thanks. And you?","translation":"Estou indo bem, obrigado/a. E você?"},{"note":"Muito casual e extremamente comum no dia a dia com colegas ou conhecidos.","answer":"Not too bad, thanks!","translation":"Nada mal, obrigado/a!"},{"note":"Informal, soa natural e transmite uma atitude leve e positiva.","answer":"Can''t complain!","translation":"Não posso reclamar!"},{"note":"Excelente para demonstrar entusiasmo, energia ou quando você está num dia especialmente bom.","answer":"I''m great, thanks for asking!","translation":"Estou ótimo/a, obrigado/a por perguntar!"},{"note":"Uma opção para quando você não está tão bem e se sente confortável o suficiente para compartilhar isso com a pessoa que perguntou.","answer":"I''ve been better, to be honest.","translation":"Já estive melhor, para ser sincero/a."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 1
);

update public.conversation_questions
set
  question_text = 'How are you?',
  question_translation = 'Como você está?',
  answer_examples = '[{"note":"Uma resposta clássica, educada e segura para praticamente qualquer situação, seja formal ou informal.","answer":"I''m doing well, thanks. And you?","translation":"Estou indo bem, obrigado/a. E você?"},{"note":"Muito casual e extremamente comum no dia a dia com colegas ou conhecidos.","answer":"Not too bad, thanks!","translation":"Nada mal, obrigado/a!"},{"note":"Informal, soa natural e transmite uma atitude leve e positiva.","answer":"Can''t complain!","translation":"Não posso reclamar!"},{"note":"Excelente para demonstrar entusiasmo, energia ou quando você está num dia especialmente bom.","answer":"I''m great, thanks for asking!","translation":"Estou ótimo/a, obrigado/a por perguntar!"},{"note":"Uma opção para quando você não está tão bem e se sente confortável o suficiente para compartilhar isso com a pessoa que perguntou.","answer":"I''ve been better, to be honest.","translation":"Já estive melhor, para ser sincero/a."}]'::jsonb
where display_order = 1;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Where are you from?',
  2,
  'De onde você é?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I''m from Brazil.","translation":"Eu sou do Brasil."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I''m from Minas Gerais.","translation":"Eu sou de Minas Gerais."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I was born in Brazil.","translation":"Eu nasci no Brasil."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I''m originally from a small town.","translation":"Eu sou originalmente de uma cidade pequena."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I''m from Brazil, but I''ve lived in different cities.","translation":"Eu sou do Brasil, mas já morei em cidades diferentes."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 2
);

update public.conversation_questions
set
  question_text = 'Where are you from?',
  question_translation = 'De onde você é?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I''m from Brazil.","translation":"Eu sou do Brasil."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I''m from Minas Gerais.","translation":"Eu sou de Minas Gerais."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I was born in Brazil.","translation":"Eu nasci no Brasil."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I''m originally from a small town.","translation":"Eu sou originalmente de uma cidade pequena."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I''m from Brazil, but I''ve lived in different cities.","translation":"Eu sou do Brasil, mas já morei em cidades diferentes."}]'::jsonb
where display_order = 2;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Where do you live?',
  3,
  'Onde você mora?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I live in Uberlândia.","translation":"Eu moro em Uberlândia."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I live in Minas Gerais.","translation":"Eu moro em Minas Gerais."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I live near the city center.","translation":"Eu moro perto do centro da cidade."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I live in a quiet neighborhood.","translation":"Eu moro em um bairro tranquilo."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I live with my family in an apartment.","translation":"Eu moro com minha família em um apartamento."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 3
);

update public.conversation_questions
set
  question_text = 'Where do you live?',
  question_translation = 'Onde você mora?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I live in Uberlândia.","translation":"Eu moro em Uberlândia."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I live in Minas Gerais.","translation":"Eu moro em Minas Gerais."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I live near the city center.","translation":"Eu moro perto do centro da cidade."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I live in a quiet neighborhood.","translation":"Eu moro em um bairro tranquilo."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I live with my family in an apartment.","translation":"Eu moro com minha família em um apartamento."}]'::jsonb
where display_order = 3;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'How old are you?',
  4,
  'Quantos anos você tem?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I''m thirty years old.","translation":"Eu tenho trinta anos."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I''m twenty-eight.","translation":"Eu tenho vinte e oito anos."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''m in my thirties.","translation":"Eu estou na faixa dos trinta anos."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I just turned forty.","translation":"Eu acabei de fazer quarenta anos."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I''ll be thirty-five next month.","translation":"Eu vou fazer trinta e cinco anos no mês que vem."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 4
);

update public.conversation_questions
set
  question_text = 'How old are you?',
  question_translation = 'Quantos anos você tem?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I''m thirty years old.","translation":"Eu tenho trinta anos."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I''m twenty-eight.","translation":"Eu tenho vinte e oito anos."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''m in my thirties.","translation":"Eu estou na faixa dos trinta anos."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I just turned forty.","translation":"Eu acabei de fazer quarenta anos."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I''ll be thirty-five next month.","translation":"Eu vou fazer trinta e cinco anos no mês que vem."}]'::jsonb
where display_order = 4;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What do you do for work?',
  5,
  'O que você faz profissionalmente?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I''m a teacher.","translation":"Eu sou professor/a."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I work in finance.","translation":"Eu trabalho na área financeira."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''m a software developer.","translation":"Eu sou desenvolvedor/a de software."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I work as an engineer.","translation":"Eu trabalho como engenheiro/a."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I''m self-employed and work with consulting.","translation":"Eu trabalho por conta própria com consultoria."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 5
);

update public.conversation_questions
set
  question_text = 'What do you do for work?',
  question_translation = 'O que você faz profissionalmente?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I''m a teacher.","translation":"Eu sou professor/a."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I work in finance.","translation":"Eu trabalho na área financeira."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''m a software developer.","translation":"Eu sou desenvolvedor/a de software."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I work as an engineer.","translation":"Eu trabalho como engenheiro/a."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I''m self-employed and work with consulting.","translation":"Eu trabalho por conta própria com consultoria."}]'::jsonb
where display_order = 5;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Where do you work?',
  6,
  'Onde você trabalha?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I work at a school.","translation":"Eu trabalho em uma escola."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I work for an energy company.","translation":"Eu trabalho para uma empresa de energia."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I work from home most days.","translation":"Eu trabalho de casa na maioria dos dias."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I work at an office downtown.","translation":"Eu trabalho em um escritório no centro."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I work for a company based in São Paulo.","translation":"Eu trabalho para uma empresa sediada em São Paulo."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 6
);

update public.conversation_questions
set
  question_text = 'Where do you work?',
  question_translation = 'Onde você trabalha?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I work at a school.","translation":"Eu trabalho em uma escola."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I work for an energy company.","translation":"Eu trabalho para uma empresa de energia."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I work from home most days.","translation":"Eu trabalho de casa na maioria dos dias."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I work at an office downtown.","translation":"Eu trabalho em um escritório no centro."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I work for a company based in São Paulo.","translation":"Eu trabalho para uma empresa sediada em São Paulo."}]'::jsonb
where display_order = 6;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Are you married or single?',
  7,
  'Você é casado/a ou solteiro/a?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I''m single.","translation":"Eu sou solteiro/a."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I''m married.","translation":"Eu sou casado/a."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''m in a relationship.","translation":"Eu estou em um relacionamento."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I''ve been married for five years.","translation":"Eu sou casado/a há cinco anos."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I''m single at the moment.","translation":"Eu estou solteiro/a no momento."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 7
);

update public.conversation_questions
set
  question_text = 'Are you married or single?',
  question_translation = 'Você é casado/a ou solteiro/a?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I''m single.","translation":"Eu sou solteiro/a."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I''m married.","translation":"Eu sou casado/a."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''m in a relationship.","translation":"Eu estou em um relacionamento."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I''ve been married for five years.","translation":"Eu sou casado/a há cinco anos."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I''m single at the moment.","translation":"Eu estou solteiro/a no momento."}]'::jsonb
where display_order = 7;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What''s your surname?',
  8,
  'Qual é o seu sobrenome?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"My surname is Silva.","translation":"Meu sobrenome é Silva."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"It''s Santos.","translation":"É Santos."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"My last name is Oliveira.","translation":"Meu sobrenome é Oliveira."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I have two surnames: Souza and Lima.","translation":"Eu tenho dois sobrenomes: Souza e Lima."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"My family name is Ferreira.","translation":"Meu sobrenome de família é Ferreira."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 8
);

update public.conversation_questions
set
  question_text = 'What''s your surname?',
  question_translation = 'Qual é o seu sobrenome?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"My surname is Silva.","translation":"Meu sobrenome é Silva."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"It''s Santos.","translation":"É Santos."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"My last name is Oliveira.","translation":"Meu sobrenome é Oliveira."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I have two surnames: Souza and Lima.","translation":"Eu tenho dois sobrenomes: Souza e Lima."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"My family name is Ferreira.","translation":"Meu sobrenome de família é Ferreira."}]'::jsonb
where display_order = 8;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'How do you spell your name?',
  9,
  'Como se soletra o seu nome?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"It''s A-N-A.","translation":"É A-N-A."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"M-A-R-C-O-S.","translation":"M-A-R-C-O-S."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Let me spell it: L-U-C-A-S.","translation":"Deixe-me soletrar: L-U-C-A-S."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"It''s J-U-L-I-A, with a J.","translation":"É J-U-L-I-A, com J."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"Sure. It''s R-A-F-A-E-L.","translation":"Claro. É R-A-F-A-E-L."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 9
);

update public.conversation_questions
set
  question_text = 'How do you spell your name?',
  question_translation = 'Como se soletra o seu nome?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"It''s A-N-A.","translation":"É A-N-A."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"M-A-R-C-O-S.","translation":"M-A-R-C-O-S."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Let me spell it: L-U-C-A-S.","translation":"Deixe-me soletrar: L-U-C-A-S."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"It''s J-U-L-I-A, with a J.","translation":"É J-U-L-I-A, com J."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"Sure. It''s R-A-F-A-E-L.","translation":"Claro. É R-A-F-A-E-L."}]'::jsonb
where display_order = 9;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What is your full name?',
  10,
  'Qual é o seu nome completo?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"My full name is Ana Silva.","translation":"Meu nome completo é Ana Silva."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"It''s Carlos Eduardo Santos.","translation":"É Carlos Eduardo Santos."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"My name is Mariana Souza Lima.","translation":"Meu nome é Mariana Souza Lima."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"My full name is Rafael Oliveira Costa.","translation":"Meu nome completo é Rafael Oliveira Costa."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"It''s Beatriz Fernandes Alves.","translation":"É Beatriz Fernandes Alves."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 10
);

update public.conversation_questions
set
  question_text = 'What is your full name?',
  question_translation = 'Qual é o seu nome completo?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"My full name is Ana Silva.","translation":"Meu nome completo é Ana Silva."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"It''s Carlos Eduardo Santos.","translation":"É Carlos Eduardo Santos."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"My name is Mariana Souza Lima.","translation":"Meu nome é Mariana Souza Lima."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"My full name is Rafael Oliveira Costa.","translation":"Meu nome completo é Rafael Oliveira Costa."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"It''s Beatriz Fernandes Alves.","translation":"É Beatriz Fernandes Alves."}]'::jsonb
where display_order = 10;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Do you have children?',
  11,
  'Você tem filhos?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"No, I don''t.","translation":"Não, eu não tenho."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Yes, I have one child.","translation":"Sim, eu tenho um filho/uma filha."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Yes, I have two children.","translation":"Sim, eu tenho dois filhos."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I have a son and a daughter.","translation":"Eu tenho um filho e uma filha."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"Not yet, but I''d like to someday.","translation":"Ainda não, mas eu gostaria de ter um dia."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 11
);

update public.conversation_questions
set
  question_text = 'Do you have children?',
  question_translation = 'Você tem filhos?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"No, I don''t.","translation":"Não, eu não tenho."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Yes, I have one child.","translation":"Sim, eu tenho um filho/uma filha."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Yes, I have two children.","translation":"Sim, eu tenho dois filhos."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I have a son and a daughter.","translation":"Eu tenho um filho e uma filha."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"Not yet, but I''d like to someday.","translation":"Ainda não, mas eu gostaria de ter um dia."}]'::jsonb
where display_order = 11;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Do you have any brothers or sisters?',
  12,
  'Você tem irmãos ou irmãs?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I have one brother.","translation":"Sim, eu tenho um irmão."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I have two sisters.","translation":"Eu tenho duas irmãs."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I have a brother and a sister.","translation":"Eu tenho um irmão e uma irmã."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"No, I''m an only child.","translation":"Não, eu sou filho/a único/a."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"Yes, I''m the youngest of three siblings.","translation":"Sim, eu sou o/a mais novo/a de três irmãos."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 12
);

update public.conversation_questions
set
  question_text = 'Do you have any brothers or sisters?',
  question_translation = 'Você tem irmãos ou irmãs?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I have one brother.","translation":"Sim, eu tenho um irmão."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I have two sisters.","translation":"Eu tenho duas irmãs."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I have a brother and a sister.","translation":"Eu tenho um irmão e uma irmã."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"No, I''m an only child.","translation":"Não, eu sou filho/a único/a."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"Yes, I''m the youngest of three siblings.","translation":"Sim, eu sou o/a mais novo/a de três irmãos."}]'::jsonb
where display_order = 12;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Who do you live with?',
  13,
  'Com quem você mora?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I live alone.","translation":"Eu moro sozinho/a."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I live with my parents.","translation":"Eu moro com meus pais."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I live with my partner.","translation":"Eu moro com meu/minha parceiro/a."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I live with my wife and children.","translation":"Eu moro com minha esposa e meus filhos."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I share an apartment with a friend.","translation":"Eu divido um apartamento com um amigo/uma amiga."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 13
);

update public.conversation_questions
set
  question_text = 'Who do you live with?',
  question_translation = 'Com quem você mora?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I live alone.","translation":"Eu moro sozinho/a."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I live with my parents.","translation":"Eu moro com meus pais."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I live with my partner.","translation":"Eu moro com meu/minha parceiro/a."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I live with my wife and children.","translation":"Eu moro com minha esposa e meus filhos."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I share an apartment with a friend.","translation":"Eu divido um apartamento com um amigo/uma amiga."}]'::jsonb
where display_order = 13;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Do you have any pets?',
  14,
  'Você tem animais de estimação?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I have a dog.","translation":"Sim, eu tenho um cachorro."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I have two cats.","translation":"Eu tenho dois gatos."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"No, I don''t have any pets.","translation":"Não, eu não tenho animais de estimação."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I have a small dog named Max.","translation":"Eu tenho um cachorro pequeno chamado Max."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"Not now, but I grew up with pets.","translation":"Agora não, mas eu cresci com animais de estimação."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 14
);

update public.conversation_questions
set
  question_text = 'Do you have any pets?',
  question_translation = 'Você tem animais de estimação?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I have a dog.","translation":"Sim, eu tenho um cachorro."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I have two cats.","translation":"Eu tenho dois gatos."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"No, I don''t have any pets.","translation":"Não, eu não tenho animais de estimação."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I have a small dog named Max.","translation":"Eu tenho um cachorro pequeno chamado Max."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"Not now, but I grew up with pets.","translation":"Agora não, mas eu cresci com animais de estimação."}]'::jsonb
where display_order = 14;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What''s your phone number?',
  15,
  'Qual é o seu número de telefone?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"It''s 555-0123.","translation":"É 555-0123."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"My number is 555-0187.","translation":"Meu número é 555-0187."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Sure, it''s 555-0142.","translation":"Claro, é 555-0142."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Let me give you my number: 555-0199.","translation":"Deixe-me passar meu número: 555-0199."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I''ll send you my number by message.","translation":"Eu vou te enviar meu número por mensagem."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 15
);

update public.conversation_questions
set
  question_text = 'What''s your phone number?',
  question_translation = 'Qual é o seu número de telefone?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"It''s 555-0123.","translation":"É 555-0123."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"My number is 555-0187.","translation":"Meu número é 555-0187."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Sure, it''s 555-0142.","translation":"Claro, é 555-0142."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Let me give you my number: 555-0199.","translation":"Deixe-me passar meu número: 555-0199."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I''ll send you my number by message.","translation":"Eu vou te enviar meu número por mensagem."}]'::jsonb
where display_order = 15;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What''s your address?',
  16,
  'Qual é o seu endereço?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I live on Main Street.","translation":"Eu moro na Rua Principal."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"My address is 25 Oak Street.","translation":"Meu endereço é Rua Oak, 25."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I live at 120 Central Avenue.","translation":"Eu moro na Avenida Central, 120."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I live near the main square.","translation":"Eu moro perto da praça principal."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I''ll send you the full address by message.","translation":"Eu vou te enviar o endereço completo por mensagem."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 16
);

update public.conversation_questions
set
  question_text = 'What''s your address?',
  question_translation = 'Qual é o seu endereço?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I live on Main Street.","translation":"Eu moro na Rua Principal."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"My address is 25 Oak Street.","translation":"Meu endereço é Rua Oak, 25."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I live at 120 Central Avenue.","translation":"Eu moro na Avenida Central, 120."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I live near the main square.","translation":"Eu moro perto da praça principal."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I''ll send you the full address by message.","translation":"Eu vou te enviar o endereço completo por mensagem."}]'::jsonb
where display_order = 16;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What languages do you speak?',
  17,
  'Quais idiomas você fala?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I speak Portuguese and English.","translation":"Eu falo português e inglês."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I speak Portuguese and a little Spanish.","translation":"Eu falo português e um pouco de espanhol."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Portuguese is my first language.","translation":"O português é a minha primeira língua."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I speak three languages: Portuguese, English, and Spanish.","translation":"Eu falo três idiomas: português, inglês e espanhol."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I mainly speak Portuguese, but I''m learning English.","translation":"Eu falo principalmente português, mas estou aprendendo inglês."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 17
);

update public.conversation_questions
set
  question_text = 'What languages do you speak?',
  question_translation = 'Quais idiomas você fala?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I speak Portuguese and English.","translation":"Eu falo português e inglês."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I speak Portuguese and a little Spanish.","translation":"Eu falo português e um pouco de espanhol."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Portuguese is my first language.","translation":"O português é a minha primeira língua."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I speak three languages: Portuguese, English, and Spanish.","translation":"Eu falo três idiomas: português, inglês e espanhol."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I mainly speak Portuguese, but I''m learning English.","translation":"Eu falo principalmente português, mas estou aprendendo inglês."}]'::jsonb
where display_order = 17;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Are you learning any languages?',
  18,
  'Você está aprendendo algum idioma?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I''m learning English.","translation":"Sim, eu estou aprendendo inglês."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I''m studying Spanish at the moment.","translation":"Eu estou estudando espanhol no momento."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Yes, I''m learning English for work.","translation":"Sim, eu estou aprendendo inglês para o trabalho."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I''m trying to improve my English speaking skills.","translation":"Eu estou tentando melhorar minha conversação em inglês."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"Not right now, but I''d like to learn Italian.","translation":"Agora não, mas eu gostaria de aprender italiano."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 18
);

update public.conversation_questions
set
  question_text = 'Are you learning any languages?',
  question_translation = 'Você está aprendendo algum idioma?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I''m learning English.","translation":"Sim, eu estou aprendendo inglês."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I''m studying Spanish at the moment.","translation":"Eu estou estudando espanhol no momento."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Yes, I''m learning English for work.","translation":"Sim, eu estou aprendendo inglês para o trabalho."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I''m trying to improve my English speaking skills.","translation":"Eu estou tentando melhorar minha conversação em inglês."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"Not right now, but I''d like to learn Italian.","translation":"Agora não, mas eu gostaria de aprender italiano."}]'::jsonb
where display_order = 18;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What is your favorite language?',
  19,
  'Qual é o seu idioma favorito?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"English is my favorite language.","translation":"O inglês é o meu idioma favorito."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I really like Spanish.","translation":"Eu gosto muito de espanhol."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Portuguese is still my favorite.","translation":"O português ainda é o meu favorito."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I love the sound of Italian.","translation":"Eu adoro o som do italiano."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"It''s hard to choose, but I think English is my favorite.","translation":"É difícil escolher, mas acho que inglês é o meu favorito."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 19
);

update public.conversation_questions
set
  question_text = 'What is your favorite language?',
  question_translation = 'Qual é o seu idioma favorito?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"English is my favorite language.","translation":"O inglês é o meu idioma favorito."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I really like Spanish.","translation":"Eu gosto muito de espanhol."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Portuguese is still my favorite.","translation":"O português ainda é o meu favorito."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I love the sound of Italian.","translation":"Eu adoro o som do italiano."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"It''s hard to choose, but I think English is my favorite.","translation":"É difícil escolher, mas acho que inglês é o meu favorito."}]'::jsonb
where display_order = 19;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What time do you usually wake up?',
  20,
  'Que horas você costuma acordar?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I usually wake up at seven.","translation":"Eu geralmente acordo às sete."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I get up around six thirty.","translation":"Eu levanto por volta das seis e meia."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I normally wake up at eight.","translation":"Eu normalmente acordo às oito."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"On weekdays, I wake up at six.","translation":"Nos dias de semana, eu acordo às seis."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"It depends, but usually between seven and eight.","translation":"Depende, mas geralmente entre sete e oito."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 20
);

update public.conversation_questions
set
  question_text = 'What time do you usually wake up?',
  question_translation = 'Que horas você costuma acordar?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I usually wake up at seven.","translation":"Eu geralmente acordo às sete."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I get up around six thirty.","translation":"Eu levanto por volta das seis e meia."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I normally wake up at eight.","translation":"Eu normalmente acordo às oito."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"On weekdays, I wake up at six.","translation":"Nos dias de semana, eu acordo às seis."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"It depends, but usually between seven and eight.","translation":"Depende, mas geralmente entre sete e oito."}]'::jsonb
where display_order = 20;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What do you usually do in the morning?',
  21,
  'O que você costuma fazer de manhã?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I have breakfast and get ready for work.","translation":"Eu tomo café da manhã e me preparo para o trabalho."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I take a shower and make coffee.","translation":"Eu tomo banho e faço café."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I usually exercise before work.","translation":"Eu geralmente faço exercícios antes do trabalho."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I check my schedule and start working.","translation":"Eu verifico minha agenda e começo a trabalhar."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I have a quiet breakfast and read the news.","translation":"Eu tomo um café da manhã tranquilo e leio as notícias."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 21
);

update public.conversation_questions
set
  question_text = 'What do you usually do in the morning?',
  question_translation = 'O que você costuma fazer de manhã?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I have breakfast and get ready for work.","translation":"Eu tomo café da manhã e me preparo para o trabalho."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I take a shower and make coffee.","translation":"Eu tomo banho e faço café."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I usually exercise before work.","translation":"Eu geralmente faço exercícios antes do trabalho."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I check my schedule and start working.","translation":"Eu verifico minha agenda e começo a trabalhar."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I have a quiet breakfast and read the news.","translation":"Eu tomo um café da manhã tranquilo e leio as notícias."}]'::jsonb
where display_order = 21;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What do you usually have for breakfast?',
  22,
  'O que você costuma comer no café da manhã?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I usually have coffee and bread.","translation":"Eu geralmente tomo café e como pão."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I have fruit and yogurt.","translation":"Eu como frutas e iogurte."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I normally eat eggs and toast.","translation":"Eu normalmente como ovos e torradas."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I just have coffee in the morning.","translation":"Eu só tomo café de manhã."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I like having cheese bread and coffee.","translation":"Eu gosto de comer pão de queijo e tomar café."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 22
);

update public.conversation_questions
set
  question_text = 'What do you usually have for breakfast?',
  question_translation = 'O que você costuma comer no café da manhã?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I usually have coffee and bread.","translation":"Eu geralmente tomo café e como pão."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I have fruit and yogurt.","translation":"Eu como frutas e iogurte."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I normally eat eggs and toast.","translation":"Eu normalmente como ovos e torradas."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I just have coffee in the morning.","translation":"Eu só tomo café de manhã."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I like having cheese bread and coffee.","translation":"Eu gosto de comer pão de queijo e tomar café."}]'::jsonb
where display_order = 22;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What time do you start work or school?',
  23,
  'Que horas você começa a trabalhar ou estudar?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I start work at nine.","translation":"Eu começo a trabalhar às nove."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"My workday starts at eight thirty.","translation":"Meu expediente começa às oito e meia."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I usually start at ten.","translation":"Eu geralmente começo às dez."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Classes start at seven in the morning.","translation":"As aulas começam às sete da manhã."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"My schedule changes, but I normally start around nine.","translation":"Meu horário muda, mas normalmente começo por volta das nove."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 23
);

update public.conversation_questions
set
  question_text = 'What time do you start work or school?',
  question_translation = 'Que horas você começa a trabalhar ou estudar?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I start work at nine.","translation":"Eu começo a trabalhar às nove."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"My workday starts at eight thirty.","translation":"Meu expediente começa às oito e meia."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I usually start at ten.","translation":"Eu geralmente começo às dez."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Classes start at seven in the morning.","translation":"As aulas começam às sete da manhã."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"My schedule changes, but I normally start around nine.","translation":"Meu horário muda, mas normalmente começo por volta das nove."}]'::jsonb
where display_order = 23;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What do you usually do during the day?',
  24,
  'O que você costuma fazer durante o dia?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I work and attend meetings.","translation":"Eu trabalho e participo de reuniões."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I study in the morning and work in the afternoon.","translation":"Eu estudo de manhã e trabalho à tarde."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I spend most of the day at work.","translation":"Eu passo a maior parte do dia no trabalho."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I work, answer emails, and talk to clients.","translation":"Eu trabalho, respondo e-mails e falo com clientes."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"My day is usually divided between work, errands, and family.","translation":"Meu dia geralmente se divide entre trabalho, tarefas e família."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 24
);

update public.conversation_questions
set
  question_text = 'What do you usually do during the day?',
  question_translation = 'O que você costuma fazer durante o dia?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I work and attend meetings.","translation":"Eu trabalho e participo de reuniões."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I study in the morning and work in the afternoon.","translation":"Eu estudo de manhã e trabalho à tarde."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I spend most of the day at work.","translation":"Eu passo a maior parte do dia no trabalho."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I work, answer emails, and talk to clients.","translation":"Eu trabalho, respondo e-mails e falo com clientes."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"My day is usually divided between work, errands, and family.","translation":"Meu dia geralmente se divide entre trabalho, tarefas e família."}]'::jsonb
where display_order = 24;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What time do you usually go to bed?',
  25,
  'Que horas você costuma ir para a cama?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I usually go to bed at eleven.","translation":"Eu geralmente vou para a cama às onze."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I go to bed around midnight.","translation":"Eu vou para a cama por volta da meia-noite."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I normally sleep at ten thirty.","translation":"Eu normalmente durmo às dez e meia."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"On weekdays, I try to be in bed by eleven.","translation":"Nos dias de semana, eu tento estar na cama até as onze."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"It depends on the day, but usually before midnight.","translation":"Depende do dia, mas geralmente antes da meia-noite."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 25
);

update public.conversation_questions
set
  question_text = 'What time do you usually go to bed?',
  question_translation = 'Que horas você costuma ir para a cama?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I usually go to bed at eleven.","translation":"Eu geralmente vou para a cama às onze."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I go to bed around midnight.","translation":"Eu vou para a cama por volta da meia-noite."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I normally sleep at ten thirty.","translation":"Eu normalmente durmo às dez e meia."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"On weekdays, I try to be in bed by eleven.","translation":"Nos dias de semana, eu tento estar na cama até as onze."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"It depends on the day, but usually before midnight.","translation":"Depende do dia, mas geralmente antes da meia-noite."}]'::jsonb
where display_order = 25;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Are you a morning person or a night person?',
  26,
  'Você é uma pessoa mais matutina ou noturna?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I''m definitely a morning person.","translation":"Eu definitivamente sou uma pessoa matutina."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I''m more of a night person.","translation":"Eu sou mais uma pessoa noturna."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I prefer mornings because I have more energy.","translation":"Eu prefiro as manhãs porque tenho mais energia."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I work better at night.","translation":"Eu trabalho melhor à noite."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I''m somewhere in between.","translation":"Eu fico em algum lugar no meio."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 26
);

update public.conversation_questions
set
  question_text = 'Are you a morning person or a night person?',
  question_translation = 'Você é uma pessoa mais matutina ou noturna?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I''m definitely a morning person.","translation":"Eu definitivamente sou uma pessoa matutina."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I''m more of a night person.","translation":"Eu sou mais uma pessoa noturna."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I prefer mornings because I have more energy.","translation":"Eu prefiro as manhãs porque tenho mais energia."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I work better at night.","translation":"Eu trabalho melhor à noite."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I''m somewhere in between.","translation":"Eu fico em algum lugar no meio."}]'::jsonb
where display_order = 26;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What do you like to do in your free time?',
  27,
  'O que você gosta de fazer no seu tempo livre?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I like reading and watching movies.","translation":"Eu gosto de ler e assistir a filmes."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I enjoy spending time with friends.","translation":"Eu gosto de passar tempo com amigos."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I like going for walks.","translation":"Eu gosto de fazer caminhadas."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I usually listen to music or play games.","translation":"Eu geralmente ouço música ou jogo."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I like relaxing at home and trying new recipes.","translation":"Eu gosto de relaxar em casa e experimentar receitas novas."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 27
);

update public.conversation_questions
set
  question_text = 'What do you like to do in your free time?',
  question_translation = 'O que você gosta de fazer no seu tempo livre?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I like reading and watching movies.","translation":"Eu gosto de ler e assistir a filmes."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I enjoy spending time with friends.","translation":"Eu gosto de passar tempo com amigos."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I like going for walks.","translation":"Eu gosto de fazer caminhadas."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I usually listen to music or play games.","translation":"Eu geralmente ouço música ou jogo."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I like relaxing at home and trying new recipes.","translation":"Eu gosto de relaxar em casa e experimentar receitas novas."}]'::jsonb
where display_order = 27;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What are your hobbies?',
  28,
  'Quais são os seus hobbies?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"My hobbies are reading and cooking.","translation":"Meus hobbies são ler e cozinhar."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I enjoy photography.","translation":"Eu gosto de fotografia."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I like playing soccer and watching movies.","translation":"Eu gosto de jogar futebol e assistir a filmes."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I enjoy traveling and learning languages.","translation":"Eu gosto de viajar e aprender idiomas."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I spend a lot of my free time gardening and listening to music.","translation":"Eu passo muito do meu tempo livre cuidando do jardim e ouvindo música."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 28
);

update public.conversation_questions
set
  question_text = 'What are your hobbies?',
  question_translation = 'Quais são os seus hobbies?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"My hobbies are reading and cooking.","translation":"Meus hobbies são ler e cozinhar."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I enjoy photography.","translation":"Eu gosto de fotografia."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I like playing soccer and watching movies.","translation":"Eu gosto de jogar futebol e assistir a filmes."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I enjoy traveling and learning languages.","translation":"Eu gosto de viajar e aprender idiomas."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I spend a lot of my free time gardening and listening to music.","translation":"Eu passo muito do meu tempo livre cuidando do jardim e ouvindo música."}]'::jsonb
where display_order = 28;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Do you like reading?',
  29,
  'Você gosta de ler?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I love reading.","translation":"Sim, eu adoro ler."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Yes, especially fiction.","translation":"Sim, especialmente ficção."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I read from time to time.","translation":"Eu leio de vez em quando."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Not very much, to be honest.","translation":"Não muito, para ser sincero/a."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I like reading when I have enough time.","translation":"Eu gosto de ler quando tenho tempo suficiente."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 29
);

update public.conversation_questions
set
  question_text = 'Do you like reading?',
  question_translation = 'Você gosta de ler?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I love reading.","translation":"Sim, eu adoro ler."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Yes, especially fiction.","translation":"Sim, especialmente ficção."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I read from time to time.","translation":"Eu leio de vez em quando."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Not very much, to be honest.","translation":"Não muito, para ser sincero/a."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I like reading when I have enough time.","translation":"Eu gosto de ler quando tenho tempo suficiente."}]'::jsonb
where display_order = 29;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What kind of books do you like?',
  30,
  'Que tipo de livros você gosta?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I like mystery novels.","translation":"Eu gosto de romances de mistério."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I enjoy science fiction.","translation":"Eu gosto de ficção científica."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I usually read biographies.","translation":"Eu geralmente leio biografias."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I prefer non-fiction books.","translation":"Eu prefiro livros de não ficção."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I like books about history and psychology.","translation":"Eu gosto de livros sobre história e psicologia."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 30
);

update public.conversation_questions
set
  question_text = 'What kind of books do you like?',
  question_translation = 'Que tipo de livros você gosta?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I like mystery novels.","translation":"Eu gosto de romances de mistério."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I enjoy science fiction.","translation":"Eu gosto de ficção científica."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I usually read biographies.","translation":"Eu geralmente leio biografias."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I prefer non-fiction books.","translation":"Eu prefiro livros de não ficção."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I like books about history and psychology.","translation":"Eu gosto de livros sobre história e psicologia."}]'::jsonb
where display_order = 30;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What is your favorite book?',
  31,
  'Qual é o seu livro favorito?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"My favorite book is The Little Prince.","translation":"Meu livro favorito é O Pequeno Príncipe."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I really like 1984.","translation":"Eu gosto muito de 1984."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I don''t have just one favorite book.","translation":"Eu não tenho apenas um livro favorito."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"One of my favorites is The Alchemist.","translation":"Um dos meus favoritos é O Alquimista."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"It changes over time, but right now it''s a biography I''m reading.","translation":"Isso muda com o tempo, mas agora é uma biografia que estou lendo."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 31
);

update public.conversation_questions
set
  question_text = 'What is your favorite book?',
  question_translation = 'Qual é o seu livro favorito?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"My favorite book is The Little Prince.","translation":"Meu livro favorito é O Pequeno Príncipe."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I really like 1984.","translation":"Eu gosto muito de 1984."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I don''t have just one favorite book.","translation":"Eu não tenho apenas um livro favorito."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"One of my favorites is The Alchemist.","translation":"Um dos meus favoritos é O Alquimista."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"It changes over time, but right now it''s a biography I''m reading.","translation":"Isso muda com o tempo, mas agora é uma biografia que estou lendo."}]'::jsonb
where display_order = 31;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Do you like watching movies?',
  32,
  'Você gosta de assistir a filmes?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I love movies.","translation":"Sim, eu adoro filmes."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Yes, I watch movies every weekend.","translation":"Sim, eu assisto a filmes todo fim de semana."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I like movies, especially comedies.","translation":"Eu gosto de filmes, especialmente comédias."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Sometimes, but I prefer series.","translation":"Às vezes, mas eu prefiro séries."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"Not very often, but I enjoy a good movie with friends.","translation":"Não com muita frequência, mas gosto de um bom filme com amigos."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 32
);

update public.conversation_questions
set
  question_text = 'Do you like watching movies?',
  question_translation = 'Você gosta de assistir a filmes?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I love movies.","translation":"Sim, eu adoro filmes."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Yes, I watch movies every weekend.","translation":"Sim, eu assisto a filmes todo fim de semana."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I like movies, especially comedies.","translation":"Eu gosto de filmes, especialmente comédias."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Sometimes, but I prefer series.","translation":"Às vezes, mas eu prefiro séries."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"Not very often, but I enjoy a good movie with friends.","translation":"Não com muita frequência, mas gosto de um bom filme com amigos."}]'::jsonb
where display_order = 32;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What kind of movies do you like?',
  33,
  'Que tipo de filmes você gosta?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I like comedies.","translation":"Eu gosto de comédias."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I enjoy action movies.","translation":"Eu gosto de filmes de ação."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I love science fiction.","translation":"Eu adoro ficção científica."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I usually watch dramas and thrillers.","translation":"Eu geralmente assisto a dramas e suspenses."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I like different genres, but documentaries are my favorite.","translation":"Eu gosto de gêneros diferentes, mas documentários são meus favoritos."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 33
);

update public.conversation_questions
set
  question_text = 'What kind of movies do you like?',
  question_translation = 'Que tipo de filmes você gosta?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I like comedies.","translation":"Eu gosto de comédias."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I enjoy action movies.","translation":"Eu gosto de filmes de ação."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I love science fiction.","translation":"Eu adoro ficção científica."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I usually watch dramas and thrillers.","translation":"Eu geralmente assisto a dramas e suspenses."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I like different genres, but documentaries are my favorite.","translation":"Eu gosto de gêneros diferentes, mas documentários são meus favoritos."}]'::jsonb
where display_order = 33;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What is your favorite movie?',
  34,
  'Qual é o seu filme favorito?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"My favorite movie is Interstellar.","translation":"Meu filme favorito é Interestelar."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I really like The Godfather.","translation":"Eu gosto muito de O Poderoso Chefão."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I don''t have a single favorite.","translation":"Eu não tenho um único favorito."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"One of my favorites is Toy Story.","translation":"Um dos meus favoritos é Toy Story."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"Right now, my favorite is a movie I watched recently.","translation":"No momento, meu favorito é um filme que assisti recentemente."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 34
);

update public.conversation_questions
set
  question_text = 'What is your favorite movie?',
  question_translation = 'Qual é o seu filme favorito?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"My favorite movie is Interstellar.","translation":"Meu filme favorito é Interestelar."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I really like The Godfather.","translation":"Eu gosto muito de O Poderoso Chefão."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I don''t have a single favorite.","translation":"Eu não tenho um único favorito."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"One of my favorites is Toy Story.","translation":"Um dos meus favoritos é Toy Story."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"Right now, my favorite is a movie I watched recently.","translation":"No momento, meu favorito é um filme que assisti recentemente."}]'::jsonb
where display_order = 34;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Do you watch TV series?',
  35,
  'Você assiste a séries?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I watch a lot of series.","translation":"Sim, eu assisto a muitas séries."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Yes, especially on weekends.","translation":"Sim, especialmente nos fins de semana."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Sometimes, when I have time.","translation":"Às vezes, quando tenho tempo."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Not really. I prefer movies.","translation":"Na verdade, não. Eu prefiro filmes."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I usually watch one or two episodes at night.","translation":"Eu geralmente assisto a um ou dois episódios à noite."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 35
);

update public.conversation_questions
set
  question_text = 'Do you watch TV series?',
  question_translation = 'Você assiste a séries?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I watch a lot of series.","translation":"Sim, eu assisto a muitas séries."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Yes, especially on weekends.","translation":"Sim, especialmente nos fins de semana."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Sometimes, when I have time.","translation":"Às vezes, quando tenho tempo."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Not really. I prefer movies.","translation":"Na verdade, não. Eu prefiro filmes."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I usually watch one or two episodes at night.","translation":"Eu geralmente assisto a um ou dois episódios à noite."}]'::jsonb
where display_order = 35;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What is your favorite TV series?',
  36,
  'Qual é a sua série favorita?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"My favorite series is Friends.","translation":"Minha série favorita é Friends."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I really like Breaking Bad.","translation":"Eu gosto muito de Breaking Bad."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I don''t have one favorite series.","translation":"Eu não tenho uma série favorita."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"One of my favorites is The Office.","translation":"Uma das minhas favoritas é The Office."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"My favorite changes, but I''m really enjoying my current series.","translation":"Minha favorita muda, mas estou gostando muito da série que assisto atualmente."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 36
);

update public.conversation_questions
set
  question_text = 'What is your favorite TV series?',
  question_translation = 'Qual é a sua série favorita?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"My favorite series is Friends.","translation":"Minha série favorita é Friends."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I really like Breaking Bad.","translation":"Eu gosto muito de Breaking Bad."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I don''t have one favorite series.","translation":"Eu não tenho uma série favorita."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"One of my favorites is The Office.","translation":"Uma das minhas favoritas é The Office."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"My favorite changes, but I''m really enjoying my current series.","translation":"Minha favorita muda, mas estou gostando muito da série que assisto atualmente."}]'::jsonb
where display_order = 36;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Do you like listening to music?',
  37,
  'Você gosta de ouvir música?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I listen to music every day.","translation":"Sim, eu ouço música todos os dias."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Yes, I love music.","translation":"Sim, eu adoro música."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I usually listen to music while working.","translation":"Eu geralmente ouço música enquanto trabalho."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Sometimes, especially when I''m driving.","translation":"Às vezes, especialmente quando estou dirigindo."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"Yes, music helps me relax.","translation":"Sim, a música me ajuda a relaxar."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 37
);

update public.conversation_questions
set
  question_text = 'Do you like listening to music?',
  question_translation = 'Você gosta de ouvir música?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I listen to music every day.","translation":"Sim, eu ouço música todos os dias."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Yes, I love music.","translation":"Sim, eu adoro música."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I usually listen to music while working.","translation":"Eu geralmente ouço música enquanto trabalho."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Sometimes, especially when I''m driving.","translation":"Às vezes, especialmente quando estou dirigindo."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"Yes, music helps me relax.","translation":"Sim, a música me ajuda a relaxar."}]'::jsonb
where display_order = 37;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What kind of music do you like?',
  38,
  'Que tipo de música você gosta?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I like pop music.","translation":"Eu gosto de música pop."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I enjoy rock.","translation":"Eu gosto de rock."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I listen to Brazilian music a lot.","translation":"Eu ouço bastante música brasileira."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I like jazz and classical music.","translation":"Eu gosto de jazz e música clássica."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"My taste is pretty varied, so I listen to many different styles.","translation":"Meu gosto é bem variado, então ouço muitos estilos diferentes."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 38
);

update public.conversation_questions
set
  question_text = 'What kind of music do you like?',
  question_translation = 'Que tipo de música você gosta?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I like pop music.","translation":"Eu gosto de música pop."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I enjoy rock.","translation":"Eu gosto de rock."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I listen to Brazilian music a lot.","translation":"Eu ouço bastante música brasileira."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I like jazz and classical music.","translation":"Eu gosto de jazz e música clássica."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"My taste is pretty varied, so I listen to many different styles.","translation":"Meu gosto é bem variado, então ouço muitos estilos diferentes."}]'::jsonb
where display_order = 38;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Who is your favorite singer or band?',
  39,
  'Quem é o seu cantor, cantora ou banda favorita?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"My favorite band is Coldplay.","translation":"Minha banda favorita é Coldplay."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I really like Adele.","translation":"Eu gosto muito da Adele."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I don''t have a favorite singer.","translation":"Eu não tenho um cantor ou cantora favorito/a."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"One of my favorite artists is Bruno Mars.","translation":"Um dos meus artistas favoritos é Bruno Mars."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"It changes a lot, but lately I''ve been listening to Taylor Swift.","translation":"Isso muda bastante, mas ultimamente tenho ouvido Taylor Swift."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 39
);

update public.conversation_questions
set
  question_text = 'Who is your favorite singer or band?',
  question_translation = 'Quem é o seu cantor, cantora ou banda favorita?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"My favorite band is Coldplay.","translation":"Minha banda favorita é Coldplay."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I really like Adele.","translation":"Eu gosto muito da Adele."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I don''t have a favorite singer.","translation":"Eu não tenho um cantor ou cantora favorito/a."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"One of my favorite artists is Bruno Mars.","translation":"Um dos meus artistas favoritos é Bruno Mars."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"It changes a lot, but lately I''ve been listening to Taylor Swift.","translation":"Isso muda bastante, mas ultimamente tenho ouvido Taylor Swift."}]'::jsonb
where display_order = 39;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What is your favorite song?',
  40,
  'Qual é a sua música favorita?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"My favorite song is Yellow.","translation":"Minha música favorita é Yellow."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I really like Imagine.","translation":"Eu gosto muito de Imagine."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I don''t have just one favorite song.","translation":"Eu não tenho apenas uma música favorita."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"One of my favorites is Viva la Vida.","translation":"Uma das minhas favoritas é Viva la Vida."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"It depends on my mood, so my favorite changes often.","translation":"Depende do meu humor, então minha favorita muda com frequência."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 40
);

update public.conversation_questions
set
  question_text = 'What is your favorite song?',
  question_translation = 'Qual é a sua música favorita?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"My favorite song is Yellow.","translation":"Minha música favorita é Yellow."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I really like Imagine.","translation":"Eu gosto muito de Imagine."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I don''t have just one favorite song.","translation":"Eu não tenho apenas uma música favorita."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"One of my favorites is Viva la Vida.","translation":"Uma das minhas favoritas é Viva la Vida."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"It depends on my mood, so my favorite changes often.","translation":"Depende do meu humor, então minha favorita muda com frequência."}]'::jsonb
where display_order = 40;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Do you play any musical instruments?',
  41,
  'Você toca algum instrumento musical?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I play the guitar.","translation":"Sim, eu toco violão."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I play a little piano.","translation":"Eu toco um pouco de piano."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"No, I don''t play any instruments.","translation":"Não, eu não toco nenhum instrumento."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I used to play the drums.","translation":"Eu costumava tocar bateria."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I''m learning how to play the keyboard.","translation":"Eu estou aprendendo a tocar teclado."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 41
);

update public.conversation_questions
set
  question_text = 'Do you play any musical instruments?',
  question_translation = 'Você toca algum instrumento musical?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I play the guitar.","translation":"Sim, eu toco violão."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I play a little piano.","translation":"Eu toco um pouco de piano."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"No, I don''t play any instruments.","translation":"Não, eu não toco nenhum instrumento."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I used to play the drums.","translation":"Eu costumava tocar bateria."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I''m learning how to play the keyboard.","translation":"Eu estou aprendendo a tocar teclado."}]'::jsonb
where display_order = 41;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Do you like sports?',
  42,
  'Você gosta de esportes?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I love sports.","translation":"Sim, eu adoro esportes."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Yes, especially soccer.","translation":"Sim, especialmente futebol."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I like watching sports more than playing them.","translation":"Eu gosto mais de assistir a esportes do que praticá-los."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Not very much.","translation":"Não muito."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I enjoy sports, but I don''t follow any team closely.","translation":"Eu gosto de esportes, mas não acompanho nenhum time de perto."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 42
);

update public.conversation_questions
set
  question_text = 'Do you like sports?',
  question_translation = 'Você gosta de esportes?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I love sports.","translation":"Sim, eu adoro esportes."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Yes, especially soccer.","translation":"Sim, especialmente futebol."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I like watching sports more than playing them.","translation":"Eu gosto mais de assistir a esportes do que praticá-los."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Not very much.","translation":"Não muito."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I enjoy sports, but I don''t follow any team closely.","translation":"Eu gosto de esportes, mas não acompanho nenhum time de perto."}]'::jsonb
where display_order = 42;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What is your favorite sport?',
  43,
  'Qual é o seu esporte favorito?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"My favorite sport is soccer.","translation":"Meu esporte favorito é futebol."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I really like volleyball.","translation":"Eu gosto muito de vôlei."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I prefer basketball.","translation":"Eu prefiro basquete."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Swimming is my favorite sport.","translation":"Natação é o meu esporte favorito."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I don''t have a favorite, but I enjoy several sports.","translation":"Eu não tenho um favorito, mas gosto de vários esportes."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 43
);

update public.conversation_questions
set
  question_text = 'What is your favorite sport?',
  question_translation = 'Qual é o seu esporte favorito?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"My favorite sport is soccer.","translation":"Meu esporte favorito é futebol."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I really like volleyball.","translation":"Eu gosto muito de vôlei."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I prefer basketball.","translation":"Eu prefiro basquete."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Swimming is my favorite sport.","translation":"Natação é o meu esporte favorito."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I don''t have a favorite, but I enjoy several sports.","translation":"Eu não tenho um favorito, mas gosto de vários esportes."}]'::jsonb
where display_order = 43;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Do you play any sports?',
  44,
  'Você pratica algum esporte?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I play soccer.","translation":"Sim, eu jogo futebol."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I play volleyball once a week.","translation":"Eu jogo vôlei uma vez por semana."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I go swimming regularly.","translation":"Eu nado regularmente."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"No, I don''t play any sports right now.","translation":"Não, eu não pratico nenhum esporte no momento."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I occasionally play tennis with friends.","translation":"Eu jogo tênis com amigos de vez em quando."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 44
);

update public.conversation_questions
set
  question_text = 'Do you play any sports?',
  question_translation = 'Você pratica algum esporte?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I play soccer.","translation":"Sim, eu jogo futebol."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I play volleyball once a week.","translation":"Eu jogo vôlei uma vez por semana."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I go swimming regularly.","translation":"Eu nado regularmente."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"No, I don''t play any sports right now.","translation":"Não, eu não pratico nenhum esporte no momento."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I occasionally play tennis with friends.","translation":"Eu jogo tênis com amigos de vez em quando."}]'::jsonb
where display_order = 44;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Do you exercise regularly?',
  45,
  'Você se exercita regularmente?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I exercise three times a week.","translation":"Sim, eu me exercito três vezes por semana."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I work out almost every day.","translation":"Eu treino quase todos os dias."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I try to exercise on weekends.","translation":"Eu tento me exercitar nos fins de semana."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Not as regularly as I''d like.","translation":"Não tão regularmente quanto eu gostaria."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I usually walk or cycle a few times a week.","translation":"Eu geralmente caminho ou pedalo algumas vezes por semana."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 45
);

update public.conversation_questions
set
  question_text = 'Do you exercise regularly?',
  question_translation = 'Você se exercita regularmente?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I exercise three times a week.","translation":"Sim, eu me exercito três vezes por semana."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I work out almost every day.","translation":"Eu treino quase todos os dias."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I try to exercise on weekends.","translation":"Eu tento me exercitar nos fins de semana."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Not as regularly as I''d like.","translation":"Não tão regularmente quanto eu gostaria."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I usually walk or cycle a few times a week.","translation":"Eu geralmente caminho ou pedalo algumas vezes por semana."}]'::jsonb
where display_order = 45;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Do you go to the gym?',
  46,
  'Você vai à academia?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I go three times a week.","translation":"Sim, eu vou três vezes por semana."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I go to the gym after work.","translation":"Eu vou à academia depois do trabalho."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Sometimes, but not every week.","translation":"Às vezes, mas não toda semana."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"No, I prefer exercising outdoors.","translation":"Não, eu prefiro me exercitar ao ar livre."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I used to go, but now I work out at home.","translation":"Eu costumava ir, mas agora treino em casa."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 46
);

update public.conversation_questions
set
  question_text = 'Do you go to the gym?',
  question_translation = 'Você vai à academia?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I go three times a week.","translation":"Sim, eu vou três vezes por semana."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I go to the gym after work.","translation":"Eu vou à academia depois do trabalho."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Sometimes, but not every week.","translation":"Às vezes, mas não toda semana."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"No, I prefer exercising outdoors.","translation":"Não, eu prefiro me exercitar ao ar livre."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I used to go, but now I work out at home.","translation":"Eu costumava ir, mas agora treino em casa."}]'::jsonb
where display_order = 46;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What is your favorite food?',
  47,
  'Qual é a sua comida favorita?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"My favorite food is pizza.","translation":"Minha comida favorita é pizza."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I love Brazilian barbecue.","translation":"Eu adoro churrasco brasileiro."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I really like pasta.","translation":"Eu gosto muito de massas."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Japanese food is my favorite.","translation":"Comida japonesa é a minha favorita."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"It''s hard to choose, but I probably like homemade food the most.","translation":"É difícil escolher, mas provavelmente gosto mais de comida caseira."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 47
);

update public.conversation_questions
set
  question_text = 'What is your favorite food?',
  question_translation = 'Qual é a sua comida favorita?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"My favorite food is pizza.","translation":"Minha comida favorita é pizza."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I love Brazilian barbecue.","translation":"Eu adoro churrasco brasileiro."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I really like pasta.","translation":"Eu gosto muito de massas."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Japanese food is my favorite.","translation":"Comida japonesa é a minha favorita."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"It''s hard to choose, but I probably like homemade food the most.","translation":"É difícil escolher, mas provavelmente gosto mais de comida caseira."}]'::jsonb
where display_order = 47;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What food do you dislike?',
  48,
  'De que comida você não gosta?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I don''t like olives.","translation":"Eu não gosto de azeitonas."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I dislike very spicy food.","translation":"Eu não gosto de comida muito apimentada."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''m not a big fan of seafood.","translation":"Eu não sou muito fã de frutos do mar."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I don''t really like liver.","translation":"Eu realmente não gosto de fígado."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"There aren''t many foods I dislike, but I avoid very greasy dishes.","translation":"Não há muitas comidas de que eu não goste, mas evito pratos muito gordurosos."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 48
);

update public.conversation_questions
set
  question_text = 'What food do you dislike?',
  question_translation = 'De que comida você não gosta?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I don''t like olives.","translation":"Eu não gosto de azeitonas."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I dislike very spicy food.","translation":"Eu não gosto de comida muito apimentada."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''m not a big fan of seafood.","translation":"Eu não sou muito fã de frutos do mar."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I don''t really like liver.","translation":"Eu realmente não gosto de fígado."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"There aren''t many foods I dislike, but I avoid very greasy dishes.","translation":"Não há muitas comidas de que eu não goste, mas evito pratos muito gordurosos."}]'::jsonb
where display_order = 48;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Can you cook?',
  49,
  'Você sabe cozinhar?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I can.","translation":"Sim, eu sei."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Yes, I cook almost every day.","translation":"Sim, eu cozinho quase todos os dias."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"A little. I can make simple meals.","translation":"Um pouco. Eu sei fazer refeições simples."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Not very well, but I''m learning.","translation":"Não muito bem, mas estou aprendendo."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"Yes, and I really enjoy trying new recipes.","translation":"Sim, e eu gosto muito de experimentar receitas novas."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 49
);

update public.conversation_questions
set
  question_text = 'Can you cook?',
  question_translation = 'Você sabe cozinhar?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I can.","translation":"Sim, eu sei."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Yes, I cook almost every day.","translation":"Sim, eu cozinho quase todos os dias."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"A little. I can make simple meals.","translation":"Um pouco. Eu sei fazer refeições simples."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Not very well, but I''m learning.","translation":"Não muito bem, mas estou aprendendo."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"Yes, and I really enjoy trying new recipes.","translation":"Sim, e eu gosto muito de experimentar receitas novas."}]'::jsonb
where display_order = 49;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What is your favorite dish to cook?',
  50,
  'Qual é o seu prato favorito de preparar?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I like cooking pasta.","translation":"Eu gosto de preparar massas."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"My favorite dish to make is risotto.","translation":"Meu prato favorito de preparar é risoto."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I enjoy making homemade pizza.","translation":"Eu gosto de fazer pizza caseira."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I usually cook rice, beans, and chicken.","translation":"Eu geralmente preparo arroz, feijão e frango."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I love making desserts, especially chocolate cake.","translation":"Eu adoro fazer sobremesas, especialmente bolo de chocolate."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 50
);

update public.conversation_questions
set
  question_text = 'What is your favorite dish to cook?',
  question_translation = 'Qual é o seu prato favorito de preparar?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I like cooking pasta.","translation":"Eu gosto de preparar massas."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"My favorite dish to make is risotto.","translation":"Meu prato favorito de preparar é risoto."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I enjoy making homemade pizza.","translation":"Eu gosto de fazer pizza caseira."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I usually cook rice, beans, and chicken.","translation":"Eu geralmente preparo arroz, feijão e frango."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I love making desserts, especially chocolate cake.","translation":"Eu adoro fazer sobremesas, especialmente bolo de chocolate."}]'::jsonb
where display_order = 50;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Do you prefer coffee or tea?',
  51,
  'Você prefere café ou chá?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I prefer coffee.","translation":"Eu prefiro café."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Tea, definitely.","translation":"Chá, com certeza."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I like both, but I drink more coffee.","translation":"Eu gosto dos dois, mas tomo mais café."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I usually drink coffee in the morning and tea at night.","translation":"Eu geralmente tomo café de manhã e chá à noite."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"It depends on the weather, but most days I choose coffee.","translation":"Depende do clima, mas na maioria dos dias escolho café."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 51
);

update public.conversation_questions
set
  question_text = 'Do you prefer coffee or tea?',
  question_translation = 'Você prefere café ou chá?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I prefer coffee.","translation":"Eu prefiro café."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Tea, definitely.","translation":"Chá, com certeza."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I like both, but I drink more coffee.","translation":"Eu gosto dos dois, mas tomo mais café."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I usually drink coffee in the morning and tea at night.","translation":"Eu geralmente tomo café de manhã e chá à noite."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"It depends on the weather, but most days I choose coffee.","translation":"Depende do clima, mas na maioria dos dias escolho café."}]'::jsonb
where display_order = 51;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What is your favorite drink?',
  52,
  'Qual é a sua bebida favorita?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"My favorite drink is coffee.","translation":"Minha bebida favorita é café."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I really like orange juice.","translation":"Eu gosto muito de suco de laranja."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I usually prefer sparkling water.","translation":"Eu geralmente prefiro água com gás."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I love fresh fruit juice.","translation":"Eu adoro suco de fruta natural."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"For everyday drinks, coffee is probably my favorite.","translation":"Entre as bebidas do dia a dia, café provavelmente é a minha favorita."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 52
);

update public.conversation_questions
set
  question_text = 'What is your favorite drink?',
  question_translation = 'Qual é a sua bebida favorita?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"My favorite drink is coffee.","translation":"Minha bebida favorita é café."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I really like orange juice.","translation":"Eu gosto muito de suco de laranja."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I usually prefer sparkling water.","translation":"Eu geralmente prefiro água com gás."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I love fresh fruit juice.","translation":"Eu adoro suco de fruta natural."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"For everyday drinks, coffee is probably my favorite.","translation":"Entre as bebidas do dia a dia, café provavelmente é a minha favorita."}]'::jsonb
where display_order = 52;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Do you like trying new foods?',
  53,
  'Você gosta de experimentar comidas novas?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I love trying new foods.","translation":"Sim, eu adoro experimentar comidas novas."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Yes, especially when I travel.","translation":"Sim, especialmente quando viajo."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Sometimes, if the dish looks interesting.","translation":"Às vezes, se o prato parecer interessante."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I''m a little cautious, but I try new things.","translation":"Eu sou um pouco cauteloso/a, mas experimento coisas novas."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"Not very much. I usually prefer food I already know.","translation":"Não muito. Eu geralmente prefiro comidas que já conheço."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 53
);

update public.conversation_questions
set
  question_text = 'Do you like trying new foods?',
  question_translation = 'Você gosta de experimentar comidas novas?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I love trying new foods.","translation":"Sim, eu adoro experimentar comidas novas."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Yes, especially when I travel.","translation":"Sim, especialmente quando viajo."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Sometimes, if the dish looks interesting.","translation":"Às vezes, se o prato parecer interessante."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I''m a little cautious, but I try new things.","translation":"Eu sou um pouco cauteloso/a, mas experimento coisas novas."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"Not very much. I usually prefer food I already know.","translation":"Não muito. Eu geralmente prefiro comidas que já conheço."}]'::jsonb
where display_order = 53;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What is your favorite restaurant?',
  54,
  'Qual é o seu restaurante favorito?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"My favorite restaurant is a small Italian place near my house.","translation":"Meu restaurante favorito é um pequeno restaurante italiano perto da minha casa."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I really like a local steakhouse.","translation":"Eu gosto muito de uma churrascaria local."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I don''t have one favorite restaurant.","translation":"Eu não tenho um restaurante favorito."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"There''s a Japanese restaurant downtown that I love.","translation":"Há um restaurante japonês no centro de que eu gosto muito."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"My favorite place changes, but I usually choose restaurants with good homemade food.","translation":"Meu lugar favorito muda, mas geralmente escolho restaurantes com boa comida caseira."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 54
);

update public.conversation_questions
set
  question_text = 'What is your favorite restaurant?',
  question_translation = 'Qual é o seu restaurante favorito?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"My favorite restaurant is a small Italian place near my house.","translation":"Meu restaurante favorito é um pequeno restaurante italiano perto da minha casa."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I really like a local steakhouse.","translation":"Eu gosto muito de uma churrascaria local."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I don''t have one favorite restaurant.","translation":"Eu não tenho um restaurante favorito."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"There''s a Japanese restaurant downtown that I love.","translation":"Há um restaurante japonês no centro de que eu gosto muito."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"My favorite place changes, but I usually choose restaurants with good homemade food.","translation":"Meu lugar favorito muda, mas geralmente escolho restaurantes com boa comida caseira."}]'::jsonb
where display_order = 54;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Do you like traveling?',
  55,
  'Você gosta de viajar?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I love traveling.","translation":"Sim, eu adoro viajar."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Yes, especially to new places.","translation":"Sim, especialmente para lugares novos."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I enjoy short trips on weekends.","translation":"Eu gosto de viagens curtas nos fins de semana."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Sometimes, but I also like staying home.","translation":"Às vezes, mas também gosto de ficar em casa."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"Yes, traveling is one of my favorite ways to spend my vacation.","translation":"Sim, viajar é uma das minhas formas favoritas de passar as férias."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 55
);

update public.conversation_questions
set
  question_text = 'Do you like traveling?',
  question_translation = 'Você gosta de viajar?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I love traveling.","translation":"Sim, eu adoro viajar."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Yes, especially to new places.","translation":"Sim, especialmente para lugares novos."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I enjoy short trips on weekends.","translation":"Eu gosto de viagens curtas nos fins de semana."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Sometimes, but I also like staying home.","translation":"Às vezes, mas também gosto de ficar em casa."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"Yes, traveling is one of my favorite ways to spend my vacation.","translation":"Sim, viajar é uma das minhas formas favoritas de passar as férias."}]'::jsonb
where display_order = 55;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What countries have you visited?',
  56,
  'Quais países você já visitou?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I''ve visited Argentina and Chile.","translation":"Eu já visitei Argentina e Chile."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I''ve been to the United States.","translation":"Eu já fui aos Estados Unidos."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''ve visited Portugal and Spain.","translation":"Eu já visitei Portugal e Espanha."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I haven''t traveled abroad yet.","translation":"Eu ainda não viajei para fora do país."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I''ve visited a few countries in South America and Europe.","translation":"Eu já visitei alguns países na América do Sul e na Europa."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 56
);

update public.conversation_questions
set
  question_text = 'What countries have you visited?',
  question_translation = 'Quais países você já visitou?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I''ve visited Argentina and Chile.","translation":"Eu já visitei Argentina e Chile."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I''ve been to the United States.","translation":"Eu já fui aos Estados Unidos."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''ve visited Portugal and Spain.","translation":"Eu já visitei Portugal e Espanha."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I haven''t traveled abroad yet.","translation":"Eu ainda não viajei para fora do país."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I''ve visited a few countries in South America and Europe.","translation":"Eu já visitei alguns países na América do Sul e na Europa."}]'::jsonb
where display_order = 56;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What is your favorite place you have visited?',
  57,
  'Qual é o seu lugar favorito entre os que você já visitou?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"My favorite place was Rio de Janeiro.","translation":"Meu lugar favorito foi o Rio de Janeiro."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I loved visiting Buenos Aires.","translation":"Eu adorei visitar Buenos Aires."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"The beach I visited last year was amazing.","translation":"A praia que visitei no ano passado foi incrível."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"So far, my favorite place is Lisbon.","translation":"Até agora, meu lugar favorito é Lisboa."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"It''s difficult to choose, but a small mountain town I visited was unforgettable.","translation":"É difícil escolher, mas uma pequena cidade nas montanhas que visitei foi inesquecível."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 57
);

update public.conversation_questions
set
  question_text = 'What is your favorite place you have visited?',
  question_translation = 'Qual é o seu lugar favorito entre os que você já visitou?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"My favorite place was Rio de Janeiro.","translation":"Meu lugar favorito foi o Rio de Janeiro."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I loved visiting Buenos Aires.","translation":"Eu adorei visitar Buenos Aires."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"The beach I visited last year was amazing.","translation":"A praia que visitei no ano passado foi incrível."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"So far, my favorite place is Lisbon.","translation":"Até agora, meu lugar favorito é Lisboa."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"It''s difficult to choose, but a small mountain town I visited was unforgettable.","translation":"É difícil escolher, mas uma pequena cidade nas montanhas que visitei foi inesquecível."}]'::jsonb
where display_order = 57;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Where would you like to travel next?',
  58,
  'Para onde você gostaria de viajar na próxima vez?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I''d like to go to Italy.","translation":"Eu gostaria de ir para a Itália."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I want to visit Canada next.","translation":"Eu quero visitar o Canadá na próxima viagem."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''d love to travel to Japan.","translation":"Eu adoraria viajar para o Japão."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Maybe somewhere in the northeast of Brazil.","translation":"Talvez algum lugar no Nordeste do Brasil."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"My next trip will probably be somewhere with beaches and warm weather.","translation":"Minha próxima viagem provavelmente será para algum lugar com praias e clima quente."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 58
);

update public.conversation_questions
set
  question_text = 'Where would you like to travel next?',
  question_translation = 'Para onde você gostaria de viajar na próxima vez?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I''d like to go to Italy.","translation":"Eu gostaria de ir para a Itália."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I want to visit Canada next.","translation":"Eu quero visitar o Canadá na próxima viagem."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''d love to travel to Japan.","translation":"Eu adoraria viajar para o Japão."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Maybe somewhere in the northeast of Brazil.","translation":"Talvez algum lugar no Nordeste do Brasil."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"My next trip will probably be somewhere with beaches and warm weather.","translation":"Minha próxima viagem provavelmente será para algum lugar com praias e clima quente."}]'::jsonb
where display_order = 58;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What is your dream destination?',
  59,
  'Qual é o destino dos seus sonhos?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"My dream destination is Japan.","translation":"O destino dos meus sonhos é o Japão."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I''d love to visit New Zealand.","translation":"Eu adoraria visitar a Nova Zelândia."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''ve always wanted to go to Italy.","translation":"Eu sempre quis ir para a Itália."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I dream of seeing the Northern Lights.","translation":"Eu sonho em ver a aurora boreal."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"My dream trip would be a long journey through several European countries.","translation":"Minha viagem dos sonhos seria uma longa jornada por vários países europeus."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 59
);

update public.conversation_questions
set
  question_text = 'What is your dream destination?',
  question_translation = 'Qual é o destino dos seus sonhos?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"My dream destination is Japan.","translation":"O destino dos meus sonhos é o Japão."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I''d love to visit New Zealand.","translation":"Eu adoraria visitar a Nova Zelândia."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''ve always wanted to go to Italy.","translation":"Eu sempre quis ir para a Itália."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I dream of seeing the Northern Lights.","translation":"Eu sonho em ver a aurora boreal."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"My dream trip would be a long journey through several European countries.","translation":"Minha viagem dos sonhos seria uma longa jornada por vários países europeus."}]'::jsonb
where display_order = 59;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Do you prefer the beach or the mountains?',
  60,
  'Você prefere praia ou montanhas?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I prefer the beach.","translation":"Eu prefiro a praia."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I definitely prefer the mountains.","translation":"Eu definitivamente prefiro as montanhas."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I like both, but I choose the beach in summer.","translation":"Eu gosto dos dois, mas escolho a praia no verão."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"The mountains, because I enjoy cooler weather.","translation":"As montanhas, porque eu gosto de clima mais fresco."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"It depends on the trip, but I usually feel more relaxed at the beach.","translation":"Depende da viagem, mas geralmente me sinto mais relaxado/a na praia."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 60
);

update public.conversation_questions
set
  question_text = 'Do you prefer the beach or the mountains?',
  question_translation = 'Você prefere praia ou montanhas?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I prefer the beach.","translation":"Eu prefiro a praia."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I definitely prefer the mountains.","translation":"Eu definitivamente prefiro as montanhas."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I like both, but I choose the beach in summer.","translation":"Eu gosto dos dois, mas escolho a praia no verão."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"The mountains, because I enjoy cooler weather.","translation":"As montanhas, porque eu gosto de clima mais fresco."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"It depends on the trip, but I usually feel more relaxed at the beach.","translation":"Depende da viagem, mas geralmente me sinto mais relaxado/a na praia."}]'::jsonb
where display_order = 60;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Do you prefer big cities or small towns?',
  61,
  'Você prefere cidades grandes ou cidades pequenas?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I prefer big cities.","translation":"Eu prefiro cidades grandes."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I like small towns better.","translation":"Eu gosto mais de cidades pequenas."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Big cities are more convenient for me.","translation":"Cidades grandes são mais convenientes para mim."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I prefer small towns because they''re quieter.","translation":"Eu prefiro cidades pequenas porque são mais tranquilas."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I like living in a medium-sized city because it offers a balance.","translation":"Eu gosto de morar em uma cidade de médio porte porque oferece equilíbrio."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 61
);

update public.conversation_questions
set
  question_text = 'Do you prefer big cities or small towns?',
  question_translation = 'Você prefere cidades grandes ou cidades pequenas?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I prefer big cities.","translation":"Eu prefiro cidades grandes."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I like small towns better.","translation":"Eu gosto mais de cidades pequenas."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Big cities are more convenient for me.","translation":"Cidades grandes são mais convenientes para mim."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I prefer small towns because they''re quieter.","translation":"Eu prefiro cidades pequenas porque são mais tranquilas."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I like living in a medium-sized city because it offers a balance.","translation":"Eu gosto de morar em uma cidade de médio porte porque oferece equilíbrio."}]'::jsonb
where display_order = 61;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What is your favorite city?',
  62,
  'Qual é a sua cidade favorita?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"My favorite city is São Paulo.","translation":"Minha cidade favorita é São Paulo."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I really like Rio de Janeiro.","translation":"Eu gosto muito do Rio de Janeiro."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Lisbon is one of my favorite cities.","translation":"Lisboa é uma das minhas cidades favoritas."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I don''t have a favorite city yet.","translation":"Eu ainda não tenho uma cidade favorita."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I love my hometown because my family and friends are there.","translation":"Eu adoro minha cidade natal porque minha família e meus amigos estão lá."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 62
);

update public.conversation_questions
set
  question_text = 'What is your favorite city?',
  question_translation = 'Qual é a sua cidade favorita?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"My favorite city is São Paulo.","translation":"Minha cidade favorita é São Paulo."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I really like Rio de Janeiro.","translation":"Eu gosto muito do Rio de Janeiro."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Lisbon is one of my favorite cities.","translation":"Lisboa é uma das minhas cidades favoritas."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I don''t have a favorite city yet.","translation":"Eu ainda não tenho uma cidade favorita."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I love my hometown because my family and friends are there.","translation":"Eu adoro minha cidade natal porque minha família e meus amigos estão lá."}]'::jsonb
where display_order = 62;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What do you like about the city where you live?',
  63,
  'O que você gosta na cidade onde mora?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I like the parks and restaurants.","translation":"Eu gosto dos parques e restaurantes."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I like that it''s easy to get around.","translation":"Eu gosto do fato de ser fácil se locomover."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"The city has good services and many things to do.","translation":"A cidade tem bons serviços e muitas coisas para fazer."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I like the people and the relaxed atmosphere.","translation":"Eu gosto das pessoas e do clima tranquilo."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"What I like most is that it''s big enough to have options but not too crowded.","translation":"O que mais gosto é que ela é grande o suficiente para ter opções, mas não é lotada demais."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 63
);

update public.conversation_questions
set
  question_text = 'What do you like about the city where you live?',
  question_translation = 'O que você gosta na cidade onde mora?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I like the parks and restaurants.","translation":"Eu gosto dos parques e restaurantes."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I like that it''s easy to get around.","translation":"Eu gosto do fato de ser fácil se locomover."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"The city has good services and many things to do.","translation":"A cidade tem bons serviços e muitas coisas para fazer."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I like the people and the relaxed atmosphere.","translation":"Eu gosto das pessoas e do clima tranquilo."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"What I like most is that it''s big enough to have options but not too crowded.","translation":"O que mais gosto é que ela é grande o suficiente para ter opções, mas não é lotada demais."}]'::jsonb
where display_order = 63;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Would you like to live in another country?',
  64,
  'Você gostaria de morar em outro país?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I''d like to live abroad someday.","translation":"Sim, eu gostaria de morar fora do país algum dia."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Maybe, for a few years.","translation":"Talvez, por alguns anos."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''d like to experience living in Canada.","translation":"Eu gostaria de experimentar morar no Canadá."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"No, I''m happy living in Brazil.","translation":"Não, eu estou feliz morando no Brasil."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I would consider it if I had a good job opportunity.","translation":"Eu consideraria isso se tivesse uma boa oportunidade de trabalho."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 64
);

update public.conversation_questions
set
  question_text = 'Would you like to live in another country?',
  question_translation = 'Você gostaria de morar em outro país?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I''d like to live abroad someday.","translation":"Sim, eu gostaria de morar fora do país algum dia."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Maybe, for a few years.","translation":"Talvez, por alguns anos."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''d like to experience living in Canada.","translation":"Eu gostaria de experimentar morar no Canadá."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"No, I''m happy living in Brazil.","translation":"Não, eu estou feliz morando no Brasil."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I would consider it if I had a good job opportunity.","translation":"Eu consideraria isso se tivesse uma boa oportunidade de trabalho."}]'::jsonb
where display_order = 64;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What is your favorite day of the week?',
  65,
  'Qual é o seu dia favorito da semana?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Friday is my favorite day.","translation":"Sexta-feira é o meu dia favorito."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I like Saturday best.","translation":"Eu gosto mais de sábado."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Sunday is my favorite because I can relax.","translation":"Domingo é o meu favorito porque posso relaxar."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I actually like Monday because I enjoy starting a new week.","translation":"Na verdade, eu gosto de segunda-feira porque gosto de começar uma nova semana."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"Probably Saturday, because I have more time for family and friends.","translation":"Provavelmente sábado, porque tenho mais tempo para família e amigos."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 65
);

update public.conversation_questions
set
  question_text = 'What is your favorite day of the week?',
  question_translation = 'Qual é o seu dia favorito da semana?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Friday is my favorite day.","translation":"Sexta-feira é o meu dia favorito."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I like Saturday best.","translation":"Eu gosto mais de sábado."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Sunday is my favorite because I can relax.","translation":"Domingo é o meu favorito porque posso relaxar."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I actually like Monday because I enjoy starting a new week.","translation":"Na verdade, eu gosto de segunda-feira porque gosto de começar uma nova semana."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"Probably Saturday, because I have more time for family and friends.","translation":"Provavelmente sábado, porque tenho mais tempo para família e amigos."}]'::jsonb
where display_order = 65;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What is your favorite season?',
  66,
  'Qual é a sua estação do ano favorita?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Summer is my favorite season.","translation":"O verão é a minha estação favorita."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I prefer winter.","translation":"Eu prefiro o inverno."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I love spring because the weather is pleasant.","translation":"Eu adoro a primavera porque o clima é agradável."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Autumn is my favorite because I like cooler days.","translation":"O outono é o meu favorito porque gosto de dias mais frescos."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I usually prefer spring, but it depends on where I am.","translation":"Eu geralmente prefiro a primavera, mas depende de onde estou."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 66
);

update public.conversation_questions
set
  question_text = 'What is your favorite season?',
  question_translation = 'Qual é a sua estação do ano favorita?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Summer is my favorite season.","translation":"O verão é a minha estação favorita."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I prefer winter.","translation":"Eu prefiro o inverno."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I love spring because the weather is pleasant.","translation":"Eu adoro a primavera porque o clima é agradável."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Autumn is my favorite because I like cooler days.","translation":"O outono é o meu favorito porque gosto de dias mais frescos."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I usually prefer spring, but it depends on where I am.","translation":"Eu geralmente prefiro a primavera, mas depende de onde estou."}]'::jsonb
where display_order = 66;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What is your favorite holiday?',
  67,
  'Qual é o seu feriado favorito?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Christmas is my favorite holiday.","translation":"O Natal é o meu feriado favorito."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I really like New Year''s Day.","translation":"Eu gosto muito do Ano-Novo."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"My favorite holiday is Carnival.","translation":"Meu feriado favorito é o Carnaval."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I like holidays when my whole family gets together.","translation":"Eu gosto de feriados em que toda a minha família se reúne."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"Christmas is probably my favorite because of the family traditions.","translation":"O Natal provavelmente é o meu favorito por causa das tradições familiares."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 67
);

update public.conversation_questions
set
  question_text = 'What is your favorite holiday?',
  question_translation = 'Qual é o seu feriado favorito?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Christmas is my favorite holiday.","translation":"O Natal é o meu feriado favorito."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I really like New Year''s Day.","translation":"Eu gosto muito do Ano-Novo."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"My favorite holiday is Carnival.","translation":"Meu feriado favorito é o Carnaval."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I like holidays when my whole family gets together.","translation":"Eu gosto de feriados em que toda a minha família se reúne."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"Christmas is probably my favorite because of the family traditions.","translation":"O Natal provavelmente é o meu favorito por causa das tradições familiares."}]'::jsonb
where display_order = 67;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What do you usually do on weekends?',
  68,
  'O que você costuma fazer nos fins de semana?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I usually relax at home.","translation":"Eu geralmente relaxo em casa."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I spend time with my family.","translation":"Eu passo tempo com minha família."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I go out with friends.","translation":"Eu saio com amigos."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I usually exercise and do things around the house.","translation":"Eu geralmente faço exercícios e cuido de coisas em casa."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I try to rest, meet friends, and prepare for the next week.","translation":"Eu tento descansar, encontrar amigos e me preparar para a próxima semana."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 68
);

update public.conversation_questions
set
  question_text = 'What do you usually do on weekends?',
  question_translation = 'O que você costuma fazer nos fins de semana?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I usually relax at home.","translation":"Eu geralmente relaxo em casa."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I spend time with my family.","translation":"Eu passo tempo com minha família."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I go out with friends.","translation":"Eu saio com amigos."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I usually exercise and do things around the house.","translation":"Eu geralmente faço exercícios e cuido de coisas em casa."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I try to rest, meet friends, and prepare for the next week.","translation":"Eu tento descansar, encontrar amigos e me preparar para a próxima semana."}]'::jsonb
where display_order = 68;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What did you do last weekend?',
  69,
  'O que você fez no fim de semana passado?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I stayed home and relaxed.","translation":"Eu fiquei em casa e relaxei."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I visited my family.","translation":"Eu visitei minha família."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I went out with some friends.","translation":"Eu saí com alguns amigos."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I watched a movie and cooked dinner.","translation":"Eu assisti a um filme e preparei o jantar."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I had a busy weekend: I cleaned the house, exercised, and met some friends.","translation":"Eu tive um fim de semana corrido: limpei a casa, fiz exercícios e encontrei alguns amigos."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 69
);

update public.conversation_questions
set
  question_text = 'What did you do last weekend?',
  question_translation = 'O que você fez no fim de semana passado?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I stayed home and relaxed.","translation":"Eu fiquei em casa e relaxei."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I visited my family.","translation":"Eu visitei minha família."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I went out with some friends.","translation":"Eu saí com alguns amigos."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I watched a movie and cooked dinner.","translation":"Eu assisti a um filme e preparei o jantar."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I had a busy weekend: I cleaned the house, exercised, and met some friends.","translation":"Eu tive um fim de semana corrido: limpei a casa, fiz exercícios e encontrei alguns amigos."}]'::jsonb
where display_order = 69;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What are you going to do next weekend?',
  70,
  'O que você vai fazer no próximo fim de semana?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I''m going to stay home and rest.","translation":"Eu vou ficar em casa e descansar."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I''m going to visit my parents.","translation":"Eu vou visitar meus pais."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''m meeting some friends on Saturday.","translation":"Eu vou encontrar alguns amigos no sábado."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I plan to go to the movies.","translation":"Eu planejo ir ao cinema."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I haven''t decided yet, but I''d like to do something outdoors.","translation":"Eu ainda não decidi, mas gostaria de fazer algo ao ar livre."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 70
);

update public.conversation_questions
set
  question_text = 'What are you going to do next weekend?',
  question_translation = 'O que você vai fazer no próximo fim de semana?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I''m going to stay home and rest.","translation":"Eu vou ficar em casa e descansar."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I''m going to visit my parents.","translation":"Eu vou visitar meus pais."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''m meeting some friends on Saturday.","translation":"Eu vou encontrar alguns amigos no sábado."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I plan to go to the movies.","translation":"Eu planejo ir ao cinema."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I haven''t decided yet, but I''d like to do something outdoors.","translation":"Eu ainda não decidi, mas gostaria de fazer algo ao ar livre."}]'::jsonb
where display_order = 70;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Do you like going out with friends?',
  71,
  'Você gosta de sair com amigos?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I love going out with friends.","translation":"Sim, eu adoro sair com amigos."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Yes, especially on weekends.","translation":"Sim, especialmente nos fins de semana."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Sometimes. I also enjoy staying home.","translation":"Às vezes. Eu também gosto de ficar em casa."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I prefer small gatherings with close friends.","translation":"Eu prefiro encontros pequenos com amigos próximos."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"Yes, but I don''t go out as often as I used to.","translation":"Sim, mas eu não saio com tanta frequência quanto antes."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 71
);

update public.conversation_questions
set
  question_text = 'Do you like going out with friends?',
  question_translation = 'Você gosta de sair com amigos?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I love going out with friends.","translation":"Sim, eu adoro sair com amigos."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Yes, especially on weekends.","translation":"Sim, especialmente nos fins de semana."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Sometimes. I also enjoy staying home.","translation":"Às vezes. Eu também gosto de ficar em casa."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I prefer small gatherings with close friends.","translation":"Eu prefiro encontros pequenos com amigos próximos."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"Yes, but I don''t go out as often as I used to.","translation":"Sim, mas eu não saio com tanta frequência quanto antes."}]'::jsonb
where display_order = 71;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'How often do you see your friends?',
  72,
  'Com que frequência você vê seus amigos?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I see them every week.","translation":"Eu os vejo toda semana."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Usually once or twice a month.","translation":"Geralmente uma ou duas vezes por mês."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I meet my closest friends on weekends.","translation":"Eu encontro meus amigos mais próximos nos fins de semana."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Not very often because we''re all busy.","translation":"Não com muita frequência porque todos estamos ocupados."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"It varies, but we try to meet at least once a month.","translation":"Varia, mas tentamos nos encontrar pelo menos uma vez por mês."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 72
);

update public.conversation_questions
set
  question_text = 'How often do you see your friends?',
  question_translation = 'Com que frequência você vê seus amigos?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I see them every week.","translation":"Eu os vejo toda semana."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Usually once or twice a month.","translation":"Geralmente uma ou duas vezes por mês."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I meet my closest friends on weekends.","translation":"Eu encontro meus amigos mais próximos nos fins de semana."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Not very often because we''re all busy.","translation":"Não com muita frequência porque todos estamos ocupados."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"It varies, but we try to meet at least once a month.","translation":"Varia, mas tentamos nos encontrar pelo menos uma vez por mês."}]'::jsonb
where display_order = 72;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What do you usually do with your friends?',
  73,
  'O que você costuma fazer com seus amigos?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"We usually go out for dinner.","translation":"Nós geralmente saímos para jantar."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"We watch movies together.","translation":"Nós assistimos a filmes juntos."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"We meet for coffee and talk.","translation":"Nós nos encontramos para tomar café e conversar."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"We sometimes play sports or games.","translation":"Às vezes praticamos esportes ou jogamos."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"We usually choose something simple, like having dinner and catching up.","translation":"Nós geralmente escolhemos algo simples, como jantar e colocar a conversa em dia."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 73
);

update public.conversation_questions
set
  question_text = 'What do you usually do with your friends?',
  question_translation = 'O que você costuma fazer com seus amigos?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"We usually go out for dinner.","translation":"Nós geralmente saímos para jantar."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"We watch movies together.","translation":"Nós assistimos a filmes juntos."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"We meet for coffee and talk.","translation":"Nós nos encontramos para tomar café e conversar."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"We sometimes play sports or games.","translation":"Às vezes praticamos esportes ou jogamos."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"We usually choose something simple, like having dinner and catching up.","translation":"Nós geralmente escolhemos algo simples, como jantar e colocar a conversa em dia."}]'::jsonb
where display_order = 73;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What qualities do you value in a friend?',
  74,
  'Que qualidades você valoriza em um amigo ou amiga?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I value honesty.","translation":"Eu valorizo a honestidade."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Kindness is very important to me.","translation":"Gentileza é muito importante para mim."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I like friends who are reliable.","translation":"Eu gosto de amigos em quem posso confiar."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I value a good sense of humor and respect.","translation":"Eu valorizo bom humor e respeito."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"For me, a good friend is honest, supportive, and easy to talk to.","translation":"Para mim, um bom amigo é honesto, oferece apoio e é fácil de conversar."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 74
);

update public.conversation_questions
set
  question_text = 'What qualities do you value in a friend?',
  question_translation = 'Que qualidades você valoriza em um amigo ou amiga?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I value honesty.","translation":"Eu valorizo a honestidade."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Kindness is very important to me.","translation":"Gentileza é muito importante para mim."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I like friends who are reliable.","translation":"Eu gosto de amigos em quem posso confiar."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I value a good sense of humor and respect.","translation":"Eu valorizo bom humor e respeito."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"For me, a good friend is honest, supportive, and easy to talk to.","translation":"Para mim, um bom amigo é honesto, oferece apoio e é fácil de conversar."}]'::jsonb
where display_order = 74;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Are you a shy person?',
  75,
  'Você é uma pessoa tímida?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I''m a little shy.","translation":"Sim, eu sou um pouco tímido/a."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Not really. I''m quite outgoing.","translation":"Na verdade, não. Eu sou bastante extrovertido/a."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''m shy around new people.","translation":"Eu sou tímido/a perto de pessoas novas."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"It depends on the situation.","translation":"Depende da situação."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I used to be very shy, but I''m more confident now.","translation":"Eu costumava ser muito tímido/a, mas agora sou mais confiante."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 75
);

update public.conversation_questions
set
  question_text = 'Are you a shy person?',
  question_translation = 'Você é uma pessoa tímida?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I''m a little shy.","translation":"Sim, eu sou um pouco tímido/a."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Not really. I''m quite outgoing.","translation":"Na verdade, não. Eu sou bastante extrovertido/a."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''m shy around new people.","translation":"Eu sou tímido/a perto de pessoas novas."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"It depends on the situation.","translation":"Depende da situação."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I used to be very shy, but I''m more confident now.","translation":"Eu costumava ser muito tímido/a, mas agora sou mais confiante."}]'::jsonb
where display_order = 75;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Are you an organized person?',
  76,
  'Você é uma pessoa organizada?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I''m very organized.","translation":"Sim, eu sou muito organizado/a."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I try to be organized.","translation":"Eu tento ser organizado/a."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Not always, but I use a calendar.","translation":"Nem sempre, mas eu uso uma agenda."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I''m organized at work but less organized at home.","translation":"Eu sou organizado/a no trabalho, mas menos em casa."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I like making lists and planning my week in advance.","translation":"Eu gosto de fazer listas e planejar minha semana com antecedência."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 76
);

update public.conversation_questions
set
  question_text = 'Are you an organized person?',
  question_translation = 'Você é uma pessoa organizada?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I''m very organized.","translation":"Sim, eu sou muito organizado/a."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I try to be organized.","translation":"Eu tento ser organizado/a."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Not always, but I use a calendar.","translation":"Nem sempre, mas eu uso uma agenda."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I''m organized at work but less organized at home.","translation":"Eu sou organizado/a no trabalho, mas menos em casa."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I like making lists and planning my week in advance.","translation":"Eu gosto de fazer listas e planejar minha semana com antecedência."}]'::jsonb
where display_order = 76;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Are you usually calm or energetic?',
  77,
  'Você costuma ser uma pessoa calma ou cheia de energia?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I''m usually calm.","translation":"Eu geralmente sou calmo/a."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I''m quite energetic.","translation":"Eu sou bastante cheio/a de energia."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''m calm most of the time.","translation":"Eu sou calmo/a na maior parte do tempo."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"It depends on the day.","translation":"Depende do dia."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I''m calm at work, but more energetic when I''m with friends.","translation":"Eu sou calmo/a no trabalho, mas mais animado/a quando estou com amigos."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 77
);

update public.conversation_questions
set
  question_text = 'Are you usually calm or energetic?',
  question_translation = 'Você costuma ser uma pessoa calma ou cheia de energia?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I''m usually calm.","translation":"Eu geralmente sou calmo/a."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I''m quite energetic.","translation":"Eu sou bastante cheio/a de energia."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''m calm most of the time.","translation":"Eu sou calmo/a na maior parte do tempo."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"It depends on the day.","translation":"Depende do dia."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I''m calm at work, but more energetic when I''m with friends.","translation":"Eu sou calmo/a no trabalho, mas mais animado/a quando estou com amigos."}]'::jsonb
where display_order = 77;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Do you like meeting new people?',
  78,
  'Você gosta de conhecer pessoas novas?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I enjoy meeting new people.","translation":"Sim, eu gosto de conhecer pessoas novas."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Yes, especially when I travel.","translation":"Sim, especialmente quando viajo."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Sometimes, although I''m a little shy at first.","translation":"Às vezes, embora eu seja um pouco tímido/a no início."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Not very much. I prefer small groups.","translation":"Não muito. Eu prefiro grupos pequenos."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"Yes, but I usually need some time to feel comfortable.","translation":"Sim, mas geralmente preciso de algum tempo para me sentir à vontade."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 78
);

update public.conversation_questions
set
  question_text = 'Do you like meeting new people?',
  question_translation = 'Você gosta de conhecer pessoas novas?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I enjoy meeting new people.","translation":"Sim, eu gosto de conhecer pessoas novas."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Yes, especially when I travel.","translation":"Sim, especialmente quando viajo."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Sometimes, although I''m a little shy at first.","translation":"Às vezes, embora eu seja um pouco tímido/a no início."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Not very much. I prefer small groups.","translation":"Não muito. Eu prefiro grupos pequenos."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"Yes, but I usually need some time to feel comfortable.","translation":"Sim, mas geralmente preciso de algum tempo para me sentir à vontade."}]'::jsonb
where display_order = 78;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Do you prefer talking or listening?',
  79,
  'Você prefere falar ou ouvir?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I prefer listening.","translation":"Eu prefiro ouvir."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I like talking more.","translation":"Eu gosto mais de falar."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I enjoy both.","translation":"Eu gosto dos dois."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I usually listen first and then share my opinion.","translation":"Eu geralmente ouço primeiro e depois compartilho minha opinião."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"It depends on the conversation, but I''m generally a good listener.","translation":"Depende da conversa, mas no geral sou um bom ouvinte/uma boa ouvinte."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 79
);

update public.conversation_questions
set
  question_text = 'Do you prefer talking or listening?',
  question_translation = 'Você prefere falar ou ouvir?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I prefer listening.","translation":"Eu prefiro ouvir."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I like talking more.","translation":"Eu gosto mais de falar."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I enjoy both.","translation":"Eu gosto dos dois."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I usually listen first and then share my opinion.","translation":"Eu geralmente ouço primeiro e depois compartilho minha opinião."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"It depends on the conversation, but I''m generally a good listener.","translation":"Depende da conversa, mas no geral sou um bom ouvinte/uma boa ouvinte."}]'::jsonb
where display_order = 79;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What makes you happy?',
  80,
  'O que deixa você feliz?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Spending time with my family makes me happy.","translation":"Passar tempo com minha família me deixa feliz."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Good music makes me happy.","translation":"Boa música me deixa feliz."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I feel happy when I''m with friends.","translation":"Eu fico feliz quando estou com amigos."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Learning something new makes me happy.","translation":"Aprender algo novo me deixa feliz."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"Simple things like a quiet morning and a good conversation make me happy.","translation":"Coisas simples, como uma manhã tranquila e uma boa conversa, me deixam feliz."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 80
);

update public.conversation_questions
set
  question_text = 'What makes you happy?',
  question_translation = 'O que deixa você feliz?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Spending time with my family makes me happy.","translation":"Passar tempo com minha família me deixa feliz."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Good music makes me happy.","translation":"Boa música me deixa feliz."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I feel happy when I''m with friends.","translation":"Eu fico feliz quando estou com amigos."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Learning something new makes me happy.","translation":"Aprender algo novo me deixa feliz."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"Simple things like a quiet morning and a good conversation make me happy.","translation":"Coisas simples, como uma manhã tranquila e uma boa conversa, me deixam feliz."}]'::jsonb
where display_order = 80;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What makes you laugh?',
  81,
  'O que faz você rir?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Funny movies make me laugh.","translation":"Filmes engraçados me fazem rir."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"My friends make me laugh a lot.","translation":"Meus amigos me fazem rir muito."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I laugh at silly jokes.","translation":"Eu rio de piadas bobas."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Unexpected situations often make me laugh.","translation":"Situações inesperadas frequentemente me fazem rir."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I laugh most when I''m relaxed and talking with people I know well.","translation":"Eu rio mais quando estou relaxado/a e conversando com pessoas que conheço bem."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 81
);

update public.conversation_questions
set
  question_text = 'What makes you laugh?',
  question_translation = 'O que faz você rir?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Funny movies make me laugh.","translation":"Filmes engraçados me fazem rir."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"My friends make me laugh a lot.","translation":"Meus amigos me fazem rir muito."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I laugh at silly jokes.","translation":"Eu rio de piadas bobas."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Unexpected situations often make me laugh.","translation":"Situações inesperadas frequentemente me fazem rir."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I laugh most when I''m relaxed and talking with people I know well.","translation":"Eu rio mais quando estou relaxado/a e conversando com pessoas que conheço bem."}]'::jsonb
where display_order = 81;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What helps you relax?',
  82,
  'O que ajuda você a relaxar?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Listening to music helps me relax.","translation":"Ouvir música me ajuda a relaxar."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I relax by taking a walk.","translation":"Eu relaxo fazendo uma caminhada."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Reading helps me unwind.","translation":"Ler me ajuda a relaxar."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I like watching a series after work.","translation":"Eu gosto de assistir a uma série depois do trabalho."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"A quiet evening at home with no plans helps me relax the most.","translation":"Uma noite tranquila em casa, sem planos, é o que mais me ajuda a relaxar."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 82
);

update public.conversation_questions
set
  question_text = 'What helps you relax?',
  question_translation = 'O que ajuda você a relaxar?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Listening to music helps me relax.","translation":"Ouvir música me ajuda a relaxar."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I relax by taking a walk.","translation":"Eu relaxo fazendo uma caminhada."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Reading helps me unwind.","translation":"Ler me ajuda a relaxar."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I like watching a series after work.","translation":"Eu gosto de assistir a uma série depois do trabalho."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"A quiet evening at home with no plans helps me relax the most.","translation":"Uma noite tranquila em casa, sem planos, é o que mais me ajuda a relaxar."}]'::jsonb
where display_order = 82;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What are you afraid of?',
  83,
  'Do que você tem medo?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I''m afraid of heights.","translation":"Eu tenho medo de altura."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I''m scared of snakes.","translation":"Eu tenho medo de cobras."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I don''t like flying very much.","translation":"Eu não gosto muito de voar."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I''m afraid of losing people I love.","translation":"Eu tenho medo de perder pessoas que amo."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I have a few fears, but I try not to let them control my decisions.","translation":"Eu tenho alguns medos, mas tento não deixar que controlem minhas decisões."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 83
);

update public.conversation_questions
set
  question_text = 'What are you afraid of?',
  question_translation = 'Do que você tem medo?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I''m afraid of heights.","translation":"Eu tenho medo de altura."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I''m scared of snakes.","translation":"Eu tenho medo de cobras."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I don''t like flying very much.","translation":"Eu não gosto muito de voar."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I''m afraid of losing people I love.","translation":"Eu tenho medo de perder pessoas que amo."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I have a few fears, but I try not to let them control my decisions.","translation":"Eu tenho alguns medos, mas tento não deixar que controlem minhas decisões."}]'::jsonb
where display_order = 83;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What are you proud of?',
  84,
  'Do que você se orgulha?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I''m proud of my family.","translation":"Eu me orgulho da minha família."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I''m proud of my career.","translation":"Eu me orgulho da minha carreira."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''m proud of finishing my degree.","translation":"Eu me orgulho de ter concluído minha graduação."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I''m proud of how much I''ve learned.","translation":"Eu me orgulho do quanto aprendi."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I''m especially proud of the challenges I''ve overcome in the last few years.","translation":"Eu me orgulho especialmente dos desafios que superei nos últimos anos."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 84
);

update public.conversation_questions
set
  question_text = 'What are you proud of?',
  question_translation = 'Do que você se orgulha?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I''m proud of my family.","translation":"Eu me orgulho da minha família."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I''m proud of my career.","translation":"Eu me orgulho da minha carreira."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''m proud of finishing my degree.","translation":"Eu me orgulho de ter concluído minha graduação."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I''m proud of how much I''ve learned.","translation":"Eu me orgulho do quanto aprendi."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I''m especially proud of the challenges I''ve overcome in the last few years.","translation":"Eu me orgulho especialmente dos desafios que superei nos últimos anos."}]'::jsonb
where display_order = 84;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What is something you are good at?',
  85,
  'Em que você é bom/boa?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I''m good at cooking.","translation":"Eu sou bom/boa em cozinhar."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I''m good at solving problems.","translation":"Eu sou bom/boa em resolver problemas."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''m good at organizing things.","translation":"Eu sou bom/boa em organizar coisas."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I''m pretty good at explaining ideas.","translation":"Eu sou bastante bom/boa em explicar ideias."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I''d say I''m good at staying calm and finding practical solutions.","translation":"Eu diria que sou bom/boa em manter a calma e encontrar soluções práticas."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 85
);

update public.conversation_questions
set
  question_text = 'What is something you are good at?',
  question_translation = 'Em que você é bom/boa?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I''m good at cooking.","translation":"Eu sou bom/boa em cozinhar."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I''m good at solving problems.","translation":"Eu sou bom/boa em resolver problemas."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''m good at organizing things.","translation":"Eu sou bom/boa em organizar coisas."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I''m pretty good at explaining ideas.","translation":"Eu sou bastante bom/boa em explicar ideias."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I''d say I''m good at staying calm and finding practical solutions.","translation":"Eu diria que sou bom/boa em manter a calma e encontrar soluções práticas."}]'::jsonb
where display_order = 85;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What would you like to learn?',
  86,
  'O que você gostaria de aprender?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I''d like to learn Spanish.","translation":"Eu gostaria de aprender espanhol."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I want to learn how to play the piano.","translation":"Eu quero aprender a tocar piano."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''d like to improve my English.","translation":"Eu gostaria de melhorar meu inglês."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I want to learn more about technology.","translation":"Eu quero aprender mais sobre tecnologia."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I''d like to learn a skill that I can use both at work and in my personal life.","translation":"Eu gostaria de aprender uma habilidade que possa usar tanto no trabalho quanto na vida pessoal."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 86
);

update public.conversation_questions
set
  question_text = 'What would you like to learn?',
  question_translation = 'O que você gostaria de aprender?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I''d like to learn Spanish.","translation":"Eu gostaria de aprender espanhol."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I want to learn how to play the piano.","translation":"Eu quero aprender a tocar piano."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''d like to improve my English.","translation":"Eu gostaria de melhorar meu inglês."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I want to learn more about technology.","translation":"Eu quero aprender mais sobre tecnologia."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I''d like to learn a skill that I can use both at work and in my personal life.","translation":"Eu gostaria de aprender uma habilidade que possa usar tanto no trabalho quanto na vida pessoal."}]'::jsonb
where display_order = 86;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What is something new you learned recently?',
  87,
  'O que você aprendeu de novo recentemente?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I learned a new English expression.","translation":"Eu aprendi uma expressão nova em inglês."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I learned how to make a new recipe.","translation":"Eu aprendi a fazer uma receita nova."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I recently learned a new feature at work.","translation":"Eu aprendi recentemente um recurso novo no trabalho."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I learned a better way to organize my schedule.","translation":"Eu aprendi uma maneira melhor de organizar minha agenda."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"Recently, I learned something useful about a topic I''d been curious about for a long time.","translation":"Recentemente, aprendi algo útil sobre um assunto pelo qual eu tinha curiosidade há muito tempo."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 87
);

update public.conversation_questions
set
  question_text = 'What is something new you learned recently?',
  question_translation = 'O que você aprendeu de novo recentemente?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I learned a new English expression.","translation":"Eu aprendi uma expressão nova em inglês."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I learned how to make a new recipe.","translation":"Eu aprendi a fazer uma receita nova."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I recently learned a new feature at work.","translation":"Eu aprendi recentemente um recurso novo no trabalho."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I learned a better way to organize my schedule.","translation":"Eu aprendi uma maneira melhor de organizar minha agenda."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"Recently, I learned something useful about a topic I''d been curious about for a long time.","translation":"Recentemente, aprendi algo útil sobre um assunto pelo qual eu tinha curiosidade há muito tempo."}]'::jsonb
where display_order = 87;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What was your favorite subject at school?',
  88,
  'Qual era a sua matéria favorita na escola?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"My favorite subject was English.","translation":"Minha matéria favorita era inglês."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I liked history the most.","translation":"Eu gostava mais de história."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Math was my favorite subject.","translation":"Matemática era a minha matéria favorita."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I really enjoyed geography.","translation":"Eu gostava muito de geografia."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I liked science because I enjoyed understanding how things work.","translation":"Eu gostava de ciências porque gostava de entender como as coisas funcionam."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 88
);

update public.conversation_questions
set
  question_text = 'What was your favorite subject at school?',
  question_translation = 'Qual era a sua matéria favorita na escola?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"My favorite subject was English.","translation":"Minha matéria favorita era inglês."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I liked history the most.","translation":"Eu gostava mais de história."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Math was my favorite subject.","translation":"Matemática era a minha matéria favorita."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I really enjoyed geography.","translation":"Eu gostava muito de geografia."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I liked science because I enjoyed understanding how things work.","translation":"Eu gostava de ciências porque gostava de entender como as coisas funcionam."}]'::jsonb
where display_order = 88;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Did you enjoy school?',
  89,
  'Você gostava da escola?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I did.","translation":"Sim, eu gostava."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Yes, I really enjoyed school.","translation":"Sim, eu gostava muito da escola."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Mostly, yes.","translation":"Na maior parte, sim."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Not very much, but I liked some subjects.","translation":"Não muito, mas eu gostava de algumas matérias."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I enjoyed learning, although I didn''t like every part of school life.","translation":"Eu gostava de aprender, embora não gostasse de todos os aspectos da vida escolar."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 89
);

update public.conversation_questions
set
  question_text = 'Did you enjoy school?',
  question_translation = 'Você gostava da escola?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I did.","translation":"Sim, eu gostava."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Yes, I really enjoyed school.","translation":"Sim, eu gostava muito da escola."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Mostly, yes.","translation":"Na maior parte, sim."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Not very much, but I liked some subjects.","translation":"Não muito, mas eu gostava de algumas matérias."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I enjoyed learning, although I didn''t like every part of school life.","translation":"Eu gostava de aprender, embora não gostasse de todos os aspectos da vida escolar."}]'::jsonb
where display_order = 89;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What is your dream job?',
  90,
  'Qual é o emprego dos seus sonhos?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"My dream job is to be a teacher.","translation":"Meu emprego dos sonhos é ser professor/a."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I''d love to work as a pilot.","translation":"Eu adoraria trabalhar como piloto."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"My dream is to run my own business.","translation":"Meu sonho é ter meu próprio negócio."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I''d like a job that lets me travel.","translation":"Eu gostaria de um trabalho que me permitisse viajar."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"My ideal job would be meaningful, flexible, and connected to something I enjoy.","translation":"Meu trabalho ideal seria significativo, flexível e ligado a algo de que eu gosto."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 90
);

update public.conversation_questions
set
  question_text = 'What is your dream job?',
  question_translation = 'Qual é o emprego dos seus sonhos?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"My dream job is to be a teacher.","translation":"Meu emprego dos sonhos é ser professor/a."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I''d love to work as a pilot.","translation":"Eu adoraria trabalhar como piloto."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"My dream is to run my own business.","translation":"Meu sonho é ter meu próprio negócio."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I''d like a job that lets me travel.","translation":"Eu gostaria de um trabalho que me permitisse viajar."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"My ideal job would be meaningful, flexible, and connected to something I enjoy.","translation":"Meu trabalho ideal seria significativo, flexível e ligado a algo de que eu gosto."}]'::jsonb
where display_order = 90;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Do you like your current job?',
  91,
  'Você gosta do seu trabalho atual?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I do.","translation":"Sim, eu gosto."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Yes, I really enjoy my job.","translation":"Sim, eu gosto muito do meu trabalho."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Most of the time, yes.","translation":"Na maior parte do tempo, sim."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"It''s okay, but I''d like a new challenge.","translation":"É bom, mas eu gostaria de um novo desafio."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I like many parts of it, especially the people and the opportunities to learn.","translation":"Eu gosto de muitos aspectos, especialmente das pessoas e das oportunidades de aprender."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 91
);

update public.conversation_questions
set
  question_text = 'Do you like your current job?',
  question_translation = 'Você gosta do seu trabalho atual?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, I do.","translation":"Sim, eu gosto."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Yes, I really enjoy my job.","translation":"Sim, eu gosto muito do meu trabalho."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Most of the time, yes.","translation":"Na maior parte do tempo, sim."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"It''s okay, but I''d like a new challenge.","translation":"É bom, mas eu gostaria de um novo desafio."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I like many parts of it, especially the people and the opportunities to learn.","translation":"Eu gosto de muitos aspectos, especialmente das pessoas e das oportunidades de aprender."}]'::jsonb
where display_order = 91;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What is the best thing about your job?',
  92,
  'Qual é a melhor coisa no seu trabalho?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"The best thing is the people I work with.","translation":"A melhor coisa são as pessoas com quem trabalho."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I like the flexibility.","translation":"Eu gosto da flexibilidade."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I enjoy solving problems.","translation":"Eu gosto de resolver problemas."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"The best part is learning new things.","translation":"A melhor parte é aprender coisas novas."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"What I like most is seeing the results of my work and knowing it was useful.","translation":"O que mais gosto é ver os resultados do meu trabalho e saber que ele foi útil."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 92
);

update public.conversation_questions
set
  question_text = 'What is the best thing about your job?',
  question_translation = 'Qual é a melhor coisa no seu trabalho?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"The best thing is the people I work with.","translation":"A melhor coisa são as pessoas com quem trabalho."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I like the flexibility.","translation":"Eu gosto da flexibilidade."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I enjoy solving problems.","translation":"Eu gosto de resolver problemas."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"The best part is learning new things.","translation":"A melhor parte é aprender coisas novas."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"What I like most is seeing the results of my work and knowing it was useful.","translation":"O que mais gosto é ver os resultados do meu trabalho e saber que ele foi útil."}]'::jsonb
where display_order = 92;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What do you usually do after work?',
  93,
  'O que você costuma fazer depois do trabalho?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I usually go home and relax.","translation":"Eu geralmente vou para casa e relaxo."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I go to the gym after work.","translation":"Eu vou à academia depois do trabalho."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I usually have dinner with my family.","translation":"Eu geralmente janto com minha família."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Sometimes I meet friends or run errands.","translation":"Às vezes eu encontro amigos ou resolvo algumas coisas."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"After work, I try to disconnect, have dinner, and do something relaxing.","translation":"Depois do trabalho, eu tento me desligar, jantar e fazer algo relaxante."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 93
);

update public.conversation_questions
set
  question_text = 'What do you usually do after work?',
  question_translation = 'O que você costuma fazer depois do trabalho?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I usually go home and relax.","translation":"Eu geralmente vou para casa e relaxo."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I go to the gym after work.","translation":"Eu vou à academia depois do trabalho."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I usually have dinner with my family.","translation":"Eu geralmente janto com minha família."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Sometimes I meet friends or run errands.","translation":"Às vezes eu encontro amigos ou resolvo algumas coisas."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"After work, I try to disconnect, have dinner, and do something relaxing.","translation":"Depois do trabalho, eu tento me desligar, jantar e fazer algo relaxante."}]'::jsonb
where display_order = 93;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What is the most difficult thing about your job?',
  94,
  'Qual é a coisa mais difícil no seu trabalho?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"The workload can be difficult.","translation":"A carga de trabalho pode ser difícil."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Deadlines are sometimes stressful.","translation":"Prazos às vezes são estressantes."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"The hardest part is dealing with unexpected problems.","translation":"A parte mais difícil é lidar com problemas inesperados."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Communication can be challenging sometimes.","translation":"A comunicação pode ser desafiadora às vezes."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"The most difficult part is balancing several priorities at the same time.","translation":"A parte mais difícil é equilibrar várias prioridades ao mesmo tempo."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 94
);

update public.conversation_questions
set
  question_text = 'What is the most difficult thing about your job?',
  question_translation = 'Qual é a coisa mais difícil no seu trabalho?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"The workload can be difficult.","translation":"A carga de trabalho pode ser difícil."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"Deadlines are sometimes stressful.","translation":"Prazos às vezes são estressantes."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"The hardest part is dealing with unexpected problems.","translation":"A parte mais difícil é lidar com problemas inesperados."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Communication can be challenging sometimes.","translation":"A comunicação pode ser desafiadora às vezes."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"The most difficult part is balancing several priorities at the same time.","translation":"A parte mais difícil é equilibrar várias prioridades ao mesmo tempo."}]'::jsonb
where display_order = 94;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Would you like to change careers someday?',
  95,
  'Você gostaria de mudar de carreira algum dia?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, maybe someday.","translation":"Sim, talvez algum dia."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"No, I''m happy with my career.","translation":"Não, eu estou feliz com a minha carreira."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''d consider changing careers for the right opportunity.","translation":"Eu consideraria mudar de carreira pela oportunidade certa."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I might move into a different area of my field.","translation":"Talvez eu mude para uma área diferente dentro da minha profissão."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I''m open to a change, but I''d want it to build on the experience I already have.","translation":"Eu estou aberto/a a uma mudança, mas gostaria que ela aproveitasse a experiência que já tenho."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 95
);

update public.conversation_questions
set
  question_text = 'Would you like to change careers someday?',
  question_translation = 'Você gostaria de mudar de carreira algum dia?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Yes, maybe someday.","translation":"Sim, talvez algum dia."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"No, I''m happy with my career.","translation":"Não, eu estou feliz com a minha carreira."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''d consider changing careers for the right opportunity.","translation":"Eu consideraria mudar de carreira pela oportunidade certa."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I might move into a different area of my field.","translation":"Talvez eu mude para uma área diferente dentro da minha profissão."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I''m open to a change, but I''d want it to build on the experience I already have.","translation":"Eu estou aberto/a a uma mudança, mas gostaria que ela aproveitasse a experiência que já tenho."}]'::jsonb
where display_order = 95;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What are your plans for the future?',
  96,
  'Quais são os seus planos para o futuro?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I want to keep learning and growing.","translation":"Eu quero continuar aprendendo e evoluindo."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I plan to travel more.","translation":"Eu planejo viajar mais."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I want to advance in my career.","translation":"Eu quero avançar na minha carreira."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I''d like to buy a house someday.","translation":"Eu gostaria de comprar uma casa algum dia."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"My main plans are to develop professionally, improve my English, and have more time for my family.","translation":"Meus principais planos são me desenvolver profissionalmente, melhorar meu inglês e ter mais tempo para minha família."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 96
);

update public.conversation_questions
set
  question_text = 'What are your plans for the future?',
  question_translation = 'Quais são os seus planos para o futuro?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I want to keep learning and growing.","translation":"Eu quero continuar aprendendo e evoluindo."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I plan to travel more.","translation":"Eu planejo viajar mais."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I want to advance in my career.","translation":"Eu quero avançar na minha carreira."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I''d like to buy a house someday.","translation":"Eu gostaria de comprar uma casa algum dia."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"My main plans are to develop professionally, improve my English, and have more time for my family.","translation":"Meus principais planos são me desenvolver profissionalmente, melhorar meu inglês e ter mais tempo para minha família."}]'::jsonb
where display_order = 96;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'Where do you see yourself in five years?',
  97,
  'Onde você se vê daqui a cinco anos?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I see myself in a better position at work.","translation":"Eu me vejo em uma posição melhor no trabalho."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I hope to be living in a new city.","translation":"Eu espero estar morando em uma cidade nova."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''d like to have my own business.","translation":"Eu gostaria de ter meu próprio negócio."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I hope to be more fluent in English.","translation":"Eu espero estar mais fluente em inglês."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"In five years, I hope to have grown professionally and built a balanced personal life.","translation":"Daqui a cinco anos, espero ter crescido profissionalmente e construído uma vida pessoal equilibrada."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 97
);

update public.conversation_questions
set
  question_text = 'Where do you see yourself in five years?',
  question_translation = 'Onde você se vê daqui a cinco anos?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I see myself in a better position at work.","translation":"Eu me vejo em uma posição melhor no trabalho."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I hope to be living in a new city.","translation":"Eu espero estar morando em uma cidade nova."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''d like to have my own business.","translation":"Eu gostaria de ter meu próprio negócio."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I hope to be more fluent in English.","translation":"Eu espero estar mais fluente em inglês."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"In five years, I hope to have grown professionally and built a balanced personal life.","translation":"Daqui a cinco anos, espero ter crescido profissionalmente e construído uma vida pessoal equilibrada."}]'::jsonb
where display_order = 97;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What is one goal you want to achieve?',
  98,
  'Qual é uma meta que você quer alcançar?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I want to become fluent in English.","translation":"Eu quero me tornar fluente em inglês."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I want to save more money.","translation":"Eu quero economizar mais dinheiro."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''d like to finish my degree.","translation":"Eu gostaria de concluir minha graduação."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I want to improve my health.","translation":"Eu quero melhorar minha saúde."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"One important goal is to feel confident using English in professional situations.","translation":"Uma meta importante é me sentir confiante usando inglês em situações profissionais."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 98
);

update public.conversation_questions
set
  question_text = 'What is one goal you want to achieve?',
  question_translation = 'Qual é uma meta que você quer alcançar?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I want to become fluent in English.","translation":"Eu quero me tornar fluente em inglês."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I want to save more money.","translation":"Eu quero economizar mais dinheiro."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''d like to finish my degree.","translation":"Eu gostaria de concluir minha graduação."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I want to improve my health.","translation":"Eu quero melhorar minha saúde."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"One important goal is to feel confident using English in professional situations.","translation":"Uma meta importante é me sentir confiante usando inglês em situações profissionais."}]'::jsonb
where display_order = 98;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What is something you want to do this year?',
  99,
  'O que você quer fazer este ano?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I want to travel somewhere new.","translation":"Eu quero viajar para algum lugar novo."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I want to read more books.","translation":"Eu quero ler mais livros."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''d like to start exercising regularly.","translation":"Eu gostaria de começar a me exercitar regularmente."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I want to improve my English.","translation":"Eu quero melhorar meu inglês."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"This year, I want to complete a personal project that I''ve been postponing.","translation":"Este ano, quero concluir um projeto pessoal que venho adiando."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 99
);

update public.conversation_questions
set
  question_text = 'What is something you want to do this year?',
  question_translation = 'O que você quer fazer este ano?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I want to travel somewhere new.","translation":"Eu quero viajar para algum lugar novo."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I want to read more books.","translation":"Eu quero ler mais livros."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''d like to start exercising regularly.","translation":"Eu gostaria de começar a me exercitar regularmente."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I want to improve my English.","translation":"Eu quero melhorar meu inglês."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"This year, I want to complete a personal project that I''ve been postponing.","translation":"Este ano, quero concluir um projeto pessoal que venho adiando."}]'::jsonb
where display_order = 99;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'If you could learn any skill, what would you choose?',
  100,
  'Se você pudesse aprender qualquer habilidade, qual escolheria?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I''d learn to play the piano.","translation":"Eu aprenderia a tocar piano."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I''d choose public speaking.","translation":"Eu escolheria falar em público."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''d learn another language.","translation":"Eu aprenderia outro idioma."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I''d like to learn how to code.","translation":"Eu gostaria de aprender a programar."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I''d choose a skill that combines creativity and technology, like design.","translation":"Eu escolheria uma habilidade que combinasse criatividade e tecnologia, como design."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 100
);

update public.conversation_questions
set
  question_text = 'If you could learn any skill, what would you choose?',
  question_translation = 'Se você pudesse aprender qualquer habilidade, qual escolheria?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I''d learn to play the piano.","translation":"Eu aprenderia a tocar piano."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I''d choose public speaking.","translation":"Eu escolheria falar em público."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''d learn another language.","translation":"Eu aprenderia outro idioma."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I''d like to learn how to code.","translation":"Eu gostaria de aprender a programar."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I''d choose a skill that combines creativity and technology, like design.","translation":"Eu escolheria uma habilidade que combinasse criatividade e tecnologia, como design."}]'::jsonb
where display_order = 100;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'If you could live anywhere in the world, where would you live?',
  101,
  'Se você pudesse morar em qualquer lugar do mundo, onde moraria?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I''d live in Portugal.","translation":"Eu moraria em Portugal."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I''d choose Canada.","translation":"Eu escolheria o Canadá."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''d love to live in Italy.","translation":"Eu adoraria morar na Itália."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I think I''d stay in Brazil, but near the beach.","translation":"Acho que eu ficaria no Brasil, mas perto da praia."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I''d probably choose a safe, walkable city with good weather and plenty of cultural activities.","translation":"Eu provavelmente escolheria uma cidade segura, fácil de percorrer a pé, com bom clima e muitas atividades culturais."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 101
);

update public.conversation_questions
set
  question_text = 'If you could live anywhere in the world, where would you live?',
  question_translation = 'Se você pudesse morar em qualquer lugar do mundo, onde moraria?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I''d live in Portugal.","translation":"Eu moraria em Portugal."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I''d choose Canada.","translation":"Eu escolheria o Canadá."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''d love to live in Italy.","translation":"Eu adoraria morar na Itália."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I think I''d stay in Brazil, but near the beach.","translation":"Acho que eu ficaria no Brasil, mas perto da praia."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I''d probably choose a safe, walkable city with good weather and plenty of cultural activities.","translation":"Eu provavelmente escolheria uma cidade segura, fácil de percorrer a pé, com bom clima e muitas atividades culturais."}]'::jsonb
where display_order = 101;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'If you could meet any famous person, who would you choose?',
  102,
  'Se você pudesse conhecer qualquer pessoa famosa, quem escolheria?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I''d choose Barack Obama.","translation":"Eu escolheria Barack Obama."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I''d love to meet a famous musician I admire.","translation":"Eu adoraria conhecer um músico famoso que admiro."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''d like to meet a scientist such as Neil deGrasse Tyson.","translation":"Eu gostaria de conhecer um cientista como Neil deGrasse Tyson."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I''d choose an actor I really like.","translation":"Eu escolheria um ator de quem gosto muito."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I''d probably meet someone whose work has influenced my career, so I could ask them questions.","translation":"Eu provavelmente conheceria alguém cujo trabalho influenciou minha carreira, para poder fazer perguntas."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 102
);

update public.conversation_questions
set
  question_text = 'If you could meet any famous person, who would you choose?',
  question_translation = 'Se você pudesse conhecer qualquer pessoa famosa, quem escolheria?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I''d choose Barack Obama.","translation":"Eu escolheria Barack Obama."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I''d love to meet a famous musician I admire.","translation":"Eu adoraria conhecer um músico famoso que admiro."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''d like to meet a scientist such as Neil deGrasse Tyson.","translation":"Eu gostaria de conhecer um cientista como Neil deGrasse Tyson."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I''d choose an actor I really like.","translation":"Eu escolheria um ator de quem gosto muito."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I''d probably meet someone whose work has influenced my career, so I could ask them questions.","translation":"Eu provavelmente conheceria alguém cujo trabalho influenciou minha carreira, para poder fazer perguntas."}]'::jsonb
where display_order = 102;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'If you had a free day tomorrow, what would you do?',
  103,
  'Se você tivesse um dia livre amanhã, o que faria?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I''d sleep a little longer.","translation":"Eu dormiria um pouco mais."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I''d spend the day with my family.","translation":"Eu passaria o dia com minha família."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''d go somewhere outdoors.","translation":"Eu iria a algum lugar ao ar livre."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I''d watch movies and relax at home.","translation":"Eu assistiria a filmes e relaxaria em casa."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I''d have a slow morning, go out for lunch, and do something I normally don''t have time for.","translation":"Eu teria uma manhã tranquila, sairia para almoçar e faria algo para o qual normalmente não tenho tempo."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 103
);

update public.conversation_questions
set
  question_text = 'If you had a free day tomorrow, what would you do?',
  question_translation = 'Se você tivesse um dia livre amanhã, o que faria?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"I''d sleep a little longer.","translation":"Eu dormiria um pouco mais."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"I''d spend the day with my family.","translation":"Eu passaria o dia com minha família."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"I''d go somewhere outdoors.","translation":"Eu iria a algum lugar ao ar livre."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"I''d watch movies and relax at home.","translation":"Eu assistiria a filmes e relaxaria em casa."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"I''d have a slow morning, go out for lunch, and do something I normally don''t have time for.","translation":"Eu teria uma manhã tranquila, sairia para almoçar e faria algo para o qual normalmente não tenho tempo."}]'::jsonb
where display_order = 103;

insert into public.conversation_questions (
  question_text,
  display_order,
  question_translation,
  answer_examples
)
select
  'What is something most people do not know about you?',
  104,
  'O que é algo que a maioria das pessoas não sabe sobre você?',
  '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Most people don''t know that I can play the guitar.","translation":"A maioria das pessoas não sabe que eu sei tocar violão."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"People are often surprised that I enjoy cooking.","translation":"As pessoas frequentemente se surpreendem ao saber que eu gosto de cozinhar."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Not many people know that I used to be very shy.","translation":"Poucas pessoas sabem que eu costumava ser muito tímido/a."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Most people don''t know that I collect old books.","translation":"A maioria das pessoas não sabe que eu coleciono livros antigos."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"One thing people usually discover only after knowing me for a while is that I really enjoy writing.","translation":"Uma coisa que as pessoas geralmente só descobrem depois de me conhecer por um tempo é que eu gosto muito de escrever."}]'::jsonb
where not exists (
  select 1
  from public.conversation_questions
  where display_order = 104
);

update public.conversation_questions
set
  question_text = 'What is something most people do not know about you?',
  question_translation = 'O que é algo que a maioria das pessoas não sabe sobre você?',
  answer_examples = '[{"note":"Resposta direta e neutra, adequada para a maioria das situações.","answer":"Most people don''t know that I can play the guitar.","translation":"A maioria das pessoas não sabe que eu sei tocar violão."},{"note":"Opção natural e informal para conversas do dia a dia.","answer":"People are often surprised that I enjoy cooking.","translation":"As pessoas frequentemente se surpreendem ao saber que eu gosto de cozinhar."},{"note":"Resposta um pouco mais detalhada, útil para manter a conversa.","answer":"Not many people know that I used to be very shy.","translation":"Poucas pessoas sabem que eu costumava ser muito tímido/a."},{"note":"Alternativa que acrescenta contexto e ajuda a desenvolver a interação.","answer":"Most people don''t know that I collect old books.","translation":"A maioria das pessoas não sabe que eu coleciono livros antigos."},{"note":"Resposta mais pessoal ou específica para quando você quiser elaborar.","answer":"One thing people usually discover only after knowing me for a while is that I really enjoy writing.","translation":"Uma coisa que as pessoas geralmente só descobrem depois de me conhecer por um tempo é que eu gosto muito de escrever."}]'::jsonb
where display_order = 104;

do $validation$
declare
  total_questions integer;
  complete_questions integer;
begin
  select count(*)::integer
  into total_questions
  from public.conversation_questions;

  select count(*)::integer
  into complete_questions
  from public.conversation_questions
  where nullif(btrim(question_translation), '') is not null
    and jsonb_typeof(answer_examples) = 'array'
    and jsonb_array_length(answer_examples) = 5;

  if total_questions <> 104 then
    raise exception 'Expected 104 conversation questions, found %.', total_questions;
  end if;

  if complete_questions <> total_questions then
    raise exception 'Conversation question cards are incomplete: % of % are complete.', complete_questions, total_questions;
  end if;
end;
$validation$;

alter table public.conversation_questions
  alter column question_translation set not null,
  alter column answer_examples set not null;

alter table public.conversation_questions
  drop constraint if exists conversation_questions_translation_check,
  add constraint conversation_questions_translation_check
    check (char_length(btrim(question_translation)) between 1 and 500),
  drop constraint if exists conversation_questions_answer_examples_check,
  add constraint conversation_questions_answer_examples_check
    check (
      jsonb_typeof(answer_examples) = 'array'
      and jsonb_array_length(answer_examples) = 5
    );
