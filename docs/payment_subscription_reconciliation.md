# Mercado Pago subscription reconciliation

This phase adds provider-state synchronization and monthly tuition reconciliation for recurring Mercado Pago charges. It does not expose subscription creation in the student payment page and does not enable real subscription creation.

## Supported webhook topics

The production Mercado Pago webhook now recognizes:

- `subscription_preapproval`
- `subscription_authorized_payment`
- `payment` for both one-off payments and recurring subscription payments
- the existing chargeback topic

Every accepted notification keeps the existing HMAC validation and deduplication flow. The notification body is not trusted as the financial source of truth. After signature validation, the backend re-fetches the current Mercado Pago resource before changing local state.

## Subscription state

For `subscription_preapproval`, the backend reads:

`GET https://api.mercadopago.com/preapproval/{id}`

The returned provider ID, external reference, amount and currency must match the local `student_subscriptions` record before its status and provider metadata are updated.

## Recurring invoice state

For `subscription_authorized_payment`, the backend reads:

`GET https://api.mercadopago.com/authorized_payments/{id}`

When the invoice contains a payment ID, the backend also reads:

`GET https://api.mercadopago.com/v1/payments/{id}`

This provides the authoritative payment status, amount, payment method and approval timestamp.

A `payment` webhook that does not match a normal `tuition_payment_attempts` row is checked against:

`GET https://api.mercadopago.com/authorized_payments/search?payment_id={id}`

This prevents recurring subscription payments from being misclassified as failed one-off payments.

## Financial reconciliation

Recurring invoices are stored in `public.subscription_authorized_payments`.

The table is server-only, has RLS enabled and preserves `subject_ref` if a student account is later removed. It stores provider identifiers and financial lifecycle metadata, but no card credentials.

The database function `process_mercado_pago_subscription_invoice` atomically:

1. validates the local subscription and provider invoice;
2. derives the tuition reference month from the provider debit date in the São Paulo timezone;
3. creates the monthly tuition row when it does not exist;
4. refuses to overwrite a different amount or an exempt tuition;
5. records approved recurring payments;
6. detects duplicate payments instead of overwriting an existing payment;
7. reverses refunded, cancelled or charged-back recurring payments;
8. supports reinstatement if a reversed payment later becomes approved again.

## Replay

The administrative webhook replay endpoint remains protected by teacher MFA and now supports both subscription topics. Replay always re-fetches current Mercado Pago state; stored webhook payloads are never replayed.

## Activation boundary

`MERCADO_PAGO_SUBSCRIPTIONS_ENABLED` remains disabled. The student payment page is unchanged.

Before enabling recurring subscriptions:

1. configure the Mercado Pago webhook integration to send `subscription_preapproval` and `subscription_authorized_payment` to the existing production webhook URL;
2. validate the student-facing subscription checkout with Mercado Pago test credentials;
3. add pause/cancel management;
4. validate the complete recurring flow end to end;
5. only then enable `MERCADO_PAGO_SUBSCRIPTIONS_ENABLED=true`.
