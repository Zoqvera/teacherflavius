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
