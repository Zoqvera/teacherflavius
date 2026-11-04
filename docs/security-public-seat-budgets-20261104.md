# Histórico: proposta de limitação de reservas de turmas — não implantada

Em 4 de novembro de 2026, foi preparada a migração
`20261104024500_throttle_public_class_seat_submission_attempts.sql`
para limitar requisições de reservas temporárias e entradas na lista de espera.

**Situação final: cancelada antes da aplicação ao Supabase.**
O sistema inteiro de reservas temporárias de turmas, lista de espera e
matrícula automática associada foi desativado pela migração
`20261104024633_disable_class_seat_reservations.sql`.

A proposta anterior não foi aplicada nem acrescentada ao histórico de
migrações da produção. O arquivo foi retirado do catálogo de migrações
ativas e sua identidade foi fixada em
`scripts/check_supabase_migration_drift.sh`, para manter o controle
de alterações versionadas e permitir a auditoria dessa retirada.

A desativação efetiva não depende de limites de tentativas: permissões
de execução foram revogadas e gatilhos no banco impedem a inserção de
novas reservas ou inscrições na lista de espera. As rotinas automáticas
exclusivas foram desprogramadas. As reservas promocionais e o
cadastro por convite continuam independentes.

Não foram excluídos dados históricos, alunos, cobranças ou recibos.
As páginas aposentadas continuam com `noindex,nofollow`, sem inclusão
no sitemap.
