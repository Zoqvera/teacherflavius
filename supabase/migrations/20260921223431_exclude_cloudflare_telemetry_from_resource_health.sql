do $migration$
declare
  current_definition text;
  updated_definition text;
  old_fragment text := $fragment$
  select count(*) into resource_errors_15m
  from public.app_error_events e
  where e.created_at >= now() - interval '15 minutes'
    and e.event_type = 'resource';
$fragment$;
  new_fragment text := $fragment$
  select count(*) into resource_errors_15m
  from public.app_error_events e
  where e.created_at >= now() - interval '15 minutes'
    and e.event_type = 'resource'
    and coalesce(e.source, '') not like 'https://static.cloudflareinsights.com/beacon.min.js/%';
$fragment$;
begin
  select pg_get_functiondef('private.run_system_health_check(boolean)'::regprocedure)
  into current_definition;

  if position(old_fragment in current_definition) = 0 then
    raise exception 'Expected resource health fragment was not found.';
  end if;

  updated_definition := replace(current_definition, old_fragment, new_fragment);

  if updated_definition = current_definition then
    raise exception 'System health function was not changed.';
  end if;

  execute updated_definition;
end
$migration$;
