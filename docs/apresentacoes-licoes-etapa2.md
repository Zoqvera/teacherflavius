# Apresentações das lições — etapa 2 de 5: interface do aluno

## Estado de entrega

A interface foi implementada no código da rota autenticada `/licao/`,
mas permanece **intencionalmente desativada** até a implantação
controlada da migração da etapa 1 no Supabase de produção.

O módulo `lesson_presentation_editor.js` define
`const RELEASE_ENABLED = false`. O método `mount()` retorna antes de
consultar o banco. Não existe ativação por parâmetro de URL,
armazenamento local, cookie ou variável injetada pelo navegador.
**Não mudar a constante para `true` antes da etapa 5.**

A migração versionada `20261017133000_lesson_presentations_stage1.sql`
está no repositório, mas ainda não foi executada na produção.

## Fluxo implementado, condicionado à liberação

1. O aluno autenticado abre uma lição por `/licao/?lesson=N`,
   `/licao/?id=<uuid>`, via O QUE FAZER ou pelo ROTEIRO DE ESTUDOS.
2. O controlador da rota resolve um único identificador canônico:
   `lesson:N` para lições numeradas ou páginas vinculadas ao roteiro,
   `page:<uuid>` para páginas sem vínculo numérico.
3. Quando a funcionalidade estiver liberada, o editor carrega apenas a
   apresentação da identidade autenticada para essa chave canônica,
   respeitando o RLS definido na etapa 1.
4. O formulário aceita texto simples de 1 a 15.000 caracteres. O aluno
   envia por **ENVIAR APRESENTAÇÃO**.
5. Somente após confirmação da gravação no Supabase, o editor exibe
   **“Apresentação enviada ao professor.”**.
6. Havendo texto salvo, o aluno visualiza sua versão atual e o botão
   **EDITAR APRESENTAÇÃO**. A edição envia somente `body`, filtrando
   por autor, identificador e revisão já lida. Uma revisão diferente
   não é sobrescrita automaticamente: uma mensagem solicita recarregar
   a lição. O texto não salvo permanece no campo.
7. O histórico de revisões é criado no servidor, pelo gatilho da etapa 1,
   sem permissão de edição direta pelo cliente.

## Proteção e comportamento visual

- A seção HTML utiliza `hidden` e CSS explícito; impressão a omite.
- O formulário usa `label`, `aria-describedby`, contagem de caracteres,
  estado acessível de confirmação, botão desativado enquanto salva e
  disposição adaptável a telas pequenas.
- A interface preserva o material das lições, a confirmação de
  preparação e a navegação entre lições.
- Falha de carregamento não exibe o editor. Falha de salvamento não
  apresenta confirmação falsa nem apaga o rascunho digitado.
- O domínio produtivo **não** tenta consultar
  `lesson_presentations` até liberação explícita por alteração de código.

## Testes e próximos passos

O teste `tests/lesson_presentation_editor.test.js` valida a chave
canônica, a trava de liberação, criação, edição, controle de revisões,
preservação do rascunho, validações, acessibilidade e comportamento
de impressão. O workflow próprio e o comando `npm run quality`
incluem os testes de regressão.

**Etapa 3 de 5:** integrar a apresentação atual e o indicador de
recebimento/visualização no card do aluno da página
`/roteiro-da-aula/`, acima de **PERGUNTAS ESTUDADAS**; manter as
interfaces condicionadas ao mesmo processo de liberação.

**Etapa 4 de 5:** homologar os caminhos completos e papéis em testes
isolados, inclusive navegação, concorrência, mobile e acessibilidade.

**Etapa 5 de 5:** validar e executar a migração incremental no Supabase
de produção por procedimento aprovado, conferir as políticas RLS e
ativar explicitamente a trava de interface após verificação.

## SEO

Esta etapa modifica o corpo da página de lição, cuja configuração já
contém `noindex,nofollow`, e não altera `title`, `robots`, URL,
metadados, links canônicos, `robots.txt` ou `sitemap.xml`.
**Não há mudança de indexação planejada.** A inclusão do formulário
no HTML, ainda que oculto, constitui alteração de conteúdo da página
privada e está registrada para ciência antes da publicação. Qualquer
mudança futura que afete indexação ou conteúdo público será destacada
antes do merge.
