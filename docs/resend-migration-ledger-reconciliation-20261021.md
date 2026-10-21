# Reconciliação auditável do histórico de migração do Resend — 21/10/2026

## Ocorrência
O job **Supabase migration drift** falhou na PR #829 porque a migração
`20261016213000_resend_delivery_tracking_and_retention` está registrada
na produção com nome correto, mas `statements` vazio. O SQL canônico
já existe em `supabase/migrations/20261016213000_resend_delivery_tracking_and_retention.sql`.
O SHA-256 normalizado do arquivo versionado é
`e7e2b901b2b7d2f7aa9346e622cbe61282205ff943af4d865512465fba2936a7`.
O SHA-256 do conteúdo vazio do ledger é
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

## Verificação de produção
Uma consulta somente de leitura confirmou que as tabelas privadas
`resend_delivery_messages` e `resend_delivery_events` já existem,
com RLS, 12 colunas esperadas, 7 índices e 10 restrições no conjunto.
As quatro rotinas de rastreamento e expurgo estão presentes. A execução
das funções é negada a `anon` e `authenticated`, e autorizada ao
`service_role` nas operações previstas. A rotina de retenção mantém
as janelas de 90 e 180 dias e a lógica `SKIP LOCKED`.
A consulta de atestação está em
`scripts/sql/resend_delivery_catalog_attestation.sql`.

## Reconciliação
O verificador `scripts/check_supabase_migration_drift.sh` admite uma
única exceção para a discrepância de checksum, condicionada
**simultaneamente** a:
1. versão, nome da migração e nome do arquivo idênticos aos fixados;
2. checksum vazio na produção, sem disfarçar SQL diferente;
3. SHA-256 exato do SQL canônico no Git;
4. aprovação da atestação somente de leitura do catálogo real.

Qualquer modificação de SQL, de nome, versão, permissões, formato do
catálogo ou outras migrações continua falhando. Os testes incluem
casos válidos e falsificações deliberadas.

**Sem alterações no banco:** não houve novo `apply_migration`, replay,
`UPDATE` no ledger, operações sobre dados de alunos, webhook, cron,
configuração do Resend ou processamento de mensagens.

## Política de liberação
Este ajuste valida **somente o histórico e o catálogo técnico**; não
aprova automaticamente a ativação do rastreamento, a publicação de um
webhook ou a execução do expurgo. Esses processos dependem de suas
autorizações, testes e procedimentos próprios.

## SEO
Sem alteração em páginas públicas, URLs, canonical, sitemap,
robots.txt ou metadados indexáveis.
