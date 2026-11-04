-- Operational hotfix: preserve raw browser telemetry but exclude only the
-- optional OpenAI pixel SDK from actionable resource/fingerprint burst signals.
-- Run selectively; never replay the repository migration chain in production.
DO $patch$
DECLARE
  current_definition text;
  updated_definition text;
  old_declaration text := $fragment$
  resource_errors_15m integer := 0;
  resource_top_fingerprint_count integer := 0;
$fragment$;
  new_declaration text := $fragment$
  resource_errors_15m integer := 0;
  optional_openai_pixel_errors_15m integer := 0;
  resource_top_fingerprint_count integer := 0;
$fragment$;
  old_resource_predicate text := $fragment$
    and coalesce(e.source, '') not like 'https://static.cloudflareinsights.com/beacon.min.js/%';
$fragment$;
  new_resource_predicate text := $fragment$
    and coalesce(e.source, '') not like 'https://static.cloudflareinsights.com/beacon.min.js/%'
    and coalesce(e.source, '') <> 'https://bzrcdn.openai.com/sdk/oaiq.min.js';
$fragment$;
  old_resource_query text := $fragment$
  select count(*) into resource_errors_15m
$fragment$;
  new_resource_query text := $fragment$
  select count(*) into optional_openai_pixel_errors_15m
  from public.app_error_events e
  where e.created_at >= now() - interval '15 minutes'
    and e.event_type = 'resource'
    and e.source = 'https://bzrcdn.openai.com/sdk/oaiq.min.js';

  select count(*) into resource_errors_15m
$fragment$;
  old_top_filter text := $fragment$
    where e.created_at >= now() - interval '15 minutes'
      and nullif(e.fingerprint, '') is not null
    group by e.fingerprint
$fragment$;
  new_top_filter text := $fragment$
    where e.created_at >= now() - interval '15 minutes'
      and nullif(e.fingerprint, '') is not null
      and coalesce(e.source, '') <> 'https://bzrcdn.openai.com/sdk/oaiq.min.js'
    group by e.fingerprint
$fragment$;
  old_metrics text := $fragment$
    'resource_errors_15m', resource_errors_15m,
    'resource_top_fingerprint_count_15m', resource_top_fingerprint_count,
$fragment$;
  new_metrics text := $fragment$
    'resource_errors_15m', resource_errors_15m,
    'optional_openai_pixel_errors_15m', optional_openai_pixel_errors_15m,
    'resource_top_fingerprint_count_15m', resource_top_fingerprint_count,
$fragment$;
BEGIN
  SELECT pg_get_functiondef('private.run_system_health_check(boolean)'::regprocedure)
    INTO current_definition;

  IF current_definition IS NULL
     OR position('resource_errors_15m >= 15 and resource_top_fingerprint_count >= 5' in current_definition) = 0 THEN
    RAISE EXCEPTION 'Expected monitored health function definition not found';
  END IF;

  -- Fail closed if any source fragment differs from the reviewed definition.
  IF position(old_declaration in current_definition) = 0
     OR position(old_resource_query in current_definition) = 0
     OR position(old_top_filter in current_definition) = 0
     OR position(old_metrics in current_definition) = 0
     OR (length(current_definition) - length(replace(current_definition, old_resource_predicate, '')))
        / length(old_resource_predicate) <> 2 THEN
    RAISE EXCEPTION 'Health function changed: stop and review before applying patch';
  END IF;

  updated_definition := replace(current_definition, old_declaration, new_declaration);
  updated_definition := replace(updated_definition, old_resource_predicate, new_resource_predicate);
  updated_definition := replace(updated_definition, old_resource_query, new_resource_query);
  updated_definition := replace(updated_definition, old_top_filter, new_top_filter);
  updated_definition := replace(updated_definition, old_metrics, new_metrics);

  IF position('optional_openai_pixel_errors_15m' in updated_definition) = 0
     OR position(new_resource_predicate in updated_definition) = 0
     OR position(new_top_filter in updated_definition) = 0 THEN
    RAISE EXCEPTION 'Incomplete optional pixel resource monitoring patch';
  END IF;

  EXECUTE updated_definition;
END;
$patch$;
