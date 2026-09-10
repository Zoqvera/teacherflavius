create or replace function public.validate_mercado_pago_reconciliation_signature(
  candidate_timestamp text,
  candidate_signature text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  reconciliation_secret text;
  expected_signature text;
begin
  if candidate_timestamp !~ '^[0-9]{10,13}$'
     or candidate_signature !~ '^[a-fA-F0-9]{64}$' then
    return false;
  end if;

  select ds.decrypted_secret
    into reconciliation_secret
  from vault.decrypted_secrets as ds
  where ds.name = 'mercado_pago_reconciliation_cron_secret'
  limit 1;

  if nullif(reconciliation_secret, '') is null then
    return false;
  end if;

  expected_signature := pg_catalog.encode(
    extensions.hmac(candidate_timestamp, reconciliation_secret, 'sha256'),
    'hex'
  );

  return expected_signature = lower(candidate_signature);
end;
$$;

revoke all on function public.validate_mercado_pago_reconciliation_signature(text, text)
  from public, anon, authenticated;
grant execute on function public.validate_mercado_pago_reconciliation_signature(text, text)
  to service_role;

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

create or replace function private.dispatch_mercado_pago_reconciliation()
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
  select ds.decrypted_secret
    into reconciliation_secret
  from vault.decrypted_secrets as ds
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
    url := 'https://wnigzpvgsbpjdxvjzugt.supabase.co/functions/v1/reconcile-mercado-pago-automated',
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

revoke all on function private.dispatch_mercado_pago_reconciliation() from public;
revoke all on function private.dispatch_mercado_pago_reconciliation() from anon;
revoke all on function private.dispatch_mercado_pago_reconciliation() from authenticated;

do $$
declare
  existing_job_id bigint;
begin
  select jobid
    into existing_job_id
  from cron.job
  where jobname = 'mercado-pago-reconciliation'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'mercado-pago-reconciliation',
    '*/5 * * * *',
    'select private.dispatch_mercado_pago_reconciliation();'
  );
end;
$$;
