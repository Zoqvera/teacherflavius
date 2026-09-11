# Payment concurrency validation

This document records the completed production race validation proving that Mercado Pago webhook synchronization and automatic reconciliation cannot apply the same tuition payment twice.

## Production invariant

`public.process_mercado_pago_payment` locks the target row in `tuition_payment_attempts` and the linked row in `monthly_tuition` with `FOR UPDATE` before mutating either record. Approved-payment application then updates the tuition only while `payment_date IS NULL`. A second concurrent caller therefore waits for the first transaction and continues against the committed state.

The production webhook uses `synchronizeMercadoPagoPayment`, which delegates settlement to `process_mercado_pago_payment`. The automatic reconciler also delegates settlement to the same RPC. The concurrency guarantee therefore lives in the shared database settlement boundary, not in an HTTP endpoint.

## Completed production validation

On 2026-09-11, a temporary internal Edge Function was used only to reproduce the webhook synchronization path while racing it against the automatic reconciler over an already-approved, already-applied production payment.

The two HTTP requests were queued together from one SQL transaction through `pg_net`. Both returned HTTP 200. The webhook-style path reported that no new payment application occurred, while the reconciler synchronized the same approved payment with zero duplicates and zero failures.

Post-race verification confirmed:

- `payment_date`, `amount_paid`, `payment_method`, `payment_provider`, and `provider_payment_id` were unchanged;
- the original `payment_recorded` event count remained exactly one;
- no `duplicate_payment_detected` event was created;
- `applied_at` remained unchanged;
- only one payment attempt remained linked to the provider payment ID;
- the financial-health check remained `healthy`, with zero warnings, critical issues, or financial inconsistencies.

The only temporary production mutation was `last_reconciled_at`, used to make the settled attempt eligible for the race. Its original value was restored after validation.

## Probe retirement

The temporary `payment-concurrency-probe` Edge Function and its repository source were retired immediately after the successful validation. It is not part of the production payment architecture and must not be redeployed as a permanent endpoint.

Permanent regression protection remains in `tests/payment_concurrency_contract.test.js`. The contract verifies the row locks, exactly-once application guard, and convergence of the production webhook and reconciler on `process_mercado_pago_payment`.

## SEO

This operational validation and probe retirement do not change public pages, metadata, canonical URLs, sitemap, robots directives, or indexable content.
