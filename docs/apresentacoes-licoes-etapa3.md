# Apresentações das lições — etapa 3 de 5: visualização docente

## Situação

A página privada `/roteiro-da-aula/` agora contém um componente
para exibir as apresentações no card de cada aluno, imediatamente acima
de **PERGUNTAS ESTUDADAS**. Sua integração ao repositório **não é a
liberação aos usuários**. O componente docente define
`const RELEASE_ENABLED = false`, assim como o editor do aluno.

Enquanto essa trava estiver fechada, a consulta do roteiro continua
funcionando como antes, sem consultas às tabelas de apresentações.
Nenhuma tabela, política ou dado da produção é alterado por este merge.

## Comportamento preparado

O roteiro já obtém `student_id` e `lesson_number` pela RPC
`get_teacher_lesson_plan`. Esses valores formam a chave canônica
`<student_id>|lesson:<numero>`, idêntica à identidade usada na
página da lição. Consultas são agrupadas por aluno e por chave de lição
para evitar uma consulta por card; cada resultado só é associado ao
par completo. Lições não numeradas ainda não são exibidas no roteiro,
conforme o planejamento da etapa 1.

O card exibirá:
- **APRESENTAÇÃO NÃO ENVIADA** quando não houver texto salvo;
- **RECEBIDA · NÃO VISUALIZADA**, quando existir texto da versão atual
  ainda não aberto pelo professor;
- **RECEBIDA · VISUALIZADA**, quando existir recibo para a versão atual;
- número da revisão e horário da última edição em São Paulo;
- controle **LER APRESENTAÇÃO**, que abre o texto sem tratá-lo como HTML.

Ao abrir uma versão ainda não visualizada, uma inserção com
`presentation_id`, `revision_number` e `teacher_id` registra a
visualização. O horário vem do servidor. O navegador não pode fornecer
`viewed_at`, editar ou apagar recibos.

A migração `20261017144500_lesson_presentation_views_stage3.sql` depende
da migração da etapa 1 `20261017133000_lesson_presentations_stage1.sql`,
cria a tabela `lesson_presentation_views` e adiciona duas políticas
RLS. O docente autenticado só pode registrar a própria identidade para
a versão **atual**; o aluno não pode forjar leitura administrativa.
Professor e autor podem consultar os recibos sob RLS.

**Uma nova edição do aluno cria revisão nova.** A visualização de
uma revisão anterior permanece registrada no histórico, mas não altera
o indicador da nova versão, que volta a ser não visualizada.

O resultado de uma falha de conexão ou de autorização nunca será
apresentado como visualização confirmada. O código preserva o
comportamento atual do roteiro durante erros de consulta.

## Homologação e liberação

Os testes de contrato e de interface estão em
`tests/teacher_lesson_presentations.test.js`.
Os testes PostgreSQL em
`tests/fixtures/lesson_presentation_views_stage3_rls.sql` utilizam
identidades fictícias e `ROLLBACK` para comprovar isolamento,
imutabilidade, validação de revisão e negativas por papel.
O workflow `lesson-presentations-stage3-contract.yml` aplica
**somente em instância Supabase CLI descartável** as migrações das
etapas 1 e 3 sobre a reconstrução canônica.

A liberação deverá ocorrer na etapa 5, somente depois de homologar
migrações, RLS e procedimento de implantação no Supabase produtivo.
**Não habilitar isoladamente o editor do aluno nem a visualização
do professor.**

## SEO

Apenas componentes da página autenticada ROTEIRO DA AULA foram alterados.
A rota preserva o `noindex, nofollow`. URLs, títulos, robots, sitemap
e conteúdo público não mudaram. Essa é uma alteração de conteúdo de uma
página privada, sem mudança de indexação pretendida.

**Próxima etapa 4/5:** homologação integrada dos dois lados,
inclusive visualização e reenvio, concorrência, ausências, telas
pequenas, navegador móvel e aplicativo.
