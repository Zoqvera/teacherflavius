# Payment concurrency validation

This document records the operational race probe used to validate that Mercado Pago webhook-style synchronization and automatic reconciliation cannot apply the same tuition payment twice.

## Production invariant

`public.process_mercado_pago_payment` locks the target row in `tuition_payment_attempts` and the linked row in `monthly_tuition` with `FOR UPDATE` before mutating either record. Approved-payment application then updates the tuition only while `payment_date IS NULL`. A second concurrent caller therefore waits for the first transaction and re-reads the committed state before continuing.

Both the webhook/replay synchronization path and the automatic reconciler ultimately call `process_mercado_pago_payment`.

## Probe

`payment-concurrency-probe` is an internal Edge Function that reuses `synchronizeMercadoPagoPayment`, the same shared synchronization helper used by the webhook replay path. It accepts only a provider payment ID and requires the same short-lived HMAC signature used by the automatic reconciliation dispatcher.

The probe intentionally has no browser CORS surface and does not accept an end-user JWT as authorization.

## Safe race procedure

The concurrency test must use an already-approved, already-applied production payment. Before the race:

1. snapshot the tuition financial fields, attempt reconciliation metadata, and related `monthly_tuition_events` counts;
2. temporarily make the approved attempt due for automatic reconciliation by moving only `last_reconciled_at` into the past;
3. dispatch `payment-concurrency-probe` and `private.dispatch_mercado_pago_reconciliation()` in the same SQL statement so both HTTP requests are queued together by `pg_net`;
4. wait for both responses;
5. confirm the financial tuition snapshot is unchanged;
6. confirm there is no new `payment_recorded` or `duplicate_payment_detected` event;
7. confirm only one attempt remains linked to the provider payment ID and no duplicate provider-payment invariant is violated;
8. restore the original `last_reconciled_at` value.

The test does not create a charge, refund, reversal, or new tuition payment. Its only temporary production mutation is reconciliation scheduling metadata on an already-settled attempt.

## Success criteria

A successful race has both synchronization paths return a successful outcome while:

- `payment_date`, `amount_paid`, `payment_method`, `payment_provider`, and `provider_payment_id` remain unchanged;
- no new financial application event is created;
- no duplicate-payment event is created;
- `applied_at` remains populated exactly once;
- the provider payment ID remains unique across attempts;
- financial health remains healthy after the test.

## SEO

This operational test does not change public pages, metadata, canonical URLs, sitemap, robots directives, or indexable content.
