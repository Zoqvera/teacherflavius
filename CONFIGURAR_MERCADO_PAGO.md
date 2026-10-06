# Configurar pagamentos com Mercado Pago

O portal usa o **Payment Brick** para aceitar Pix e cartão de débito dentro do
site. Os dados completos do cartão não passam pelo banco do Teacher Flávio: o
Mercado Pago gera um token no navegador e somente esse token é enviado à Edge
Function.

## Componentes

| Componente | Responsabilidade |
| --- | --- |
| `/pagamento/` | Checkout do aluno com Pix e cartão de débito |
| `student_payment_notice.js` | Faixa vermelha e pop-up de mensalidade pendente |
| `create-mercado-pago-payment` | Valida aluno e valor, cria o pagamento e aplica aprovações imediatas |
| `mercado-pago-webhook` | Valida a assinatura do Mercado Pago e sincroniza mudanças de status |
| `reconcile-mercado-pago-payments` | Reconsulta pagamentos pendentes quando uma notificação não chega e aplica a confirmação com segurança |
| `supabase_mercado_pago.sql` | Tentativas, RPC do aluno e processamento financeiro atômico |

O valor enviado ao Mercado Pago sempre vem de `public.monthly_tuition`. Valores
recebidos do navegador são ignorados para impedir alteração da cobrança.

## 1. Criar a aplicação no Mercado Pago

1. Entre em [Suas integrações](https://www.mercadopago.com.br/developers/panel/app).
2. Crie uma aplicação para `teacherflavius.com`.
3. Selecione **Checkout Bricks** como produto.
4. Comece com as credenciais de teste.
5. Separe a `Public Key` e o `Access Token` correspondentes ao mesmo ambiente.

Não envie o Access Token por mensagem e nunca o adicione ao GitHub. Ele deve ser
salvo apenas em **Supabase > Edge Functions > Secrets**.

## 2. Aplicar o banco

No SQL Editor do projeto `wnigzpvgsbpjdxvjzugt`, execute todo o arquivo:

```text
supabase_mercado_pago.sql
```

Depois, reaplique `supabase_seguranca_fase1.sql` para manter a lista explícita de
RPCs autorizadas.

## 3. Configurar os Secrets

Secrets necessários:

```text
MERCADO_PAGO_PUBLIC_KEY
MERCADO_PAGO_ACCESS_TOKEN
MERCADO_PAGO_WEBHOOK_SECRET
SITE_URL=https://teacherflavius.com
```

Pelo CLI, sem colocar os valores no histórico do repositório:

```bash
npx supabase login
npx supabase link --project-ref wnigzpvgsbpjdxvjzugt
npx supabase secrets set MERCADO_PAGO_PUBLIC_KEY=SUA_PUBLIC_KEY_DE_TESTE
npx supabase secrets set MERCADO_PAGO_ACCESS_TOKEN=SEU_ACCESS_TOKEN_DE_TESTE
npx supabase secrets set SITE_URL=https://teacherflavius.com
```

O `MERCADO_PAGO_WEBHOOK_SECRET` será obtido no próximo passo.

## 4. Publicar as Edge Functions

```bash
npx supabase functions deploy create-mercado-pago-payment
npx supabase functions deploy mercado-pago-webhook --no-verify-jwt
npx supabase functions deploy reconcile-mercado-pago-payments
```

`create-mercado-pago-payment` exige a sessão JWT do aluno. O webhook não recebe
JWT do Supabase, por isso a verificação da plataforma é desativada; a própria
função exige e valida a assinatura HMAC do Mercado Pago.

`reconcile-mercado-pago-payments` exige JWT e limita a consulta às cobranças do
próprio aluno. Um administrador autenticado pode reconciliar as tentativas
pendentes exibidas no controle de mensalidades. Essa recuperação automática
consulta sempre o status real na API do Mercado Pago antes de baixar a cobrança.

## 5. Configurar o Webhook

Na aplicação do Mercado Pago:

1. abra **Webhooks > Configurar notificações**;
2. escolha primeiro o modo de teste;
3. cadastre esta URL HTTPS:

```text
https://wnigzpvgsbpjdxvjzugt.supabase.co/functions/v1/mercado-pago-webhook
```

4. ative o evento **Pagamentos**;
5. salve e revele a assinatura secreta gerada;
6. salve a assinatura no Supabase:

```bash
npx supabase secrets set MERCADO_PAGO_WEBHOOK_SECRET=SUA_ASSINATURA_SECRETA
```

Os Secrets ficam disponíveis imediatamente; não é necessário republicar a
função depois de defini-los.

## 6. Testar antes da produção

Use uma conta de aluno que tenha uma mensalidade em aberto.

1. Entre no portal e confirme a faixa vermelha em mais de uma página.
2. Confirme que o pop-up aparece apenas uma vez por sessão.
3. Abra `/pagamento/`.
4. Crie um Pix e confirme a exibição do QR Code pelo Status Screen Brick.
5. Use um cartão de teste do Mercado Pago e valide aprovação e rejeição.
6. Simule uma notificação no painel do Mercado Pago.
7. Confirme que a mensalidade aprovada desaparece do checkout e passa a constar
   como paga na área administrativa.
8. Consulte os logs das duas Edge Functions e os Advisors do Supabase.

O cartão está limitado a **uma parcela**. Mensalidade não deve ser parcelada,
porque o parcelamento aumenta custo, conciliação e risco de estorno.

## 7. Ativar produção

Somente depois dos testes:

1. configure a URL do webhook também na aba de produção;
2. troque a Public Key e o Access Token de teste pelas credenciais de produção;
3. troque `MERCADO_PAGO_WEBHOOK_SECRET` pela assinatura da aba de produção;
4. faça um pagamento real de valor baixo e confira a conciliação;
5. só então libere o fluxo para todos os alunos.

## Segurança aplicada

- nenhuma chave privada fica no frontend ou no GitHub;
- o aluno consulta somente cobranças associadas a `auth.uid()`;
- o valor é lido novamente no servidor;
- toda criação usa `X-Idempotency-Key`;
- pagamentos duplicados em andamento são reaproveitados;
- webhooks precisam de assinatura HMAC válida;
- o pagamento retornado precisa coincidir em tentativa, identificador e valor;
- somente `service_role` pode baixar automaticamente uma mensalidade;
- o banco não armazena número, validade ou código de segurança do cartão.

Referências oficiais: [Payment Brick](https://www.mercadopago.com.br/developers/pt/docs/checkout-bricks/payment-brick/introduction),
[Pix](https://www.mercadopago.com.br/developers/pt/docs/checkout-bricks/payment-brick/payment-submission/pix),
[cartões](https://www.mercadopago.com.br/developers/pt/docs/checkout-bricks/payment-brick/payment-submission/cards)
e [Webhooks](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/additional-content/notifications/webhooks).
