# Segurança de acesso financeiro

## Objetivo

O módulo financeiro não expõe suas tabelas operacionais diretamente ao navegador. O acesso do aluno e do professor ocorre por RPCs explicitamente autorizadas ou por Edge Functions que validam identidade, MFA ou assinaturas do provedor conforme o fluxo.

## Limite de acesso ao banco

As tabelas abaixo têm RLS habilitado e, adicionalmente, não concedem privilégios de tabela a `anon` nem a `authenticated`:

- `monthly_tuition`
- `monthly_tuition_events`
- `tuition_payment_attempts`
- `payment_reconciliation_runs`
- `payment_operational_events`
- `payment_alert_notifications`
- `payment_webhook_events`
- `payment_refund_requests`
- `payment_chargebacks`
- `payment_chargeback_documentation_cases`
- `payment_chargeback_documentation_events`
- `payment_chargeback_evidence_items`

O `service_role` mantém os privilégios necessários para Edge Functions e rotinas internas. As RPCs técnicas do Mercado Pago são explicitamente revogadas de `PUBLIC`, `anon` e `authenticated` e concedidas ao `service_role`.

## RPCs do navegador

As RPCs de negócio que precisam ser chamadas pelo navegador permanecem disponíveis somente para `authenticated`. Elas fazem a autorização dentro do banco usando `auth.uid()`, `is_teacher_admin_mfa()` ou wrappers MFA já existentes. Entre elas estão consultas do próprio aluno, configuração do vencimento e operações administrativas de mensalidade.

Nenhuma RPC financeira é executável por `anon`.

## Edge Functions públicas sem JWT

Três superfícies financeiras permanecem sem `verify_jwt` porque não são endpoints de usuário anônimo:

- `mercado-pago-webhook`: valida a assinatura HMAC enviada pelo Mercado Pago.
- `reconcile-mercado-pago-automated`: valida timestamp e assinatura de reconciliação.
- `reconcile-mercado-pago-chargebacks`: usa a mesma autenticação assinada da reconciliação.
- `notify-payment-alert`: valida o segredo próprio do webhook antes de ler ou alterar alertas.

As funções administrativas acionadas pelo navegador exigem JWT e, quando manipulam informações financeiras sensíveis, também validam MFA.

## Segredos

Os crons financeiros executam somente funções privadas do Postgres; não carregam chaves ou tokens em seus comandos. Os segredos de dispatch ficam no Vault e as Edge Functions mantêm tokens do Mercado Pago e chaves Supabase apenas no ambiente do servidor.

O código versionado das funções financeiras usa `SUPABASE_SECRET_KEYS` como fonte preferencial para credenciais secretas, mantendo `SUPABASE_SERVICE_ROLE_KEY` apenas como fallback de compatibilidade. O contrato `payment_access_hardening_contract.test.js` impede a reintrodução de leitura direta da chave legada nas funções financeiras.

## Verificação operacional

Após a migração `20260910015722_harden_payment_data_api_surface`, a auditoria de privilégios deve produzir:

- 0 tabelas financeiras com acesso direto por `anon` ou `authenticated`;
- 12 tabelas financeiras acessíveis pelo `service_role`;
- 0 execução anônima da função técnica `set_tuition_payment_attempt_updated_at()`;
- RPCs legítimas do navegador ainda executáveis por `authenticated`;
- nenhum segredo embutido nos comandos dos crons financeiros.
