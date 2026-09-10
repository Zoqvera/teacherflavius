create index if not exists payment_chargebacks_source_webhook_event_idx
  on public.payment_chargebacks(source_webhook_event_id)
  where source_webhook_event_id is not null;
