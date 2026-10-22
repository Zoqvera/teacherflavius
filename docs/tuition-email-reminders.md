# Avisos automáticos de mensalidade por e-mail

## Regra operacional

O aluno recebe até três e-mails de cobrança conforme a data local de São Paulo, por volta de 09h:

- Antes do vencimento: dois dias antes (before_due).
- No vencimento: no dia (due_today).
- Depois do vencimento: dois dias depois, apenas se não houver pagamento (after_due).

Remetente: Financeiro Teacher Flávio <financeiro@teacherflavius.com>.
Resposta: contato@teacherflavius.com (Google Workspace).
Pagamento: https://teacherflavius.com/pagamento/ — a página utiliza autenticação existente e consulta a cobrança do próprio aluno. O e-mail não inclui token, CPF, chave PIX, UUID de cobrança ou dados bancários.

Só é elegível a mensalidade com payment_date nulo, is_exempt falso, amount_due positivo e perfil matriculado e não arquivado. A mensalidade deve estar vinculada ao perfil. A elegibilidade é revalidada na reivindicação atômica e imediatamente antes de contatar o Resend. Nenhuma data ou valor de cobrança é alterado.

## Infraestrutura

- Migração: supabase/migrations/20261022205054_add_tuition_email_reminders.sql.
- Fila privada: private.tuition_email_reminders, RLS ativa e sem permissão aos papéis públicos.
- Enfileiramento: job tuition-email-enqueue-09h às 12h UTC (09h São Paulo). Sem backfill; a primeira data permitida é 23/10/2026.
- Despacho: job tuition-email-dispatch-5m; até três tentativas, espaçadas em pelo menos dez minutos, somente no dia previsto, entre 09h e 19h. Resend recebe uma chave de idempotência estável por aviso.
- Edge Function: notify-tuition-email-reminders, com verify_jwt=false e autenticação própria obrigatória por x-webhook-secret.
- Autorização: o banco usa teacherflavius_notification_webhook_secret já presente no Vault. A função usa ENROLLMENT_WEBHOOK_SECRET e RESEND_API_KEY, além dos segredos Supabase existentes.
- RPCs de reivindicação e finalização são restritas a service_role. A fila não armazena endereço de e-mail do aluno.

O estado sent indica aceite do Resend, e não leitura ou entrega final. Falhas podem ser reprocessadas com a mesma chave de idempotência dentro da janela diária. Avisos antigos nunca são enviados em datas posteriores.

## Publicação e validação

1. Confirmar a integridade do ledger de migrações antes de aplicar a nova migração. Não reaplicar históricos.
2. Aprovar os testes isolados, incluindo tests/tuition_email_reminders_contract.test.js.
3. Implantar a Edge Function com verify_jwt=false, pois ela é autenticada com o segredo de webhook existente.
4. Aplicar a migração controlada e verificar tabela, RLS, RPCs e os dois jobs ativos.
5. Homologar o recebimento apenas com uma conta de teste autorizada, nunca criando cobranças ou matrículas fictícias em produção.

Auditoria somente leitura: consultar contagens por reminder_kind e status na fila privada, sem recuperar destinatários, CPF ou dados financeiros.

SEO: nenhuma página indexável, rota, sitemap, robots.txt ou metadado é alterado.
