create index if not exists payment_alert_notifications_tuition_id_idx
  on public.payment_alert_notifications (tuition_id);

create index if not exists payment_alert_notifications_attempt_id_idx
  on public.payment_alert_notifications (attempt_id);

create index if not exists payment_operational_events_attempt_id_idx
  on public.payment_operational_events (attempt_id);
