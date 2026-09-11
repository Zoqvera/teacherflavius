create or replace function private.capture_payment_attempt_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.reconciliation_failure_count, 0) > 0
     and coalesce(old.reconciliation_failure_count, 0) = 0 then
    perform private.enqueue_payment_alert(
      'reconciliation_failure',
      'warning',
      'reconciliation_failure:' || new.id::text,
      new.tuition_id,
      new.id,
      new.provider_payment_id,
      pg_catalog.jsonb_build_object(
        'failure_count', new.reconciliation_failure_count,
        'error', left(coalesce(new.last_reconciliation_error, ''), 300),
        'payment_status', new.status
      )
    );
  end if;

  if new.status_detail is distinct from old.status_detail
     and (
       coalesce(new.status_detail, '') ~ '^provider_http_(429|5[0-9]{2})_'
       or coalesce(new.status_detail, '') ~ '^provider_http_403_pa_unauthorized_result_from_policies($|_)'
     ) then
    insert into public.payment_operational_events (
      event_type,
      event_code,
      attempt_id,
      provider_payment_id,
      details
    ) values (
      'gateway_failure',
      left(new.status_detail, 160),
      new.id,
      new.provider_payment_id,
      pg_catalog.jsonb_build_object('payment_status', new.status)
    );
  end if;

  return new;
end;
$$;

revoke all on function private.capture_payment_attempt_alert() from public, anon, authenticated;
