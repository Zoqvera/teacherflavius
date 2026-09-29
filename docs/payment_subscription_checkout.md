# Mercado Pago subscription checkout

This phase adds the student-facing recurring subscription flow to `/pagamento/` while keeping production activation behind `MERCADO_PAGO_SUBSCRIPTIONS_ENABLED`.

## Browser flow

The payment page loads an authenticated subscription preview from `create-mercado-pago-subscription`.

The subscription section is rendered only when:

- a current subscription already exists; or
- subscription creation is enabled and the Mercado Pago public key is available.

For a new subscription, the student sees the server-derived monthly amount, due day and first recurring charge date before entering card data.

## Card tokenization

The page uses the Mercado Pago Card Payment Brick.

The Brick receives the monthly amount and authenticated account e-mail. Debit and prepaid cards are excluded from this flow.

The browser sends only `card_token_id` to the subscription Edge Function. Raw card number, expiration date and security code are never sent to Teacherflavius application code and are never persisted.

The Card Payment Brick is unmounted whenever the checkout is closed or the page is left.

## Server-side creation

The Edge Function continues to derive all commercial terms from `student_billing_settings`.

The browser cannot set:

- monthly amount;
- due day;
- payer e-mail;
- first charge date;
- subscription external reference.

The Edge Function sends the tokenized card to Mercado Pago through `POST /preapproval` and persists only provider identifiers and subscription lifecycle metadata.

## Feature gate

The student-facing checkout remains unavailable unless all of the following are true:

- `MERCADO_PAGO_SUBSCRIPTIONS_ENABLED=true`;
- `MERCADO_PAGO_ACCESS_TOKEN` is configured;
- `MERCADO_PAGO_PUBLIC_KEY` is configured.

When the flag is disabled and the student has no existing subscription, the new UI stays hidden.

## Validation before activation

Before enabling the flag in production, complete one controlled subscription test with Mercado Pago test credentials and verify:

1. card token creation;
2. subscription creation;
3. `subscription_preapproval` webhook synchronization;
4. `subscription_authorized_payment` reconciliation;
5. recurring payment mapping into `monthly_tuition`;
6. no duplicate tuition payment is recorded.
