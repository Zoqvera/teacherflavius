# Mercado Pago subscription sandbox

This sandbox validates recurring-subscription integration without writing to production tuition or subscription tables.

## Isolation

The sandbox uses only:

- Mercado Pago test credentials;
- test card data;
- `public.mercado_pago_subscription_sandbox_events`;
- the Edge Function `mercado-pago-subscription-sandbox-webhook`.

It does not read or mutate:

- `monthly_tuition`;
- `tuition_payment_attempts`;
- `student_subscriptions`;
- `subscription_authorized_payments`;
- real student accounts.

The evidence table has RLS enabled and direct access revoked from `public`, `anon` and `authenticated`.

## Manual smoke test

The GitHub Actions workflow `Payment contracts` has the manual input:

`run_subscription_probe=true`

When selected, the job:

1. tokenizes a Mercado Pago test card;
2. creates one subscription with `POST /preapproval`;
3. uses `status=authorized`, monthly recurrence and BRL;
4. assigns an `external_reference` beginning with `sandbox-subscription-`;
5. reads the subscription back from Mercado Pago;
6. polls `/authorized_payments/search?preapproval_id=...`;
7. when a payment exists, validates it through `/v1/payments/{id}`;
8. cancels the test subscription in a `finally` block.

The job uses the existing GitHub test secrets and never uses production Mercado Pago credentials.

## Sandbox Webhook

Configure the test-mode Webhook URL in Mercado Pago as:

`https://wnigzpvgsbpjdxvjzugt.supabase.co/functions/v1/mercado-pago-subscription-sandbox-webhook`

Enable these test topics:

- `subscription_preapproval`;
- `subscription_authorized_payment`.

The function requires the existing `MERCADO_PAGO_TEST_WEBHOOK_SECRET` and `MERCADO_PAGO_TEST_ACCESS_TOKEN`.

For every signed event it:

1. validates the HMAC signature;
2. rejects non-sandbox events;
3. re-fetches the corresponding Mercado Pago resource;
4. requires `live_mode=false` from the subscription/payment evidence;
5. requires the `sandbox-subscription-` reference prefix;
6. persists only derived evidence in the sandbox table;
7. deduplicates repeated deliveries.

Webhook payloads are not used as the financial source of truth and are not stored raw.

## Acceptance criteria

The sandbox is considered ready for production activation when a controlled run confirms:

- subscription creation succeeds;
- provider lookup confirms the same subscription;
- `live_mode=false`;
- the subscription is canceled during cleanup;
- at least one signed `subscription_preapproval` notification is persisted;
- if an authorized invoice is generated during the test window, its payment is also confirmed with `live_mode=false`;
- no rows are created in production subscription or tuition tables.

The recurring creation feature flag remains disabled until these checks are completed.
