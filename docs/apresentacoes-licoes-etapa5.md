# Apresentações das lições — etapa 5A/5: compatibilidade com backup produtivo

Data: 17 de outubro de 2026. **Status: implantação de produção não autorizada.**

## Estado comprovado antes desta PR

As quatro primeiras etapas estão no código da `main`, e todos os
contratos integrados foram aprovados com dados fictícios. A interface
do aluno (`lesson_presentation_editor.js`) e a do professor
(`teacher_lesson_presentations.js`) permanecem com
`RELEASE_ENABLED = false`.

Consulta somente-leitura feita no projeto Supabase
`wnigzpvgsbpjdxvjzugt` nesta etapa confirmou:

| Item | Resultado |
| --- | --- |
| Última versão do histórico | `20261017110321` |
| Quantidade de migrações produtivas | 316 |
| Migração do editor `20261017133000` | Não aplicada |
| Migração dos recibos `20261017144500` | Não aplicada |
| Três tabelas de apresentações | Inexistentes |
| Banco de produção | Ativo, inalterado |

O repositório mantém auditorias separadas que documentam diferenças
entre o catálogo produtivo e seu bootstrap de migrações.
**Um teste local bem-sucedido não torna seguro executar `db push`
sobre o histórico legado**. O procedimento de implantação continua
pendente de conciliação e decisão explícita sobre seu escopo.

## Evidência de backup encontrada

O workflow [Encrypted Supabase logical backup #38872485518](https://github.com/Zoqvera/teacherflavius/actions/runs/38872485518)
concluiu em 16/10/2026 com artefato criptografado
`supabase-daily-20261016T081548Z` e prazo de retenção até
15/11/2026. O workflow de [restauração #38872741143](https://github.com/Zoqvera/teacherflavius/actions/runs/38872741143)
também concluiu com sucesso. Essa cópia precede as alterações
posteriores do sistema e **não deve ser usada, isoladamente, para
autorizar a implantação de 17/10**.

A workflow de backup tem agendamento diário, mas, no momento desta
verificação, não foi encontrada evidência de uma nova execução
bem-sucedida em 17/10/2026. Agendamento não é prova de backup.

## Novo ensaio de recuperação produtiva

A mudança em `.github/workflows/supabase-encrypted-backup.yml`
adiciona este documento como gatilho de uma nova cópia criptografada
quando a PR for integrada à `main`. O workflow de recuperação
continua encadeado **somente após backup bem-sucedido**.

O verificador `scripts/verify_supabase_backup_restore.sh` passa a
executar, depois da recuperação e da comparação integral do
`recovery_manifest.json`, um teste de compatibilidade das duas
migrações de apresentações **no banco descartável restaurado**.
O teste está em
`tests/fixtures/lesson_presentations_stage5_restored_backup_checks.sql`.

A sequência é: restaurar roles, esquema, dados e ledger do backup
criptografado; restaurar gatilhos Auth e configuração de cron; desativar
cron na cópia; comparar fingerprint de restauração; abrir uma transação
local; aplicar as migrações `20261017133000` e `20261017144500`;
verificar tabelas, RLS, seis políticas, gatilhos, acessos e ausência
de registros novos; executar `ROLLBACK`; verificar que nenhuma das
três tabelas permaneceu no banco descartável; destruir a instância.

O novo campo público de relatório
`presentation_schema_rehearsal: "passed"` só será emitido após
esse ensaio. O verificador
`scripts/assess_lesson_presentation_backup.py` exige um relatório de
restauração válido e recente (24 horas) e continua definindo
`production_write_authorized = false` e
`automatic_release_allowed = false` mesmo quando passar.

O relatório **não inclui credenciais, conteúdo de apresentações ou
backup descriptografado**. Nenhum SQL deste pacote é executado na
produção por meio da PR.

## Barreiras obrigatórias para a etapa 5B

1. Ter novo artefato criptografado com checksum e restauração validada,
   incluindo ensaio das duas migrações no catálogo recuperado.
2. Confirmar a integridade da migração e a compatibilidade da
   identificação/versionamento com o ledger existente, sem
   `migration repair` automático nem reaplicação de migrações legadas.
3. Revisar exposição pela API, ownership, RLS e `GRANT` das três
   tabelas; e definir procedimento de parada/reversão para falha.
4. Aplicar migrações somente por procedimento controlado, com
   versionamento consistente e auditoria de execução;
   não implantar código e esquema no mesmo passo.
5. Revalidar regras de acesso reais, autenticação, links de lições e
   comportamento no navegador e aplicativo com contas de homologação
   (sem reutilizar identidades de alunos).
6. Somente após tudo isso, alterar ambos os release gates em uma
   PR separada e integrada após testes completos, monitorando falhas.

Se qualquer uma dessas condições falhar ou não puder ser comprovada,
a experiência continuará desativada e a implantação deverá ser
interrompida, **sem modificar o histórico de migrações**.

## SEO

Este pacote altera testes, scripts de recuperação e documentação, e
não altera páginas, metadados, URL, links canônicos ou sitemap.
Portanto **não há impacto de SEO**. A posterior liberação de formulário
em páginas privadas preservará as diretivas de não indexação, salvo
decisão explícita em contrário.

**Próxima etapa: 5B — prova de backup recente, reconciliação
específica do ledger, implantação restrita e, somente depois,
ativação sincronizada das interfaces.**
