-- Recovery overlay for CSP health aggregation.

-- Aggregate repeated CSP reports into logical groups for health alerting.
-- Raw reports remain stored for audit; health degradation uses unique
-- document + directive + blocked-origin groups within the 15-minute window.

do $migration$
declare
  current_definition text;
  updated_definition text;
  old_declaration text := $fragment$
  csp_total_15m integer := 0;
  csp_actionable_15m integer := 0;
  probe_failed_count integer := 0;
$fragment$;
  new_declaration text := $fragment$
  csp_total_15m integer := 0;
  csp_actionable_15m integer := 0;
  csp_actionable_raw_15m integer := 0;
  csp_top_group_count_15m integer := 0;
  csp_top_group_origin text;
  probe_failed_count integer := 0;
$fragment$;
  old_query text := $fragment$
  select count(*) into csp_actionable_15m
  from public.csp_violation_reports c
  where c.created_at >= now() - interval '15 minutes'
    and coalesce(c.blocked_uri, '') not like 'https://static.cloudflareinsights.com/%'
    and coalesce(c.blocked_uri, '') not like 'https://bzrcdn.openai.com/%'
    and coalesce(c.blocked_uri, '') not like 'https://bzr.openai.com/%'
    and coalesce(c.blocked_uri, '') not like 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.3/assets/svg/%';
$fragment$;
  new_query text := $fragment$
  with actionable_csp as (
    select
      coalesce(c.document_uri, '') as document_uri,
      coalesce(c.effective_directive, c.violated_directive, '') as directive,
      case
        when coalesce(c.blocked_uri, '') ~ '^https?://'
          then lower(split_part(c.blocked_uri, '/', 3))
        else lower(coalesce(c.blocked_uri, ''))
      end as blocked_origin
    from public.csp_violation_reports c
    where c.created_at >= now() - interval '15 minutes'
      and coalesce(c.blocked_uri, '') not like 'https://static.cloudflareinsights.com/%'
      and coalesce(c.blocked_uri, '') not like 'https://bzrcdn.openai.com/%'
      and coalesce(c.blocked_uri, '') not like 'https://bzr.openai.com/%'
      and coalesce(c.blocked_uri, '') not like 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.3/assets/svg/%'
  ), csp_groups as (
    select
      document_uri,
      directive,
      blocked_origin,
      count(*)::integer as events
    from actionable_csp
    group by document_uri, directive, blocked_origin
  )
  select
    (select count(*)::integer from actionable_csp),
    count(*)::integer,
    coalesce(max(events), 0)::integer,
    (array_agg(blocked_origin order by events desc, blocked_origin))[1]
  into
    csp_actionable_raw_15m,
    csp_actionable_15m,
    csp_top_group_count_15m,
    csp_top_group_origin
  from csp_groups;
$fragment$;
  old_issue text := $fragment$
      jsonb_build_object('count_15m', csp_actionable_15m, 'total_count_15m', csp_total_15m)
$fragment$;
  new_issue text := $fragment$
      jsonb_build_object(
        'count_15m', csp_actionable_15m,
        'logical_group_count_15m', csp_actionable_15m,
        'raw_event_count_15m', csp_actionable_raw_15m,
        'total_count_15m', csp_total_15m,
        'top_group_event_count_15m', csp_top_group_count_15m,
        'top_group_origin', csp_top_group_origin
      )
$fragment$;
  old_metrics text := $fragment$
    'csp_total_15m', csp_total_15m,
    'csp_actionable_15m', csp_actionable_15m,
    'synthetic_failed_targets', probe_failed_count,
$fragment$;
  new_metrics text := $fragment$
    'csp_total_15m', csp_total_15m,
    'csp_actionable_15m', csp_actionable_15m,
    'csp_actionable_raw_15m', csp_actionable_raw_15m,
    'csp_top_group_count_15m', csp_top_group_count_15m,
    'csp_top_group_origin', csp_top_group_origin,
    'synthetic_failed_targets', probe_failed_count,
$fragment$;
begin
  if to_regprocedure('private.run_system_health_check(boolean)') is null then
    raise notice 'Skipping CSP health aggregation overlay because private.run_system_health_check(boolean) is not present in this recovery baseline.';
    return;
  end if;

  select pg_get_functiondef(to_regprocedure('private.run_system_health_check(boolean)'))
  into current_definition;

  if position(old_declaration in current_definition) = 0 then
    raise exception 'CSP health declaration fragment was not found';
  end if;
  updated_definition := replace(current_definition, old_declaration, new_declaration);

  if position(old_query in updated_definition) = 0 then
    raise exception 'CSP actionable query fragment was not found';
  end if;
  updated_definition := replace(updated_definition, old_query, new_query);

  if position(old_issue in updated_definition) = 0 then
    raise exception 'CSP alert detail fragment was not found';
  end if;
  updated_definition := replace(updated_definition, old_issue, new_issue);

  if position(old_metrics in updated_definition) = 0 then
    raise exception 'CSP metrics fragment was not found';
  end if;
  updated_definition := replace(updated_definition, old_metrics, new_metrics);

  execute updated_definition;
end;
$migration$;
