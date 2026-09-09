create or replace function public.list_mercado_pago_chargebacks(target_reference_month date)
returns table(
  tuition_id uuid,
  provider_chargeback_id text,
  amount numeric,
  currency text,
  reason text,
  coverage_applied boolean,
  coverage_eligible boolean,
  documentation_status text,
  documentation_deadline timestamptz,
  operational_status text,
  payment_status text,
  provider_created_at timestamptz,
  provider_updated_at timestamptz,
  last_reconciled_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    chargeback.tuition_id,
    chargeback.provider_chargeback_id,
    chargeback.amount,
    chargeback.currency,
    chargeback.reason,
    chargeback.coverage_applied,
    chargeback.coverage_eligible,
    chargeback.documentation_status,
    chargeback.documentation_deadline,
    chargeback.operational_status,
    chargeback.payment_status,
    chargeback.provider_created_at,
    chargeback.provider_updated_at,
    chargeback.last_reconciled_at
  from public.payment_chargebacks chargeback
  join public.monthly_tuition tuition on tuition.id = chargeback.tuition_id
  where tuition.reference_month = date_trunc('month', coalesce(target_reference_month, current_date))::date
  order by coalesce(chargeback.provider_updated_at, chargeback.provider_created_at, chargeback.created_at) desc;
$$;

revoke all on function public.list_mercado_pago_chargebacks(date) from public, anon, authenticated;
grant execute on function public.list_mercado_pago_chargebacks(date) to service_role;

create or replace function private.dispatch_mercado_pago_chargeback_reconciliation()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  reconciliation_secret text;
  request_timestamp text;
  request_signature text;
  request_id bigint;
begin
  select ds.decrypted_secret into reconciliation_secret
  from vault.decrypted_secrets ds
  where ds.name = 'mercado_pago_reconciliation_cron_secret'
  limit 1;

  if nullif(reconciliation_secret, '') is null then
    raise warning 'Mercado Pago reconciliation secret is unavailable';
    return null;
  end if;

  request_timestamp := floor(extract(epoch from pg_catalog.clock_timestamp()))::bigint::text;
  request_signature := pg_catalog.encode(
    extensions.hmac(request_timestamp, reconciliation_secret, 'sha256'),
    'hex'
  );

  select net.http_post(
    url := 'https://wnigzpvgsbpjdxvjzugt.supabase.co/functions/v1/reconcile-mercado-pago-chargebacks',
    body := '{}'::jsonb,
    params := '{}'::jsonb,
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'x-reconciliation-timestamp', request_timestamp,
      'x-reconciliation-signature', request_signature
    ),
    timeout_milliseconds := 30000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function private.dispatch_mercado_pago_chargeback_reconciliation() from public, anon, authenticated;

do $$
declare existing_job record;
begin
  for existing_job in select jobid from cron.job where jobname = 'mercado-pago-chargeback-reconciliation'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'mercado-pago-chargeback-reconciliation',
  '17,47 * * * *',
  'select private.dispatch_mercado_pago_chargeback_reconciliation();'
);
