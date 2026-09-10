create table if not exists private.system_health_monitor_config (
  singleton boolean primary key default true check (singleton = true),
  activated_at timestamptz not null default now()
);

insert into private.system_health_monitor_config (singleton, activated_at)
values (true, now())
on conflict (singleton) do nothing;

revoke all on private.system_health_monitor_config from public, anon, authenticated;
grant select, insert, update on private.system_health_monitor_config to service_role;

create or replace function private.system_health_watchdog()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  last_health_at timestamptz;
  activated_at_value timestamptz;
  retried_alerts integer := 0;
  stalled integer := 0;
  bootstrap_grace boolean := false;
  bucket_key text := to_char(date_trunc('hour', now()) at time zone 'UTC', 'YYYYMMDDHH24');
begin
  select max(r.completed_at) into last_health_at from private.system_health_runs r;
  select c.activated_at into activated_at_value
  from private.system_health_monitor_config c
  where c.singleton = true;

  bootstrap_grace := last_health_at is null
    and activated_at_value is not null
    and activated_at_value > now() - interval '15 minutes';

  if not bootstrap_grace
     and (last_health_at is null or last_health_at < now() - interval '15 minutes') then
    perform private.enqueue_system_health_alert(
      'system_health_stalled',
      'critical',
      'system_health_stalled:' || bucket_key,
      jsonb_build_object(
        'last_health_at', last_health_at,
        'minutes_since_health', case when last_health_at is null then null else floor(extract(epoch from (now() - last_health_at)) / 60)::integer end
      )
    );
    stalled := 1;
  end if;

  update private.system_health_alerts a
  set status = 'pending', updated_at = now()
  where a.status = 'failed'
    and a.attempts < 5
    and coalesce(a.last_attempt_at, a.created_at) < now() - interval '10 minutes';
  get diagnostics retried_alerts = row_count;

  return jsonb_build_object(
    'stalled', stalled,
    'bootstrap_grace', bootstrap_grace,
    'retried_alerts', retried_alerts,
    'last_health_at', last_health_at
  );
end;
$$;

revoke all on function private.system_health_watchdog() from public, anon, authenticated;
grant execute on function private.system_health_watchdog() to service_role;
