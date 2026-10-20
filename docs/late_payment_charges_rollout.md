# Encargos por atraso — preparação e critérios de ativação

## Solicitação

Aplicar automaticamente multa moratória única de 2% e juros simples de 1% ao mês, proporcionalmente aos dias de atraso, às mensalidades juridicamente elegíveis. Exibir previamente as condições na página de pagamento. O professor deseja abranger também parcelas já vencidas.

## Estado desta entrega

- Aviso acessível publicado no HTML de `/pagamento/`, com indicação expressa de que os encargos dependem das condições aplicáveis à contratação.
- Estilos específicos e verificação automatizada do aviso.
- **Nenhuma cobrança, alteração de saldo, migração ou ativação no Mercado Pago é realizada nesta entrega.**
- A página de pagamento mantém `noindex, nofollow`; nenhuma regra de indexação, metadado SEO ou URL canônica é alterada.

## Restrições verificadas no sistema atual

1. Os Termos de Uso vigentes desde 06/10/2026 não especificam multa e juros de mora.
2. `get_my_pending_tuitions` atualmente apresenta `monthly_tuition.amount_due`; o checkout usa esse mesmo campo na inicialização do Mercado Pago.
3. `create-mercado-pago-payment` consulta o valor no servidor e grava o montante imutável em `tuition_payment_attempts.amount`.
4. `process_mercado_pago_payment` confere o valor da tentativa e o valor da mensalidade. Alterar apenas o navegador, ou modificar `monthly_tuition.amount_due` enquanto um Pix está pendente, pode impedir baixas e criar divergência na reconciliação.
5. A primeira mensalidade de certas matrículas possui bloqueio de novas tentativas após o dia da matrícula. Preservar a exceção para pagamentos iniciados dentro do prazo.

## Critérios para a próxima etapa

1. Revisar instrumentos contratuais e evidências de concordância de cada aluno, sem presumir que a simples edição unilateral dos Termos de Uso imponha uma multa a dívidas anteriores. Classificar pendências existentes pela elegibilidade. Para juros legais não convencionados, observar o art. 406 do Código Civil na redação da Lei 14.905/2024.
2. Instituir uma política versionada e auditável de encargos, com data de início e regra explícita para parcelas anteriores. A multa contratual de até 2% deve respeitar o CDC, art. 52, §1º. Percentuais e início da aplicação devem ser comunicados/aceitos conforme aplicável.
3. Implementar uma cotação autoritativa no servidor com principal, dias, multa, juros, total, data e versão da política, utilizando datas civis de São Paulo e arredondamento monetário controlado.
4. Congelar o valor da cotação por tentativa no Mercado Pago. Tentativas Pix existentes não devem sofrer majoração retroativa, e as tentativas idempotentes devem continuar recuperáveis.
5. Ajustar `get_my_pending_tuitions`, `create-mercado-pago-payment`, `process_mercado_pago_payment`, reconciliações, estornos, registros administrativos e relatórios para desagregar principal, multa e juros sem perder a trilha contábil.
6. Testar sem tocar dados financeiros de produção: vencimento, dia seguinte, 30 dias, meses curtos, isenção, taxa/percentual inválidos, histórico elegível/ineligível, pagamento já iniciado, duplicidade, retry e webhook fora de ordem.
7. Somente ativar cobranças após concluir os critérios e as verificações de homologação. Não realizar uma atualização em massa de débitos antigos sem respaldo verificável.

Referências legais: Lei 8.078/1990, arts. 46, 51 e 52, §1º; Lei 14.905/2024, com nova redação do art. 406 do Código Civil.
