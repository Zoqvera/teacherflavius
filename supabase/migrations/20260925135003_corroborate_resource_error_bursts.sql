do $migration$
declare
  current_definition text;
  updated_definition text;
  old_declaration text := $fragment$
  resource_errors_15m integer := 0;
  top_fingerprint_count integer := 0;
$fragment$;
  new_declaration text := $fragment$
  resource_errors_15m integer := 0;
  resource_top_fingerprint_count integer := 0;
  top_fingerprint_count integer := 0;
$fragment$;
  old_resource_query text := $fragment$
  select count(*) into resource_errors_15m
  from public.app_error_events e
  where e.created_at >= now() - interval '15 minutes'
    and e.event_type = 'resource'
    and coalesce(e.source, '') not like 'https://static.cloudflareinsights.com/beacon.min.js/%';
$fragment$;
  new_resource_query text := $fragment$
  select count(*) into resource_errors_15m
  from public.app_error_events e
  where e.created_at >= now() - interval '15 minutes'
    and e.event_type = 'resource'
    and coalesce(e.source, '') not like 'https://static.cloudflareinsights.com/beacon.min.js/%';

  select coalesce(max(grouped.events), 0)::integer
  into resource_top_fingerprint_count
  from (
    select e.fingerprint, count(*)::integer as events
    from public.app_error_events e
    where e.created_at >= now() - interval '15 minutes'
      and e.event_type = 'resource'
      and coalesce(e.source, '') not like 'https://static.cloudflareinsights.com/beacon.min.js/%'
      and nullif(e.fingerprint, '') is not null
    group by e.fingerprint
  ) grouped;
$fragment$;
  old_condition text := $fragment$
  if resource_errors_15m >= 15 then
    insert into pg_temp.system_health_issues values (
      'resource_error_burst', 'warning', jsonb_build_object('count_15m', resource_errors_15m)
    );
  end if;
$fragment$;
  new_condition text := $fragment$
  if resource_errors_15m >= 15 and resource_top_fingerprint_count >= 5 then
    insert into pg_temp.system_health_issues values (
      'resource_error_burst',
      'warning',
      jsonb_build_object(
        'count_15m', resource_errors_15m,
        'top_resource_fingerprint_count_15m', resource_top_fingerprint_count
      )
    );
  end if;
$fragment$;
  old_metric text := $fragment$
    'resource_errors_15m', resource_errors_15m,
    'top_fingerprint_15m', top_fingerprint_value,
$fragment$;
  new_metric text := $fragment$
    'resource_errors_15m', resource_errors_15m,
    'resource_top_fingerprint_count_15m', resource_top_fingerprint_count,
    'top_fingerprint_15m', top_fingerprint_value,
$fragment$;
begin
  select pg_get_functiondef('private.run_system_health_check(boolean)'::regprocedure)
  into current_definition;

  updated_definition := replace(current_definition, old_declaration, new_declaration);
  updated_definition := replace(updated_definition, old_resource_query, new_resource_query);
  updated_definition := replace(updated_definition, old_condition, new_condition);
  updated_definition := replace(updated_definition, old_metric, new_metric);

  if updated_definition = current_definition then
    raise exception 'System health resource burst definition was not changed.';
  end if;

  if position('resource_top_fingerprint_count' in updated_definition) = 0
     or position('resource_errors_15m >= 15 and resource_top_fingerprint_count >= 5' in updated_definition) = 0 then
    raise exception 'Resource burst corroboration was not applied completely.';
  end if;

  execute updated_definition;
end
$migration$;
