# ETAPA 7.3.4 — Homologação do webhook Resend e liberação controlada

Data: **16/10/2026**. Acompanhamento: [PR #732](https://github.com/Zoqvera/teacherflavius/pull/732), [issue #696](https://github.com/Zoqvera/teacherflavius/issues/696).

## Estado e limites

**A implementação está em branch de homologação; produção não liberada.**
A aprovação dada pelo responsável nesta etapa autoriza o avanço dos testes e o
preparo da operação, não implica autorização para ativar webhook, migração,
secrets, cron ou envio de e-mails em produção.

O ambiente **CI descartável** exercita duas camadas:

1. **Node HTTP isolado:** o mesmo handler usado pela Edge Function
   processa requisições `Request` com HMAC-SHA256/Svix assinado por
   segredo **fictício**, sem usar Resend nem conectar o banco real. Testa
   adulteração, cabeçalhos ausentes, timestamp vencido, duplicidade,
   erros de persistência, eventos não pertinentes, payload grande,
   UTF-8 inválido e os sete tipos de evento suportados.
2. **Supabase/PostgreSQL efêmero:** a migração é instalada apenas no
   container do GitHub Actions; o Edge runtime local é iniciado com
   `RESEND_DELIVERY_TRACKING_ENABLED=true` e chave **sintética**.
   O teste posta requisições Svix assinadas, verifica respostas HTTP,
   deduplicação e inclusão das duas linhas previstas na tabela
   `private.resend_delivery_events`. A instância é destruída ao fim.

**Isso não substitui o teste de webhook verdadeiramente originado do
Resend.** Não há conexão à conta Resend nesta execução; nenhum webhook
foi registrado no provedor. É impossível confirmar entregabilidade real
a partir apenas das requisições sintéticas.

## Contrato com o Resend

A documentação vigente do Resend prevê chamadas com os cabeçalhos
`svix-id`, `svix-timestamp` e `svix-signature`, usando o corpo **bruto**
para verificação, e entrega de eventos pelo menos uma vez. O tratamento
usa `svix-id` como chave de deduplicação e evita registrar endereço,
assunto, corpo, detalhes de bounce ou cabeçalhos assinados.

Tipos selecionados para ativação futura:

`email.sent`, `email.delivery_delayed`, `email.delivered`,
`email.failed`, `email.bounced`, `email.complained`,
`email.suppressed`.

**`email.delivered` comprova aceitação pelo servidor de correio de
destino, não leitura pelo aluno nem localização na caixa de entrada.**

Referências:
- https://resend.com/docs/webhooks/introduction
- https://resend.com/docs/webhooks/verify-webhooks-requests
- https://resend.com/docs/webhooks/event-types
- https://resend.com/docs/webhooks/create-webhook

## Política e agendamento de retenção

Prazos **aprovados em 16/10/2026**:

| Registro | Prazo | Marco inicial |
| --- | --- | --- |
| Evento do provedor | 90 dias | `received_at` |
| Vínculo por mensagem | 180 dias | `accepted_at` |

A RPC `public.prune_resend_delivery_evidence(500)` remove até
500 eventos e até 500 vínculos elegíveis por execução, com proteção
contra concorrência. Não interfere nas filas de envio ou nas demais
tabelas acadêmicas/financeiras.

O arquivo operacional
`supabase/operations/resend_delivery_retention_schedule.sql`
**não integra as migrações**. Para ser executado, exige a sinalização
administrativa de liberação `app.resend_retention_schedule_approved=true`
na **mesma transação**. Ele cria o cron
`resend-delivery-evidence-retention` em `20 6 * * *` (06h20 UTC;
03h20 em São Paulo), **sempre inativo** (`active=false`).
A operação é idempotente e falha caso exista um job divergente.
O estado é testado somente na base descartável com `BEGIN/ROLLBACK`.

**Não existe rotina de ativação automática.** Apenas após a aprovação
final de produção, o administrador autenticado poderá ativar esse
registro com `cron.alter_job`, após revisar alertas, atrasos acumulados,
retenção no próprio Resend e plano de reversão. Em caso de incidente,
desativar primeiro o cron e o webhook.

## Checklist para a futura homologação externa (pendente)

1. Dispor de ambiente isolado de Supabase com banco sintético, sem
   dados de alunos ou serviços de pagamento e sem disparadores reais.
2. Configurar segredo exclusivo do webhook de desenvolvimento
   **apenas no cofre de secrets** da Edge Function. Não colar chaves em
   chats, documentos, GitHub ou logs.
3. Publicar o receptor no **ambiente isolado** com validação HMAC
   obrigatória e ativação controlada.
4. No painel **Resend → Webhooks**, criar webhook apontando apenas para
   o endpoint isolado; selecionar os sete eventos listados. Conferir a
   assinatura, a resposta 200, a deduplicação e os registros por ID
   **sem realizar envio a alunos reais**.
5. Testar reenvio do mesmo webhook pelo Resend e evento fora de ordem;
   registrar evidência mínima (ID técnico e resultado agregado), sem PII.
6. Preparar checklist de produção: migration drift zerado, scripts de
   deploy revisados, plano de rollback, credenciais isoladas,
   monitoramento de falhas e validação de conformidade.

Somente mediante **nova autorização explícita de liberação produtiva**
serão implantados no sistema real os componentes da Etapa 7.3.
A atualização do repositório por si só não autoriza ativação.

## SEO e sequência

Nenhuma alteração em metadados, rotas públicas, páginas indexáveis,
sitemap, robots.txt ou conteúdo do site.

Após validação dos eventos originados diretamente do Resend e autorização
de produção: concluir a Etapa 7.3 e iniciar
**ETAPA 7.4 — Reconciliação Histórica, Remetentes e Idempotência**.
