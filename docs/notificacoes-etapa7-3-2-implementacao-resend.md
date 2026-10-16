# ETAPA 7.3.2 — Implementação controlada do monitor de entregabilidade Resend

Atualizado em 16/10/2026. Issue de acompanhamento: [#696](https://github.com/Zoqvera/teacherflavius/issues/696).
Complementa a [auditoria da Etapa 7.3](notificacoes-etapa7-3-auditoria-entregabilidade-resend.md).

**Estado: código versionado para homologação; NÃO ATIVADO EM PRODUÇÃO.**
Esta entrega não configura um webhook no Resend, não instala uma
migração na produção, não cria registros reais e não dispara e-mails.

## Alterações desenvolvidas

1. Migração **proposta** `20261016213000_resend_delivery_tracking_and_retention.sql`
   cria duas tabelas no esquema `private`:
   `resend_delivery_messages` (uma mensagem por operação/destinatário)
   e `resend_delivery_events` (uma linha por evento assinado). Mantém
   `provider_email_id`, referências técnicas, tipo, horários e estado;
   **não armazena endereço, assunto, corpo, IP ou mensagens de erro**.
2. Duas RPCs `public.record_resend_message_acceptance` e
   `public.record_resend_delivery_event` aceitam apenas `service_role`,
   validam todos os parâmetros e impedem substituição indevida do ID do
   provedor e duplicação de eventos. As tabelas são `private`, sem
   concessão a `anon` ou `authenticated`.
3. O módulo `resend_delivery_core.mjs` verifica HMAC-SHA256 do Svix sobre
   **corpo bruto, ID e timestamp**, com janela anti-replay de cinco minutos.
   Somente eventos de entrega conhecidos são guardados.
4. A Edge Function `resend-delivery-webhook` exige a assinatura legítima,
   descarta eventos não reconhecidos e não grava/expõe conteúdo dos e-mails.
   A função recebe `verify_jwt=false` porque o emissor externo não possui
   token Supabase; a assinatura é obrigatória e deve ser validada antes de
   qualquer uso da conta `service_role`.
5. As três funções de envio, quando o recurso estiver ligado, registram
   os IDs retornados pelo Resend individualmente. Matrículas são separadas
   entre aluno e professor. Em erro de persistência, mantêm o caminho
   atual de reenvio protegido por idempotência dentro da janela existente.
6. O estado é derivado pelo **tempo do evento**, e, em empate, severidade
   de falha; webhooks fora de ordem não fazem o último pacote recebido
   retroceder uma entrega comprovada. Eventos que chegam antes da
   confirmação de aceitação ficam temporariamente sem correspondência,
   prontos para conciliação quando a identidade da mensagem for gravada.

## Controles de liberação

A implementação fica **desabilitada por padrão**. O segredo de assinatura
é distinto da chave de envio Resend e do segredo de webhook de matrícula.

- `RESEND_DELIVERY_TRACKING_ENABLED=true`: ativa persistência e tratamento
  de eventos; **não configurar antes da migração, testes e aprovações**.
- `RESEND_WEBHOOK_SIGNING_SECRET`: valor `whsec_...` da configuração
  exclusiva do webhook no Resend. Nunca copiar para GitHub, logs, SQL,
  painel do aluno ou mensagens de chat.
- `SUPABASE_URL` e chave administrativa: somente variáveis protegidas
  já disponíveis na execução da Edge Function.
- **Não criar webhook Resend antes** de o endpoint estar publicado com
  autenticação por assinatura funcionando e segredo corretamente provisionado.

### Ordem de implantação proposta (não executada)

1. **Política LGPD e retenção:** aprovada pelo responsável em
   **16/10/2026**: eventos retidos por 90 dias a contar do recebimento;
   vínculos de mensagem retidos por 180 dias a contar da aceitação pelo
   Resend. O estado resumido da mensagem permanece até o fim dos 180 dias,
   mesmo após o descarte de eventos individuais. A rotina de expurgo
   está implementada e protegida por `service_role`, mas **não agendada
   nem aplicada em produção**. A revisão jurídica/da política de privacidade
   e os controles de acesso continuam indispensáveis.
2. Validar as RPCs e a migração em banco **descartável**, com dados
   integralmente fictícios, sem serviços de transporte ativos. Exercitar
   envio duplo, duplicação, assinatura inválida, chegada fora de ordem,
   evento anterior à aceitação, status `delivered` e `bounced`,
   colisões entre registros, funções inacessíveis a `anon` /
   `authenticated`, impossibilidade de leitura das tabelas privadas.
3. Aprovar e provisionar secrets em ambiente isolado; publicar a Edge
   Function com `verify_jwt=false`, mantendo o handler desligado até
   que tudo esteja pronto. Configurar o webhook Resend apenas para
   eventos explicitamente necessários.
4. Habilitar o rastreio no ambiente isolado, verificar evento autêntico
   assinado e conciliação por ID, sem e-mails para alunos reais.
5. Após aceite explícito, aplicar migração controlada na produção,
   publicar as quatro Edge Functions, configurar segredo e webhook,
   habilitar `RESEND_DELIVERY_TRACKING_ENABLED` e observar a saúde.
6. Durante implantação/reversão, primeiro desabilitar `RESEND_DELIVERY_TRACKING_ENABLED`
   e/ou webhook no Resend. Não apagar evidências nem reprocessar e-mails
   automaticamente. Mensagens históricas anteriores à instrumentação
   permanecem **não verificadas**, salvo reconciliação externa comprovada.

## Expurgo seguro — política aprovada em 16/10/2026

A função `public.prune_resend_delivery_evidence(p_batch_limit)` utiliza
`SECURITY INVOKER` e permite execução apenas por `service_role`.
O limite aceito por chamada é de 1 a 1.000 registros **em cada tabela**;
500 é o valor padrão. Os critérios são:

- **Eventos:** `received_at` estritamente anterior a 90 dias do instante
  da execução. Isso preserva o prazo inteiro mesmo para eventos atrasados.
- **Vínculos de mensagens:** `accepted_at` estritamente anterior a 180
  dias. Limpeza de eventos não altera o `delivery_status` consolidado
  enquanto o vínculo estiver dentro do prazo.

A limpeza ocorre em lotes com `FOR UPDATE SKIP LOCKED`, sem manipular
cadastros, filas de matrícula, reposição, créditos ou cobranças. Repetir
a operação é seguro e não duplica efeitos. Retorna apenas contagens.

**Ativação futura, sujeita a homologação e liberação:** agendar uma
execução diária autorizada usando o módulo pg_cron existente, com lotes
repetidos e limites operacionais para processar eventuais atrasos.
Testar o job na branch isolada, o manejo de erros e a observabilidade.
Não registrar esse job durante o merge do código: um agendamento ativo
poderia executar a exclusão antes do aceite final de produção.

**Reversão:** desativar primeiro o job e o flag de rastreio. Registros
já expurgados não podem ser recuperados por simples reversão de versão.
O procedimento de backup/restauração exige planejamento administrativo,
sem restaurar indiscriminadamente dados além da retenção autorizada.

## Etapa 7.3.4 — Ensaio HTTP e preparação de liberação (16/10/2026)

Consulte [o plano de homologação do webhook](notificacoes-etapa7-3-4-homologacao-webhook-resend.md).
Foi adicionada uma suíte de requisições HTTP de verdade contra o mesmo
handler da Edge Function, com HMAC-SHA256/Svix fictício. O CI também
inicializa Supabase descartável e testa o POST assinado no Edge runtime
local, verificando as duas linhas de evento, a resposta de duplicidade e
a rejeição de alteração da assinatura.

O agendamento de retenção é preparado em
`supabase/operations/resend_delivery_retention_schedule.sql`, mas é
criado inativo por padrão. **Não é incorporado automaticamente às
migrações.** Ele exige sinalização administrativa na mesma transação e
permanece sujeito a autorização separada antes da ativação.

Ainda não houve teste de requisição assinada realmente enviada pelo
Resend porque a conta do provedor não está conectada ao ambiente
de homologação. A PR permanece em DRAFT; não instalar ou ativar
componentes na produção sem novo aceite explícito.

## Contratos e consultas de leitura (após implantação)

```sql
select queue_name, recipient_role, delivery_status,
       count(*)::integer as messages
from private.resend_delivery_messages
group by queue_name, recipient_role, delivery_status
order by queue_name, recipient_role, delivery_status;
```

```sql
select event_type, count(*)::integer as events
from private.resend_delivery_events
group by event_type
order by event_type;
```

Não expor essas tabelas na Data API. Consultas restritas a profissional
autorizado, em canal administrativo com mínimos privilégios.

### Limitações assumidas

- `sent` no sistema legado não é prova de `delivered`.
- Eventos anteriores à ativação não são retroativamente verificáveis.
- Aceitação HTTP e entrega são fases distintas; o status do provedor pode
  demorar a chegar.
- O webhook não é configurado nem ativado nesta implementação.
- A política 90/180 dias foi aprovada e a rotina foi implementada.
  Ainda não existe agendamento de expurgo, que exige liberação separada.
- A validação isolada de banco/integração real com Resend é condição
  para a liberação; testes automatizados de assinatura não a substituem.

**SEO:** nenhuma alteração de páginas, URLs indexáveis, metadados,
sitemap ou robots.txt; alteração restrita a backend, testes e documentação.

**Próxima subetapa:** 7.3.3 — Homologação isolada, política de retenção e
ativação controlada, seguida de 7.4 — Reconciliação Histórica,
Remetentes e Idempotência.
