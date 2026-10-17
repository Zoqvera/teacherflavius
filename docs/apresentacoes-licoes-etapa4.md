# Apresentações dos alunos — etapa 4 de 5: homologação e plano de implantação

Data de referência: 17/10/2026. **O pacote permanece bloqueado em produção.**
Esta etapa produz evidências de integração e critérios de implantação;
não altera páginas, tabelas, histórico de migrações ou registros reais.

## 1. O que foi homologado em ambiente isolado

O teste de navegador em
`tests/lesson_presentations_stage4_full_flow.test.js`
executa **os próprios módulos do aluno e do professor**, com uma API
fictícia determinística compartilhada, sem Supabase produtivo:
envio inicial, confirmação após gravação, indicador RECEBIDA,
abertura com recibo, segunda revisão, retorno ao indicador
NÃO VISUALIZADA, nova visualização e preservação do histórico.
Também verifica o conflito entre duas sessões concorrentes: texto
não salvo é preservado, e uma revisão obsoleta não sobrescreve a nova.

O teste `tests/fixtures/lesson_presentations_stage4_full_cycle.sql`
executa **transações PostgreSQL reais** em reconstrução Supabase
descartável. Verifica a identidade numérica e a página independente,
dois alunos, dois professores, texto e revisões, recibos por versão,
recusa de registro obsoleto, impedimento de UPDATE concorrente,
restrições de acesso por papel e `ROLLBACK` de todos os registros
fictícios. SQL e código de interface devem passar em conjunto.

O CI global já existente complementa com compilação Android,
responsividade, acessibilidade, verificação de SEO e análise de
qualidade. **Isso não equivale a teste manual em aparelhos reais,
nem a homologação de autenticação real em produção.** Esses cenários
continuam como condições de liberação na etapa 5.

## 2. Situação conhecida da produção (consulta somente-leitura)

| Verificação | Situação em 17/10/2026 |
| --- | --- |
| Migrações no ledger atual | 316 |
| Versão mais recente | `20261017110321` |
| Migração de apresentações `20261017133000` | Ausente |
| Migração de recibos `20261017144500` | Ausente |
| `public.lesson_presentations` | Ausente |
| `public.lesson_presentation_versions` | Ausente |
| `public.lesson_presentation_views` | Ausente |
| Interface do aluno | `RELEASE_ENABLED = false` |
| Interface do professor | `RELEASE_ENABLED = false` |

Essas ausências são esperadas **antes** da implantação; o sucesso
da reconstrução isolada não prova que toda a cadeia de migrações
legadas da produção possa ser reproduzida ou aplicada com segurança.

O arquivo SQL
`scripts/sql/lesson_presentations_production_preflight_readonly.sql`
lê exclusivamente metadados de schema e ledger. O analisador
`scripts/assess_lesson_presentation_rollout.py` transforma o
resultado em estados *fail-closed*. Nenhum estado autoriza
automaticamente `db push`, `migration repair` ou mudar os dois
release gates. Mesmo quando todas as tabelas estiverem presentes,
o status será **POST_DEPLOYMENT_SECURITY_REVIEW_REQUIRED**.

## 3. Sequência obrigatória para a etapa 5

1. **Auditoria prévia do ledger e integridade do backup:** registrar
   versão atual, verificações de checksums/ordem, alterações concorrentes,
   permissões e backup/restauração verificados. A reconstrução canônica
   ainda diverge da produção; se houver drift não reconciliado,
   não executar migrações remotas em lote.
2. **Escolha explícita do procedimento de implantação:** revisar um
   pacote SQL mínimo e as dependências reais das duas migrações;
   provar a repetibilidade num banco isolado obtido com catálogo
   equivalente ao produtivo, sem copiar dados pessoais. O merge dos
   arquivos SQL não concede autorização para implantação produtiva.
3. **Implantar as duas migrações na ordem correta, se autorizadas:**
   `20261017133000` (tabela e histórico) e
   `20261017144500` (recibos). Confirmar a ausência de alterações
   fora das três tabelas, os triggers, as FK, os índices, os grants,
   RLS e as seis policies esperadas (quatro da etapa 1, duas da etapa 3).
   Não marcar versão de ledger manualmente sem validação de histórico.
4. **Homologação pós-migração:** repetir preflight, comprovar as
   permissões efetivas de `anon`, `authenticated`, professor
   e aluno; verificar `is_teacher_admin()` e exposição controlada
   pelo Data API. Um cliente sem privilégios administrativos jamais
   pode editar apresentação alheia ou forjar leitura docente.
5. **Teste controlado no navegador e aplicativo:** usando contas
   destinadas a homologação, comprovar envio, persistência após
   atualização, edição, concorrência, acesso pelo roteiro de estudos,
   O QUE FAZER e URL direta, responsividade e abertura pelo professor.
   Não usar alunos reais como massa de teste nem inserir conteúdo
   pessoal no CI.
6. **Ativação atômica da experiência:** somente após os passos
   anteriores, substituir `RELEASE_ENABLED = false` por `true`
   **nos dois módulos** em uma PR de ativação, com novo CI completo
   e procedimento de reversão. A publicação da interface é separada
   do DDL produtivo.
7. **Validação e rollback:** confirmar que novas revisões geram recibos
   atualizados e que a navegação vigente não regrediu. Em incidente,
   reverter os dois gates para `false` antes de considerar qualquer
   ação de banco. Não aplicar `DROP TABLE`, exclusão de versões
   ou rollback destrutivo automaticamente, pois haveria risco
   de perda de apresentações.

## 4. Critérios de parada obrigatória

Parar a implantação diante de migração parcialmente aplicada,
incompatibilidade de grants/policies, falta de prova do backup,
incerteza de versão do ledger, erro de exposição Data API,
falha de separação aluno/professor, divergência das chaves
`lesson:N` e `page:<uuid>`, ou falha de teste no aplicativo.

**O próximo passo não é configurar um bypass para o gate, nem
reescrever o histórico de 316 migrações.** A etapa 5 deve começar
pela reconciliação específica e pela escolha de um procedimento
de implantação auditável.

## 5. SEO

Os testes da etapa 4 não alteram páginas indexadas. As rotas de
aluno e professor permanecem privadas e têm `noindex,nofollow`
(respeitando a formatação individual do HTML). Nenhuma alteração
de URL, título, conteúdo público, metadata, canonical ou sitemap
está prevista. A ativação de conteúdo das páginas privadas será
comunicada caso passe a afetar SEO.

**Próxima etapa: 5 de 5 — implantação controlada, verificação
real das permissões e liberação simultânea dos componentes.**
