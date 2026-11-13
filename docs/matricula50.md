# Matrícula promocional R$ 50 — /matricula50/

## Regras da oferta

- Rota: `https://teacherflavius.com/matricula50/`.
- Modalidade: `QUINTETO` (aulas em grupo de até cinco alunos), quatro aulas por mês.
- Mensalidade: R$ 50, registrada no servidor por convite da oferta `matricula50`.
- O link não define origem comercial nem associa automaticamente o aluno a uma campanha Meta. Outras regras independentes de atribuição não são alteradas.
- A página compartilha `matricula80/app.js`, `matricula80/style.css` e as mesmas validações cadastrais da oferta R$ 80.

## Fluxo

1. O visitante entra com conta Google; a rota `/matricula50/` é preservada no retorno.
2. O novo aluno informa nome completo, CPF válido, data de nascimento e WhatsApp com DDD.
3. A função `authorize_my_matricula50` verifica o convite e autoriza, no servidor, apenas o valor e a modalidade. Não grava a origem nem cria vínculo de campanha. Matrículas existentes não são sobrescritas.
4. A conclusão do cadastro ativa o aluno e cria a primeira mensalidade. O dia da matrícula define o vencimento inicial, seguindo a política de cobrança existente.
5. O aluno vai para `/matricula-concluida/`, onde lê que o professor enviará pelo WhatsApp a chave Pix para pagar a primeira mensalidade. **Não há checkout do Mercado Pago no fluxo inicial.**
6. O bloqueio existente de primeiro pagamento identifica alunos da oferta R$ 50 pelo convite autorizado, sem exigir atribuição de marketing. O acesso às áreas de estudo depende da baixa da primeira mensalidade.
7. A política compartilhada para meses seguintes continua vigente; esta alteração não modifica a cobrança das mensalidades posteriores.

## Segurança e SEO

- A matrícula exige autenticação Google, utiliza RPC com acesso somente a `authenticated` e não aceita o preço informado pelo navegador.
- Uma conta já autorizada por outra oferta não pode trocar de plano usando esta rota.
- A página tem `noindex,nofollow`, URL canônica própria e não foi adicionada ao sitemap. Trata-se de uma decisão de SEO deliberada para páginas de campanha; alterá-la exige avaliação.
- O fluxo não atribui automaticamente turma ou horário: o professor mantém o controle das vagas e da data da primeira aula.

## Verificação

- Validar sessão ausente, retorno do OAuth, os quatro campos, CPF e WhatsApp inválidos.
- Validar matrícula nova e conta já matriculada; conferir mensalidade R$ 50 e ausência de atribuição automática de origem no novo fluxo.
- Confirmar ausência de vínculo automático com `anuncio50`, geração de mensalidade e redirecionamento exclusivo para `/matricula-concluida/`.
- Confirmar os avisos de PIX no WhatsApp e a liberação após a baixa financeira.
- Não criar pagamentos ou alunos reais durante testes automatizados.
