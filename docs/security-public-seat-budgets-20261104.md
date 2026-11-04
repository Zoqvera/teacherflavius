# Auditoria de tentativas em reservas públicas — 04/11/2026

## Decisão final: fluxo desativado

A proposta de limitação por telefone da PR #942 foi incorporada ao
repositório, mas **nunca foi aplicada em produção**. Antes da implantação,
a migração de produção `20261104024633_disable_class_seat_reservations`
descontinuou o sistema de reservas temporárias e de lista de espera.

A PR #943, que corrigia uma falha sintática no SQL de limitação, foi
encerrada sem merge. O SQL `20261104024500_throttle_public_class_seat_submission_attempts.sql`
e seu teste/workflow foram retirados da árvore ativa, com atestação
explícita de que essa versão **não existe** no ledger remoto. A versão de
desativação `20261104024633` foi recuperada do ledger remoto sem
alterações e incorporada ao Git para preservar o histórico canônico.

## Controles ativos, verificados no Supabase

- As duas variantes de `create_public_class_seat_hold` e as duas
  variantes de `join_public_class_seat_waitlist` tiveram `EXECUTE`
  revogado de `anon`, `authenticated` e `service_role`.
- Também foram bloqueadas consulta e cancelamento da reserva.
- Os gatilhos `reject_disabled_class_seat_hold` e
  `reject_disabled_class_seat_waitlist` estão ativos e impedem novas
  linhas, mesmo em chamadas internas que tentem inserir diretamente.
- O histórico de 12 reservas e seis registros em espera foi
  preservado, sem criar novos registros.
- A consulta pública de disponibilidade, usada por outros módulos
  acadêmicos, foi mantida somente para leitura.

## Risco residual e próximos passos

Esta correção não substitui revisão de outras RPCs públicas que
permanecem ativas. A proteção contra abuso deve ser direcionada às
rotas efetivamente utilizadas, sem reabilitar reservas descontinuadas.

Nenhuma mudança de MFA administrativo, mensalidades, metadados, URLs
ou SEO foi realizada nesta limpeza.
