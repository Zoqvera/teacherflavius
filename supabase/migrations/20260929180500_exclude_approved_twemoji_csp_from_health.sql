do $migration$
declare
  current_definition text;
  updated_definition text;
  old_filter text := $fragment$
  select count(*) into csp_actionable_15m
  from public.csp_violation_reports c
  where c.created_at >= now() - interval '15 minutes'
    and coalesce(c.blocked_uri, '') not like 'https://static.cloudflareinsights.com/%'
    and coalesce(c.blocked_uri, '') not like 'https://bzrcdn.openai.com/%'
    and coalesce(c.blocked_uri, '') not like 'https://bzr.openai.com/%';
$fragment$;
  new_filter text := $fragment$
  select count(*) into csp_actionable_15m
  from public.csp_violation_reports c
  where c.created_at >= now() - interval '15 minutes'
    and coalesce(c.blocked_uri, '') not like 'https://static.cloudflareinsights.com/%'
    and coalesce(c.blocked_uri, '') not like 'https://bzrcdn.openai.com/%'
    and coalesce(c.blocked_uri, '') not like 'https://bzr.openai.com/%'
    and coalesce(c.blocked_uri, '') not like 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.3/assets/svg/%';
$fragment$;
begin
  select pg_get_functiondef('private.run_system_health_check(boolean)'::regprocedure)
  into current_definition;

  updated_definition := replace(current_definition, old_filter, new_filter);

  if updated_definition = current_definition then
    raise exception 'CSP actionable filter was not updated for the approved Twemoji SVG source.';
  end if;

  execute updated_definition;
end
$migration$;
