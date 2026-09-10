# Adendo ao runbook — bloqueio de novas cobranças

Quando um incidente exigir contenção imediata do checkout, usar o painel `Controle de novas cobranças` em `/mensalidades/` com MFA AAL2.

## Para bloquear

1. Confirmar que o incidente justifica impedir novas cobranças sem desligar recuperação.
2. Clicar em `BLOQUEAR NOVAS COBRANÇAS`.
3. Registrar um motivo operacional com pelo menos cinco caracteres.
4. Digitar `BLOQUEAR` para confirmar.
5. Confirmar no painel que o estado passou para `NOVAS COBRANÇAS BLOQUEADAS`.
6. Continuar acompanhando dashboard, webhooks e reconciliação, pois uma requisição que já estivesse em voo antes do bloqueio pode terminar.

O bloqueio não desativa webhook, reconciliação, refunds, chargebacks, documentação ou alertas.

## Para reativar

1. Confirmar que a causa do incidente foi resolvida.
2. Verificar health check financeiro recente e sem inconsistência crítica.
3. Clicar em `REATIVAR NOVAS COBRANÇAS`.
4. Digitar `REATIVAR` para confirmar.
5. Confirmar no painel que o estado voltou para `NOVAS COBRANÇAS ATIVAS`.

Não reativar somente porque o gateway voltou a responder; primeiro confirmar que não existem efeitos financeiros pendentes ou divergentes.
