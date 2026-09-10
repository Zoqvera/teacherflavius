# Auditoria operacional do módulo financeiro

Data de referência: 10 de setembro de 2026.

## Escopo

A auditoria cobre o ciclo financeiro completo das mensalidades: criação do pagamento, idempotência, webhook, persistência, baixa, reconciliação, alertas, refund, chargeback, documentação de contestação, observabilidade e controles de acesso.

## Estado de referência

No início desta auditoria operacional, o ambiente de produção apresentava:

- health check financeiro: `healthy`;
- `issue_count = 0`;
- 0 alertas pendentes ou falhados;
- 0 alertas críticos abertos;
- 0 webhooks falhados nas últimas 24 horas;
- 0 webhooks com processamento stale;
- 0 refunds exigindo atenção;
- 0 chargebacks abertos;
- 0 documentações de chargeback vencidas;
- 0 pagamentos aprovados sem baixa;
- 0 reversões pendentes;
- 0 pagamentos rejeitados ainda aplicados;
- última reconciliação bem-sucedida registrada;
- crons financeiros recentes com `succeeded`.

Este snapshot é um ponto de referência, não uma garantia permanente. O painel e o health check são as fontes para o estado atual.

## Matriz de controles

| Falha | Prevenção | Detecção | Recuperação | Estado |
| --- | --- | --- | --- | --- |
| cobrança duplicada por retry | `X-Idempotency-Key`, chave local única e reutilização de tentativa | evento/alerta de duplicidade e health check | confirmar duplicidade e refund do excedente | coberto |
| webhook duplicado | `deduplication_key`, `delivery_count`, processamento idempotente | log persistente | nenhuma ação se já processado; replay seguro quando necessário | coberto |
| webhook perdido | reconciliação periódica | heartbeat, dashboard e health check | reconsulta do estado atual no Mercado Pago | coberto |
| webhook inválido | HMAC do Mercado Pago | eventos operacionais e burst alert | investigar origem; reconciliação preserva convergência | coberto |
| pagamento aprovado sem baixa | processamento atômico | alerta crítico e health check | reconciliação + `process_mercado_pago_payment` | coberto |
| reversão não aplicada | rotina de reversão | `payment_reversal_pending` e health check | reconciliar e aplicar reversão | coberto |
| estado local divergente | validação de ID, `external_reference` e valor | reconciliação/health check | reconsultar provedor e convergir | coberto |
| refund repetido | fluxo administrativo + estado persistente | histórico de refund | consultar provedor antes de repetir efeito ambíguo | coberto |
| chargeback sem tratamento | persistência e sincronização | alertas de abertura/prazo | workflow de documentação e reconciliação | coberto |
| prazo de chargeback perdido | deadline persistente | warning 72h, critical 24h/vencido | priorizar documentação e submissão | coberto |
| reconciliação parada | cron separado | `reconciliation_stalled`, health check | reparar cron/dispatch antes de casos individuais | coberto |
| health check parado | cron próprio | scanner independente | restaurar cron e exigir nova execução healthy | coberto |
| alerta não entregue | retries do notificador | `failedAlerts` e dashboard | restaurar Resend e retry controlado | coberto |
| acesso direto a tabelas financeiras | revogação de grants + RLS | contrato de segurança | manter acesso apenas por RPC/Edge Function | coberto |
| RPC técnica chamada pelo cliente | revogação de `EXECUTE` | contrato de segurança | service-role only | coberto |
| escopo administrativo sem MFA | wrappers MFA e AAL2 | Security/contract tests | reautenticar com MFA | coberto no domínio financeiro |
| necessidade de conter novas cobranças | kill switch server-side antes do `INSERT` | painel administrativo e auditoria de eventos | bloquear/reativar por Edge Function JWT+MFA sem parar recuperação | coberto |
| objeto futuro herdar acesso amplo | default privileges opt-in para objetos de aplicação | Security Advisor e contratos | grants explícitos somente quando necessários | coberto para objetos criados por `postgres` |

## Inventário operacional

### Crons

- `mercado-pago-reconciliation` — reconciliação principal a cada 5 minutos;
- `mercado-pago-chargeback-reconciliation` — reconciliação de chargebacks duas vezes por hora;
- `payment-alert-health-scan` — scanner de condições e retry de alertas a cada 5 minutos;
- `payment-financial-health-check` — auditoria de invariantes a cada 5 minutos, deslocada da reconciliação principal.

### Edge Functions críticas

- `create-mercado-pago-payment`;
- `mercado-pago-webhook`;
- `reconcile-mercado-pago-payments`;
- `reconcile-mercado-pago-automated`;
- `replay-mercado-pago-webhook`;
- `list-payment-webhooks`;
- `notify-payment-alert`;
- `refund-mercado-pago-payment`;
- `list-mercado-pago-refund-candidates`;
- `reconcile-mercado-pago-chargebacks`;
- `list-mercado-pago-chargebacks`;
- `manage-mercado-pago-chargeback-documentation`;
- `manage-payment-creation-control`.

## Controles de segurança validados

- 0 das 12 tabelas financeiras operacionais concede acesso direto a `anon` ou `authenticated`;
- as 12 permanecem acessíveis ao `service_role` para fluxos internos;
- nenhuma RPC financeira é executável por `anon`;
- RPCs exclusivamente de servidor são `service_role` only;
- operações administrativas expostas ao navegador usam MFA/AAL2;
- reconciliação manual mantém o aluno limitado ao próprio `student_id` e exige MFA para o escopo administrativo;
- o kill switch é administrado por Edge Function JWT+MFA e usa RPCs internas `service_role` only;
- crons não carregam segredos diretamente no comando;
- segredos de dispatch ficam no Vault;
- Edge Functions preferem o bundle atual de chaves Supabase, mantendo chaves legadas apenas como compatibilidade onde necessário;
- default privileges do papel `postgres` no schema `public` deixaram de conceder automaticamente tabelas, sequences e funções a papéis de cliente.

## Controles de engenharia

O domínio financeiro possui contratos determinísticos para:

- idempotência do frontend e do provedor;
- criação/validação de pagamentos;
- heartbeat e reconciliação;
- refunds;
- chargebacks;
- documentação de chargebacks;
- sandbox read-only;
- webhooks e replay;
- health check financeiro;
- superfície de acesso e MFA;
- kill switch de novas cobranças e default privileges.

O workflow `Payment contracts` roda essas verificações em mudanças relacionadas ao domínio financeiro.

## Riscos residuais

### 1. Dependência de serviços externos

Mercado Pago, Supabase e Resend permanecem dependências externas. O sistema detecta e contém grande parte das falhas, mas não pode garantir disponibilidade do provedor.

Mitigação: reconciliação, idempotência, health check, alertas, kill switch e procedimento de recuperação.

### 2. Janela de requisição em voo no kill switch

O kill switch bloqueia novas tentativas no banco antes do `INSERT`, cancela tentativas locais ainda sem `provider_payment_id` e mantém recuperação ativa. Uma requisição que já tenha ultrapassado o ponto de admissão imediatamente antes do bloqueio pode, no entanto, continuar em voo.

Mitigação: após um bloqueio de emergência, acompanhar dashboard, webhooks e reconciliação até não haver transações pendentes. O procedimento está documentado em `docs/payment_kill_switch.md`.

### 3. Sandbox sem transação automática destrutiva

O probe automatizado atual é deliberadamente read-only e não cria contas/test payments em cada execução.

Motivo: evitar efeitos externos acumulativos e depender de artefatos sandbox não descartáveis.

Mitigação: contratos locais cobrem o comportamento determinístico; o probe valida credencial/API quando configurado.

### 4. Defaults gerenciados pela plataforma

Os default privileges do papel de aplicação `postgres` foram migrados para opt-in. Os defaults do papel `supabase_admin` não foram modificados, para não interferir com objetos gerenciados pela plataforma.

Risco residual: objetos criados fora do fluxo normal de migrações precisam ser revisados conforme o owner e os grants efetivos.

Mitigação: criar objetos de aplicação pelas migrações do projeto, conceder acesso explicitamente e manter auditoria periódica de grants/RLS.

### 5. Função residual desativada

A Edge Function `noop-schema-probe` permanece implantada por limitação da interface de gerenciamento disponível durante a implementação. Ela está desativada, exige JWT e responde HTTP 410 sem executar operações.

Recomendação: remover definitivamente quando houver uma operação de exclusão de Edge Function disponível.

### 6. Proteção contra senhas vazadas

O Security Advisor ainda aponta `Leaked Password Protection Disabled` no Supabase Auth.

Mitigação atual: MFA protege superfícies administrativas sensíveis. A habilitação da proteção contra senhas vazadas permanece uma ação de segurança global fora do domínio financeiro.

## Critérios de prontidão operacional

O módulo financeiro é considerado operacionalmente pronto enquanto todos os pontos abaixo forem verdadeiros:

1. health check recente e não stale;
2. nenhuma invariante crítica ativa sem investigação;
3. reconciliação e scanner de alertas com execuções recentes;
4. webhooks persistidos e replay disponível;
5. alerts entregáveis ou dashboard acompanhado como fallback;
6. refund e chargeback com estados persistentes e recuperáveis;
7. acessos financeiros limitados por menor privilégio;
8. contratos de pagamento verdes na CI;
9. runbook atualizado quando uma nova classe de incidente for introduzida;
10. kill switch acessível ao professor com MFA e normalmente em estado `enabled=true`.

## Revisão pós-mudança

Qualquer alteração futura em pagamentos deve responder, antes do merge:

- Qual novo efeito financeiro pode ocorrer?
- Qual é a chave de idempotência?
- Como o estado converge se o webhook não chegar?
- Como detectar uma operação parcialmente concluída?
- Qual alerta/health invariant cobre a falha?
- Qual procedimento de recuperação existe?
- O fluxo administrativo exige MFA?
- O cliente tem acesso direto a alguma nova tabela/RPC técnica?
- O runbook precisa de um novo cenário?
- A mudança respeita o kill switch de criação e os default privileges opt-in?
