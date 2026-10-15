# TAREFAS PARA CASA — Plano técnico e critérios de liberação

## Estado atual: ETAPA 1 — Fundação e Arquitetura

O recurso é desenvolvido no repositório TeacherFlavius e permanece desativado para alunos.
A etapa inicial entrega apenas a pré-visualização estrutural de professor na rota
/area-do-estudante/homeworks/. Não existe atividade publicável, resposta de aluno,
correção por IA, pontuação ou integração nova de banco nesta etapa.

O Portal de Exercícios existente continua independente e inalterado.

## Decisões funcionais consolidadas

1. Sequência de atividades numeradas começando em 1 e repetindo Reading, Writing e Grammar.
2. Cada futura atividade terá rota limpa /atividade_N/, mas essas rotas **não serão criadas**
   antes da implantação do controle de acesso aos dados e da liberação do produto.
3. Reading: um texto em inglês e 10 perguntas em português.
4. Writing: enunciado, orientações, modelo/apoios apropriados inicialmente a A1/A2, área
   de produção escrita e botão Enviar. Após o envio, a IA apresenta nota de 0 a 10,
   avaliação geral, texto original, texto corrigido com alterações destacadas e
   explicações em português. Não incluir "O que estudar agora?".
5. Grammar: explicação e exemplos antes dos exercícios.
6. Listening e Pronunciation não fazem parte do recurso.
7. O professor deve autorizar a disponibilização aos alunos explicitamente, mesmo
   depois de todos os testes. Não antecipar essa liberação.

## Responsabilidades dos módulos desta etapa

- homework_activity_model.js: cálculo puro da sequência, numeração, títulos,
  rotas futuras e estado inicial de rascunho. Não contém material didático.
- homework_access_service.js: verifica sessão e exige a confirmação
  **no servidor** pela RPC já existente is_teacher_admin. Em caso de erro,
  falha em modo fechado, sem autorizar a pré-visualização.
- area-do-estudante/homeworks/: página de pré-visualização estrutural que só
  renderiza o catálogo para professor autorizado. Nenhum link novo foi
  acrescentado à Área do Estudante nem à navegação pública.
- tests/homework_foundation_contract.test.js: contratos da sequência, estado
  inicial não publicado, bloqueio de aluno, falha segura e ausência de exposição
  antecipada.

**Limite de segurança importante:** esta é uma página estática publicada na web.
A autorização JavaScript limita a interface, mas não transforma o HTML/JS em
arquivos privados. Por isso, estes arquivos não incluem enunciados, respostas,
segredos ou dados pessoais. Na etapa de persistência, todas as leituras/escritas
de material e respostas deverão ter autorização efetiva no servidor com
RLS/RPC ou Edge Functions. Não confiar em botões ocultos ou apenas em papéis
validados no navegador.

## Próximas etapas propostas

1. Persistência do catálogo, conteúdos e rascunhos, com isolamento por
   professor, aluno e estado publicado; RLS/autorizações no backend.
2. Editor de Reading, Writing e Grammar e montagem das atividades sem expor
   rascunhos na aplicação do aluno.
3. Entrega, submissão, histórico e estados (rascunho, publicada, enviada,
   corrigida), com verificação de autoria no servidor.
4. Correção de Writing por IA via Edge Function autenticada (chave de API
   mantida exclusivamente no servidor, validação de tamanho e custo, proteção
   de privacidade, tratamento de erros, avaliação pedagógica da rubrica).
5. Testes de carga, isolamento entre alunos, acessibilidade, dispositivos móveis
   e liberação separada por decisão do professor.

Antes de qualquer alteração SQL, inspecionar esquema e migrações existentes,
validar o desenho em ambiente isolado e manter a baseline de restauração
sincronizada.

## SEO e publicação

A nova rota tem noindex, nofollow, noarchive, não possui link de menu nem entrada
no sitemap. Nenhuma página pública de marketing, canonical, sitemap ou robots.txt
foi alterada. A orientação noindex é coerente com o bloqueio de lançamento,
mas o impacto dessa decisão deve ser comunicado ao proprietário.
