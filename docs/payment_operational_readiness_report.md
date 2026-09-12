# Relatório de prontidão operacional de pagamentos

Data de referência: 12 de setembro de 2026.

Este documento é um snapshot operacional verificável. O estado corrente deve sempre ser confirmado no health financeiro e no dashboard antes de uma intervenção.

## Resumo executivo

O módulo financeiro está operacionalmente saudável no momento desta revisão. O health financeiro mais recente retornou:

- `status = healthy`;
- `issue_count = 0`;
- `warning_count = 0`;
- `critical_count = 0`;
- `issue_codes = []`.

Última execução observada durante esta revisão: `2026-09-12 19:58:00+00`.

Não há evidência atual de pagamento aprovado sem baixa, refund incompleto, chargeback aberto, alerta financeiro falhado ou item de analytics financeiro preso.

## Snapshot financeiro

| Indicador | Quantidade |
| --- | ---: |
| Tentativas de pagamento | 16 |
| Aprovadas | 10 |
| Rejeitadas | 6 |
| Pendentes | 0 |
| PIX aprovados | 10 |
| Cartões aprovados em produção | 0 |
| Refunds registrados | 0 |
| Chargebacks registrados | 0 |
| Alertas financeiros históricos | 2 |
| Alertas pendentes | 0 |
| Alertas falhados | 0 |
| Itens no outbox de analytics | 0 |

Os números acima não incluem pagamentos sandbox como transações financeiras de produção.

## Automação financeira

Os quatro jobs financeiros permanentes estavam ativos na verificação:

| Job | Agenda | Estado |
| --- | --- | --- |
| `mercado-pago-reconciliation` | `*/5 * * * *` | ativo |
| `mercado-pago-chargeback-reconciliation` | `17,47 * * * *` | ativo |
| `payment-alert-health-scan` | `*/5 * * * *` | ativo |
| `payment-financial-health-check` | `3,8,13,18,23,28,33,38,43,48,53,58 * * * *` | ativo |

O cron de analytics server-side não está ativo nesta etapa. A ativação depende da configuração e validação do `GA4_API_SECRET`, conforme `payment_server_analytics.md`.

## Controles exercitados

Já existe evidência técnica para:

- criação PIX em produção e baixa financeira;
- cartão aprovado e rejeitado em sandbox;
- idempotência de criação no Mercado Pago sandbox;
- webhook assinado, reconsulta e deduplicação em sandbox;
- recuperação de webhook perdido por reconciliação;
- convergência `not_found -> retry -> recovered`;
- falhas transitórias e escalada por repetição;
- concorrência webhook x reconciliador sem dupla baixa;
- kill switch de novas cobranças;
- fluxo de refund protegido e idempotente por contrato;
- fluxo de chargeback, documentação e deadlines por contrato;
- analytics server-side com outbox deduplicada em Fase A.

## Gates ainda abertos

### Primeiro cartão real

Nenhum cartão aprovado em produção foi observado até esta revisão. Quando ocorrer naturalmente, seguir `payment_first_card_production_validation.md`. Não criar cobrança real artificial para encerrar esse gate.

### Primeiro refund real

Nenhum refund de produção foi executado até esta revisão. Quando houver necessidade legítima de negócio, seguir `payment_first_real_refund_validation.md`. Não devolver dinheiro de uma transação real apenas para teste.

### Analytics server-side — Fase B

O pipeline está preparado, mas o dispatcher permanece fail-closed enquanto `GA4_API_SECRET` não estiver configurado. O `purchase` do navegador continua sendo a fonte ativa durante a transição. Não habilitar cron nem remover o evento client-side antes da validação do Measurement Protocol.

### Rotação de credenciais externas

O procedimento está formalizado em `payment_credential_rotation.md`. A rotação efetiva de credenciais do Mercado Pago e do GA4 exige ação no painel do respectivo provedor e não deve ser feita por copiar segredo em chat ou commit.

### Resíduo técnico isolado

A Edge Function `noop-schema-probe` continua implantada, exige JWT e responde apenas HTTP 410. A ferramenta de gerenciamento disponível nesta revisão não oferece exclusão de Edge Function. Ela permanece sem efeito operacional até haver uma operação de remoção suportada.

## Critério de prontidão

O domínio permanece pronto para operação normal enquanto:

1. o health financeiro for recente e `healthy`;
2. os quatro jobs financeiros permanentes estiverem ativos;
3. não houver tentativa aprovada sem baixa;
4. não houver alertas críticos sem investigação;
5. novas cobranças continuarem protegidas por idempotência e kill switch;
6. webhooks e reconciliação permanecerem recuperáveis;
7. refunds e chargebacks continuarem protegidos por MFA e estados persistentes;
8. tabelas/RPCs técnicas permanecerem indisponíveis ao cliente;
9. os contratos de pagamento estiverem verdes na CI;
10. os gates de primeira ocorrência real forem fechados somente por eventos legítimos.

## Próxima revisão

Atualizar este relatório quando ocorrer qualquer um dos seguintes eventos:

- primeiro cartão real aprovado;
- primeiro refund real;
- primeiro chargeback real;
- ativação da Fase B de analytics server-side;
- rotação de credencial financeira;
- troca ou inclusão de provedor de pagamento;
- incidente P0/P1 que introduza nova classe de falha.
