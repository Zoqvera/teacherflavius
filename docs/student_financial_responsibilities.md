# Responsável financeiro por outro aluno

## Objetivo

Dois alunos mantêm planos, matrículas, histórico e créditos independentes.
Um deles poderá assumir o pagamento de mensalidades de outro, sem transformar
o beneficiário em aluno com mensalidade gratuita e sem alterar a quantidade
de aulas contratadas pelo responsável.

Exemplo: duas mensalidades de R$ 50 correspondem a R$ 100 cobrados ao pagante,
mas permanecem duas competências e dois serviços de R$ 50 contabilizados.

## Etapa 1 — Modelo de vínculo (2026-11-07)

A tabela privada `private.student_financial_responsibilities` registra pagante,
beneficiário, vigência mensal, encerramento e autoria administrativa.

As funções `get_teacher_financial_responsibilities`,
`set_teacher_financial_responsibility` e
`end_teacher_financial_responsibility` são acessíveis somente ao professor.
A tabela permanece sem acesso direto de alunos. Há proteção contra
vínculo consigo mesmo, encadeamentos, vínculos simultâneos para o mesmo
beneficiário, retroatividade financeira e tentativas de pagamento em andamento.

**Importante:** a presente migração não ativa cobrança consolidada
e não isenta mensalidades existentes. Não cadastrar vínculos de alunos
reais até a integração transacional de checkout e reconciliação estar
implantada e validada.

## Próximas etapas

1. Checkout agregado: apresentar ao pagante cada mensalidade e respectivo
   beneficiário, com uma cobrança única calculada no servidor.
2. Liquidação: preservar duas mensalidades e quitar cada uma exatamente uma
   vez a partir do mesmo pagamento confirmado, com idempotência, estorno,
   chargeback e trilha de auditoria.
3. Área administrativa e portal: permitir vinculação/encerramento, visualizar
   quem paga cada pacote e evitar cobrança individual ao beneficiário.
4. Validar relatórios de inadimplência, lembretes, datas de vencimento, regras
   de primeira mensalidade, créditos de aulas, assinaturas e arquivamento.
   Só disponibilizar a edição administrativa depois dos testes integrados.

A implantação atual não altera SEO nem páginas públicas.

## Etapa 2 — Motor financeiro isolado (2026-11-07)

A implementação adiciona a tabela privada
`financial_responsibility_payment_items` e três primitivas de servidor:
`private.quote_financial_responsibility_payment`,
`public.reserve_financial_responsibility_payment` e
`public.process_financial_responsibility_payment`.

A cotação soma as mensalidades individuais de uma mesma competência;
a reserva armazena um rateio imutável vinculado à tentativa de pagamento;
a liquidação e o estorno validam e alteram todas as mensalidades de uma só
vez, preservando o histórico por aluno.

**Estado:** os componentes foram aplicados ao Supabase, mas ainda não estão
conectados ao checkout, aos webhooks ou à interface. Isso é intencional para
impedir uma cobrança de R$ 100 sem liquidação completa das duas obrigações.
A função atual `process_mercado_pago_payment` permanece inalterada.

**Etapa seguinte:** integrar criação de pagamento, reconciliação/webhook,
relatórios e UI administrativa. Testar em sandbox primeiro, inclusive
idempotência, atraso, disputa, estorno e alteração de responsável.

## Etapa 3 — Checkout e painel administrativo (2026-11-07)

O checkout dos alunos passou a consultar o valor consolidado no servidor
(`get_financial_responsibility_payment_quote_internal`), e a tentativa de
pagamento mantém um único identificador de transação do Mercado Pago.

O gateway `process_mercado_pago_payment` continua atendendo normalmente
as mensalidades individuais, mas encaminha cobranças consolidadas para
`process_financial_responsibility_payment`. O contrato de idempotência e
a conciliação por webhook são mantidos. Na baixa, a mensalidade do pagante
guarda o ID exclusivo do provedor; as mensalidades dos beneficiários são
quitadas com suas próprias quantias e eventos de auditoria ligados à
tentativa principal.

`get_my_pending_tuitions` não mostra mensalidades cobertas na conta
do beneficiário, e um trigger impede tentativas de pagamento individuais
para essas competências. A área administrativa mostra o pagante e permite
registrar e encerrar vínculos, mantendo os planos de aula separados.

As assinaturas recorrentes ativas são incompatíveis com essa modalidade
até que seja construída uma estratégia de assinatura consolidada.
O sistema bloqueia o vínculo quando há assinatura ativa e impede ativar
uma assinatura conflitante após o vínculo.

### Validação operacional antes do primeiro vínculo real

- Verificar publicação do frontend e da Edge Function
  `create-mercado-pago-payment`, incluindo a configuração JWT atual.
- Em um ambiente de homologação, simular pagamento de R$ 100 com duas
  mensalidades de R$ 50, retomada por webhook duplicado e estorno total.
- Conferir primeira mensalidade, competências com dias de vencimento
  diferentes, pagamentos pendentes e cobrança recorrente.
- Adaptar os relatórios de inadimplência para identificar explicitamente
  o responsável pela dívida, sem contar duas dívidas independentes
  contra dois pagantes diferentes.
- Avaliar arquivamento do pagante e do beneficiário e atualização de
  alertas e comunicação financeira.

**Não confundir pagamento por terceiro com isenção:** as mensalidades
cobertas continuam a ter os valores contratuais e não recebem o marcador
`is_exempt`.

Nenhuma alteração de SEO foi introduzida.

## Etapa 4 — Auditoria operacional e reconciliação (07/11/2026)

### Regras corrigidas

1. Ao arquivar o pagante **ou** o beneficiário, o vínculo financeiro é
   encerrado no mesmo comando do banco. Se a competência atual já está
   paga ou possui pagamento em processamento, a responsabilidade fica
   preservada até o mês seguinte para não romper a conciliação.
   Arquivamento continua removendo vínculos de turma e pausando cobranças
   do aluno arquivado pelas regras preexistentes.
2. Ao desarquivar um aluno com plano mensal válido, o sistema retoma
   a cobrança a partir do próximo vencimento elegível, sem recriar
   matrículas em turmas. Uma isenção permanente não é sobrescrita.
3. Vínculos novos exigem o mesmo dia de vencimento entre pagante e
   beneficiário e não podem ser encerrados retroativamente em
   competências já pagas.
4. Uma transação de R$ 100 com dois pacotes de R$ 50 agora aparece
   com R$ 100 como valor integral no fluxo administrativo de reembolso.
   O pedido é validado contra todas as mensalidades cobertas; o estorno
   sempre é total, não uma reversão isolada de R$ 50.
5. Gatilhos impedem quitação/isencão/estorno isolado de uma mensalidade
   pertencente a um grupo. Uma verificação diferida exige que todos os
   pacotes de uma tentativa consolidada estejam pagos ou não pagos ao
   fim da mesma transação do banco.
6. O painel administrativo de mensalidades identifica o aluno
   responsável e exporta essa atribuição para o Excel. Operações
   manuais individuais em competências consolidadas ficam bloqueadas
   na interface.
7. A automação de inadimplência das 7h passou a distinguir o aluno
   beneficiário do responsável pelo pagamento, somando o saldo por
   pagante e indicando pagamentos ainda pendentes de conciliação.

### Validações realizadas

- Auditoria somente-leitura em
  `tests/sql/financial_responsibility_operational_attestation.sql`;
  todos os campos de segurança, gatilhos e funções esperados
  retornaram verdadeiro.
- Nenhum registro de responsabilidade financeira e nenhuma reserva
  consolidada foi criado durante a auditoria.
- Os testes de contrato estão em
  `tests/financial_responsibility_operational_audit_contract.test.js`.

### Limites de homologação

A auditoria de estrutura e as verificações de contrato **não são
equivalentes a um teste transacional com um pagamento sandbox real**.
Para declarar a funcionalidade totalmente homologada, ainda é preciso
executar com identidades de teste isoladas: dois pacotes de R$ 50,
mesmo vencimento, cobrança Pix/cartão de R$ 100, webhook aprovado
duplicado, verificação de quatro créditos por aluno, estorno total,
reprocessamento idempotente e arquivamento em cobrança pendente.
Não criar pagamentos de teste utilizando contas de estudantes reais.

A alteração não altera SEO.
