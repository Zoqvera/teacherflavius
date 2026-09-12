# Decision gate para futuros provedores de pagamento

Data de referência: 12 de setembro de 2026.

## Decisão atual

Mercado Pago permanece o único provedor financeiro de produção do TeacherFlavius.com.

Esta etapa **não autoriza migração, multi-provider ou fallback automático para outro gateway**. A inclusão ou substituição de provedor exige uma nova decisão explícita depois de passar por este gate.

## Quando abrir uma avaliação

Uma análise de outro provedor só deve ser iniciada quando existir ao menos um gatilho concreto:

- indisponibilidade recorrente com impacto operacional material;
- mudança relevante de tarifas, prazo de liquidação ou condições comerciais;
- recurso de negócio necessário não suportado pelo provedor atual;
- problema regulatório, de compliance, privacidade ou segurança;
- deterioração persistente de suporte ou SLA;
- necessidade comprovada de redundância que justifique a complexidade adicional.

Preferência genérica por outro fornecedor, marketing ou existência de SDK diferente não constituem motivo suficiente.

## Critérios obrigatórios do candidato

O candidato precisa demonstrar, antes de qualquer código de produção:

### Pagamentos

- suporte adequado a PIX no Brasil;
- cartões com tokenização/checkout compatível com PCI;
- valor da cobrança definido/validado server-side;
- idempotência documentada para criação;
- identificador de pagamento persistente e consultável;
- ambiente de teste/sandbox realista.

### Webhooks e convergência

- assinatura/autenticação verificável de Webhook;
- consulta autoritativa do pagamento por ID;
- mecanismo que permita recuperar evento perdido;
- possibilidade de reconciliação periódica;
- semântica clara de estados pendente, aprovado, rejeitado e revertido;
- replay/deduplicação compatíveis com processamento idempotente.

### Pós-pagamento

- refund integral;
- comportamento idempotente ou recuperável de refund;
- chargebacks/disputas consultáveis;
- deadlines e documentação de disputa quando aplicável;
- identificação de reversão/estorno na API.

### Operação e segurança

- segredos exclusivamente server-side;
- ausência de armazenamento local de PAN/CVV;
- documentação oficial estável;
- política de versionamento/depreciação compreensível;
- status page/incident communication;
- capacidade de limitar privilégios das credenciais quando disponível;
- aderência à LGPD e fluxo internacional de dados revisável.

## Prova técnica antes de produção

Nenhum candidato pode receber tráfego financeiro real antes de provar em ambiente de teste:

1. pagamento aprovado;
2. pagamento rejeitado;
3. idempotência de criação;
4. Webhook válido;
5. Webhook duplicado sem efeito duplicado;
6. Webhook perdido recuperado por reconciliação;
7. falha transitória seguida de convergência;
8. concorrência Webhook x reconciliador sem dupla baixa;
9. refund e repetição segura;
10. chargeback/disputa quando o sandbox permitir;
11. kill switch de novas cobranças;
12. observabilidade e alertas;
13. nenhum acesso de cliente a tabelas/RPCs técnicas;
14. rollback para o provedor anterior sem perder o estado financeiro.

## Requisitos arquiteturais

Uma futura abstração multi-provider só pode ser criada depois de haver dois provedores realmente aprovados para uso. Não antecipar uma camada genérica sem necessidade, porque isso aumenta a superfície financeira e dificulta auditoria.

Se um segundo provedor for aprovado, a arquitetura deve preservar:

- uma identidade interna estável da tentativa;
- `provider` explícito em toda tentativa;
- idempotência separada por provedor;
- settlement local único e transacional;
- reconciliação independente;
- Webhooks isolados por segredo/provedor;
- refunds associados ao gateway originador da cobrança;
- chargebacks associados ao gateway originador;
- health e alertas capazes de distinguir falha local de falha do provedor.

Nunca fazer fallback automático de uma cobrança falhada para outro gateway usando uma nova chave sem confirmação explícita, pois isso pode criar duas cobranças quando o resultado original for ambíguo.

## Critérios comerciais para comparação

Depois de o candidato passar pelos requisitos técnicos, comparar pelo menos:

- custo efetivo por PIX e cartão;
- prazo de liquidação;
- custo/condições de antecipação;
- política de refund;
- política e custo de chargeback;
- estabilidade e disponibilidade observadas;
- qualidade de suporte;
- esforço operacional e de manutenção;
- impacto de migração para alunos e professor.

Preço isolado não supera requisitos de integridade financeira.

## Gate de aprovação

Uma mudança de provedor só pode prosseguir quando houver simultaneamente:

- justificativa de negócio registrada;
- sandbox E2E concluído;
- revisão de segurança e privacidade;
- estratégia de migração/rollback;
- atualização do runbook;
- atualização dos contratos de CI;
- plano de observabilidade;
- plano para refunds/chargebacks de pagamentos antigos;
- decisão explícita do responsável pelo TeacherFlavius.com.

Sem esses itens, a decisão é **NO-GO**.

## Estado em 12 de setembro de 2026

Não existe gatilho técnico atual que obrigue mudança de gateway: o health financeiro está `healthy`, os pagamentos PIX de produção estão convergindo e os mecanismos de cartão estão validados em sandbox. O primeiro cartão real e o primeiro refund real continuam sendo gates de observação, não justificativa para adicionar outro provedor.

Decisão: **manter Mercado Pago como provedor único e reavaliar somente quando surgir um gatilho concreto**.

## SEO

A escolha interna do gateway não é, por si só, uma mudança de SEO. Se uma futura migração alterar URLs públicas de checkout, conteúdo indexável, canonicals, redirecionamentos ou estrutura de páginas, a mudança deve ser tratada separadamente como impacto de SEO e submetida a decisão antes da implantação.
