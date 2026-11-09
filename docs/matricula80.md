# Matrícula promocional R$ 80 — rota /matricula80/

## Oferta

- Modalidade: aulas de inglês em grupo (categoria `QUINTETO`), até cinco alunos por turma.
- Frequência usada nesta implementação: quatro aulas mensais.
- Mensalidade fixa: R$ 80.
- Origem registrada no servidor: `anúncio80`.
- URL: `https://teacherflavius.com/matricula80/`.
- Formulário: autenticação Google, nome completo, CPF, data de nascimento e WhatsApp com DDD.

## Fluxo

1. A página encaminha o visitante sem sessão ao login Google existente e recebe o retorno no mesmo endereço.
2. A RPC `authorize_my_matricula80` autoriza somente contas novas e grava a origem. A oferta é armazenada em `private.enrollment_invite_links`; o navegador não determina preço nem modalidade.
3. A página valida nome, dígitos verificadores do CPF, data de nascimento e telefone.
4. As RPCs existentes registram `QUINTETO` e o plano de R$ 80; a conclusão do perfil gera a primeira mensalidade, com vencimento no dia da matrícula, em `America/Sao_Paulo`.
5. O aluno é redirecionado a `/pagamento/?matricula80=1`, que apresenta somente a modalidade Pix do Mercado Pago.
6. A baixa financeira mantém os webhooks assinados, reconciliação, idempotência e validação do valor no servidor do fluxo atual.
7. `get_my_matricula80_payment_gate` impede acesso às áreas de estudo até a primeira cobrança ser quitada. A validação é acionada no guard de autenticação para perfis cadastrados a partir da campanha.
8. Após a confirmação, o gatilho `prepare_next_tuition_after_payment` gera a próxima competência e ajusta meses curtos ao último dia, sem exigir recorrência automática no Mercado Pago.

## Restrições importantes

- O Pix é **manual a cada mês**: a matrícula não cadastra débito automático. A geração das cobranças posteriores é automática.
- O plano não atribui uma turma/hora de aula automaticamente. A vinculação à turma ocorrerá pelo professor, respeitando data da primeira aula e controle de vagas.
- O primeiro Pix deve ser iniciado até 23h59 da data da matrícula (horário de Brasília), conforme política já existente no checkout. Se o prazo expirar, a regularização exige atendimento do professor.
- O mecanismo de bloqueio de acesso de novos alunos a aulas atua depois da conclusão cadastral; o perfil permanece no banco como matriculado, ainda que aguardando a confirmação financeira.
- A rota traz `noindex,nofollow` e não consta do sitemap: formulário de campanha não destinado a resultados de pesquisa. Revisar essa decisão antes de qualquer inclusão no sitemap.
- A oferta de quatro aulas mensais deve ser validada com o professor caso o anúncio represente frequência diferente.

## Testes

- Sem sessão: botão para entrada Google.
- Nova conta Google: preenchimento e matrícula com plano e origem do servidor.
- Conta já matriculada: acesso preservado, sem troca do plano.
- Pagamento pendente: redirecionamento para Pix e bloqueio das áreas de estudo.
- Pagamento aprovado: acesso liberado, nova cobrança para a competência seguinte.
- Erros: CPF, data ou WhatsApp inválidos, cobrança indisponível, Google cancelado e webhook atrasado.
- Validar um Pix real de baixo risco em ambiente de homologação antes de ampliar o anúncio.
