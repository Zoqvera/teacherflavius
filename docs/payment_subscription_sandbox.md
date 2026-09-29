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

For the current stage-mode subscription test, configure these GitHub secrets with the test credentials from the subscription application:

- `MERCADO_PAGO_SUBSCRIPTION_STAGE_ACCESS_TOKEN`;
- `MERCADO_PAGO_SUBSCRIPTION_STAGE_PUBLIC_KEY`.

The test request always uses `payer_email=test_payer@testuser.com`, matching the current Mercado Pago authorized-subscription example. The stage flow sends `X-scope: stage`.

The probe performs a read-only credential preflight before tokenizing the card. The subscription creation request retries HTTP 502/503/504 twice with the same idempotency key, so transient gateway failures do not create duplicate subscriptions.

## Sandbox Webhook

The isolated endpoint remains available at:

`https://wnigzpvgsbpjdxvjzugt.supabase.co/functions/v1/mercado-pago-subscription-sandbox-webhook`

Some subscription applications do not expose Webhook configuration in the Mercado Pago application panel. The API smoke test therefore does not depend on Webhook delivery. Webhook validation is a separate acceptance step when Mercado Pago exposes a supported notification configuration for the application.

For provider re-fetches, the Edge Function prefers `MERCADO_PAGO_SUBSCRIPTION_STAGE_ACCESS_TOKEN`. Existing sandbox credentials remain fallback values for compatibility.

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
- if an authorized invoice is generated during the test window, its payment is confirmed with `live_mode=false`;
- Webhook delivery is validated separately when a supported subscription notification configuration is available;
- no rows are created in production subscription or tuition tables.

The recurring creation feature flag remains disabled until these checks are completed.
