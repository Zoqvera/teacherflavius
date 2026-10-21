# Apresentações de lições — Etapa 5C/5: ativação sincronizada

Data: 17/10/2026.

## Evidência produtiva consultada diretamente após a implantação 5B

- [GitHub Actions #39049910463](https://github.com/Zoqvera/teacherflavius/actions/runs/39049910463): **sucesso** após início manual na branch `main`.
- Histórico produtivo Supabase: **318 migrações**, com as versões
  `20261017133000_lesson_presentations_stage1` e
  `20261017144500_lesson_presentation_views_stage3` exatamente registradas.
- As tabelas `public.lesson_presentations`,
  `public.lesson_presentation_versions` e
  `public.lesson_presentation_views` existem, têm **RLS habilitado**
  e tinham zero linhas no momento da auditoria.
- Seis políticas de RLS: propriedade do aluno para criar e editar,
  leitura do aluno ou professor, histórico somente leitura e recibos
  vinculados a versões atuais, gravados apenas por administrador docente.
- O aluno pode inserir/atualizar texto, mas não apagar apresentações,
  gravar revisões diretamente nem alterar recibos.
- `anon` não tem SELECT sobre nenhuma das três tabelas.
- `authenticated` pode inserir recibo somente nas colunas
  `presentation_id`, `revision_number` e `teacher_id`, sem
  permissão para fornecer `viewed_at`, editar ou apagar recibos.
- Funções privadas de gatilho não são executáveis diretamente por
  `anon` nem `authenticated`. A função de papel docente
  `public.is_teacher_admin()` consulta `teacher_admins` e não
  pode ser executada por `anon`.
- Dois gatilhos mantêm integridade/autoria e versões imutáveis.

Os avisos gerais do verificador de segurança do Supabase relacionados
a outras tabelas e funções já existiam e não foram modificados neste
escopo. Não foram identificados alertas do verificador dirigidos às
três novas tabelas.

## Alteração liberada

Os dois módulos mudam juntos para `RELEASE_ENABLED = true`,
sem ativação por URL, cookie ou armazenamento do navegador:

1. `lesson_presentation_editor.js`, na rota autenticada `/licao/`.
   O aluno salva a apresentação e recebe a mensagem
   “Apresentação enviada ao professor.”. Após o envio, o botão exibe
   “EDITAR APRESENTAÇÃO”. Edições preservam histórico e concorrem
   pelo número de revisão.
2. `teacher_lesson_presentations.js`, na rota autenticada
   `/roteiro-da-aula/`. O professor lê a apresentação no card
   correspondente, **antes de PERGUNTAS ESTUDADAS**. A abertura registra
   visualização somente da revisão atual, preservando recibos anteriores.

Os links dos scripts ganham nova versão em ambas as páginas privadas
para evitar o cache de versões ainda bloqueadas.

## Verificações e limitações

As etapas 2, 3 e 4 já incluem testes com dupla da Data API e testes
PostgreSQL reais em banco descartável, cobrindo escrita/autoria,
RLS, edição, concorrência e recibos. Os testes de liberação passam
a exigir os controles sincronizados em `true`.

**Não foi realizado login interativo com credenciais de alunos reais.**
Após a implantação web/mobile, a verificação operacional em sessões
autenticadas deve incluir envio, atualização, exibição no roteiro,
registro de visualização e nova revisão em navegador e aplicativo.
Não usar contas de estudantes para testes automatizados.

## Reversão

Se houver falhas de exibição/API, criar imediatamente uma PR revertendo
`RELEASE_ENABLED` para `false` **nos dois módulos**, atualizar os
parâmetros de versão dos scripts e integrar após checagens essenciais.
**Não apagar as tabelas**: elas podem conter textos de alunos e recibos
que devem ser preservados. Não executar `migration repair` ou
`supabase db push` em lote para reverter a interface.

## SEO

Somente o URL de versão de dois arquivos JavaScript muda nas páginas
autenticadas. Ambas preservam `noindex,nofollow`. Não há alteração em
`title`, canonical, `robots.txt`, sitemap, dados estruturados ou
páginas públicas. **Nenhuma alteração de indexação/SEO nesta etapa.**
