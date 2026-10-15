# ETAPA 7.3.2 — Implementação controlada do monitor de entregabilidade Resend

Atualizado em 15/10/2026. Issue de acompanhamento: [#696](https://github.com/Zoqvera/teacherflavius/issues/696).
Complementa a [auditoria da Etapa 7.3](notificacoes-etapa7-3-auditoria-entregabilidade-resend.md).

**Estado: código versionado para homologação; NÃO ATIVADO EM PRODUÇÃO.**
Esta entrega não configura um webhook no Resend, não instala uma
migração na produção, não cria registros reais e não dispara e-mails.

## Alterações desenvolvidas

1. Migração **proposta** `20261015210000_resend_delivery_tracking_foundation.sql`
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

1. **Política LGPD e retenção:** definir finalidade e prazo de retenção
   dos metadados técnicos, acesso para suporte, tratamento de dados
   estudantis e rotina de expurgo. Sem autorização de política, **não aplicar
   a migração em produção**. Sugestão para deliberação: 90 dias para eventos
   e 180 dias para vínculo por mensagem, sujeitos a revisão jurídica.
   Não existe expurgo automático nesta versão.
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
- A rotina de expurgo permanece pendente da decisão sobre retenção.
- A validação isolada de banco/integração real com Resend é condição
  para a liberação; testes automatizados de assinatura não a substituem.

**SEO:** nenhuma alteração de páginas, URLs indexáveis, metadados,
sitemap ou robots.txt; alteração restrita a backend, testes e documentação.

**Próxima subetapa:** 7.3.3 — Homologação isolada, política de retenção e
ativação controlada, seguida de 7.4 — Reconciliação Histórica,
Remetentes e Idempotência.
