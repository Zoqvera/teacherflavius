# TAREFAS PARA CASA — Plano técnico e critérios de liberação

## Histórico: ETAPA 1 — Fundação e Arquitetura

O recurso é desenvolvido no repositório TeacherFlavius e permanece desativado para alunos.
A ETAPA 2 acrescenta persistência e gerenciamento privativos ao professor, descritos ao final.
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


## ETAPA 2 — Estrutura do Banco de Dados e Gerenciamento das Atividades

Implementação administrativa isolada, sem migração de dados do Portal de Exercícios.

**Persistência:**

- `exercises`: catálogo, numeração automática, alternância Reading → Writing → Grammar, estado e versão publicada.
- `exercise_versions`: conteúdo editorial versionado; cada salvamento cria um snapshot adicional.
- `exercise_questions`: perguntas ordenadas, tipo e gabarito (exclusivos do servidor/professor).
- `exercise_assignments`: atribuições mantidas obrigatoriamente em `held`; nenhuma entrega é liberada.
- `exercise_attempts`, `exercise_answers` e `exercise_feedback`: preparação do histórico para próximas etapas, sem escrita de alunos nem integração com IA ainda.

A RLS exige a autorização `is_teacher_admin()` para todas as tabelas.
As três tabelas editoriais recebem grants explícitos mínimos ao papel autenticado, filtrado por RLS; respostas e feedback não recebem grants de acesso estudantil nem de escrita pelo navegador. Alunos e usuários não autenticados **não recebem nenhuma política de acesso**. A lista antiga de exercícios e respectivas tabelas permanecem intactas.

**Gerenciamento:** a rota de pré-visualização agora permite ao professor criar o próximo rascunho numerado, editar campos próprios de Reading, Writing e Grammar, salvar nova versão, aprová-la e marcar a publicação apenas internamente. A publicação é proibida sem aprovação de uma versão da mesma atividade. Reading exige dez perguntas com gabarito, Grammar ao menos uma e Writing não armazena perguntas objetivas. Versões aprovadas são imutáveis. Enunciados e gabaritos nunca são embutidos no HTML/JS estático.

**Publicação interna não significa liberação:** a autorização RLS continua exclusiva do professor inclusive quando `status='published'`. Atribuições permanecem `held`. Nenhuma rota `/atividade_N/`, botão de aluno, processamento de resposta ou Edge Function de IA está disponível. A liberação será objeto de uma etapa posterior e depende de autorização expressa.

**Operação e validação:** migração `supabase/migrations/20261015044000_homeworks_stage2_schema.sql`. Foi testada em transação de banco com `ROLLBACK`, incluindo criação, salvamento, aprovação, publicação e tentativas de leitura/escrita sem autorização. A migração deverá ser aplicada por fluxo versionado e auditado; **não executar reset no banco do repositório**, cuja baseline histórica não é reproduzível de forma limpa. Controles de revisão, testes automatizados e verificações de drift continuam obrigatórios.

**Próximos incrementos:** editor com formatos adicionais (múltipla escolha e recursos multimídia), design completo de atividades, atribuição/entrega dos alunos após autorização, correção e rubrica de Writing por IA no servidor, observabilidade/custo/privacidade e testes de usabilidade.

**SEO:** rota em desenvolvimento mantém `noindex, nofollow, noarchive`, sem inclusão no sitemap, links públicos ou mudanças em páginas comerciais.
