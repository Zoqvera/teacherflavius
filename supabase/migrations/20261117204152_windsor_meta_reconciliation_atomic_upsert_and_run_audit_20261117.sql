
CREATE TABLE IF NOT EXISTS private.marketing_campaign_reconciliation_runs (
  run_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  completed_at timestamptz NOT NULL DEFAULT now(),
  meta_ad_account_id text NOT NULL,
  campaign_rows_received integer NOT NULL,
  daily_rows_received integer NOT NULL,
  aliases_created integer NOT NULL,
  aliases_enriched integer NOT NULL,
  daily_rows_written integer NOT NULL,
  campaign_observations_created integer NOT NULL,
  status_changes_detected integer NOT NULL,
  source text NOT NULL DEFAULT 'windsor_ai_mcp'
);
ALTER TABLE private.marketing_campaign_reconciliation_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.marketing_campaign_reconciliation_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE private.marketing_campaign_reconciliation_runs_run_id_seq FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE private.marketing_campaign_reconciliation_runs IS 'Durable execution log for idempotent Windsor.ai -> Supabase Meta Ads reconciliation.';

CREATE OR REPLACE FUNCTION private.reconcile_windsor_meta_campaigns(
  p_campaigns jsonb,
  p_daily_metrics jsonb,
  p_ad_account_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_campaign_count integer;
  v_daily_count integer;
  v_aliases_created integer := 0;
  v_aliases_enriched integer := 0;
  v_daily_written integer := 0;
  v_observations_created integer := 0;
  v_status_changes integer := 0;
  v_run_id bigint;
BEGIN
  IF p_ad_account_id <> '804801286733503' THEN
    RAISE EXCEPTION 'Unexpected Meta account ID';
  END IF;
  IF p_campaigns IS NULL OR pg_catalog.jsonb_typeof(p_campaigns) <> 'array'
     OR p_daily_metrics IS NULL OR pg_catalog.jsonb_typeof(p_daily_metrics) <> 'array' THEN
    RAISE EXCEPTION 'Both input arguments must be JSON arrays';
  END IF;

  v_campaign_count := pg_catalog.jsonb_array_length(p_campaigns);
  v_daily_count := pg_catalog.jsonb_array_length(p_daily_metrics);
  IF v_campaign_count = 0 THEN
    RAISE EXCEPTION 'Empty campaign batch: synchronization aborted';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_to_recordset(p_campaigns)
      AS c(campaign_id text, campaign text, account_currency text)
    WHERE c.campaign_id IS NULL OR c.campaign_id !~ '^[0-9]{10,25}$'
       OR c.campaign IS NULL OR pg_catalog.btrim(c.campaign) = ''
       OR c.account_currency IS NULL OR c.account_currency !~ '^[A-Z]{3}$'
  ) THEN
    RAISE EXCEPTION 'Invalid campaign record';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_to_recordset(p_daily_metrics)
      AS d(campaign_id text, campaign text, date date,
           spend numeric, impressions bigint, clicks bigint,
           actions_onsite_conversion_messaging_conversation_started_7d bigint,
           account_currency text)
    WHERE d.campaign_id IS NULL OR d.campaign_id !~ '^[0-9]{10,25}$'
      OR d.campaign IS NULL OR pg_catalog.btrim(d.campaign) = ''
      OR d.date IS NULL OR d.date > (now() AT TIME ZONE 'America/Sao_Paulo')::date
      OR d.spend IS NULL OR d.spend < 0
      OR d.impressions IS NULL OR d.impressions < 0
      OR d.clicks IS NULL OR d.clicks < 0
      OR d.actions_onsite_conversion_messaging_conversation_started_7d < 0
      OR d.account_currency IS NULL OR d.account_currency !~ '^[A-Z]{3}$'
  ) THEN
    RAISE EXCEPTION 'Invalid daily metric record';
  END IF;
  IF (SELECT count(DISTINCT campaign_id) FROM pg_catalog.jsonb_to_recordset(p_campaigns) AS c(campaign_id text))
       <> v_campaign_count THEN
    RAISE EXCEPTION 'Duplicate campaign identifiers';
  END IF;
  IF (SELECT count(*) FROM (
    SELECT d.campaign_id,d.date FROM pg_catalog.jsonb_to_recordset(p_daily_metrics)
      AS d(campaign_id text, date date)
    GROUP BY d.campaign_id,d.date HAVING count(*) > 1
  ) duplicates) > 0 THEN
    RAISE EXCEPTION 'Duplicate campaign/day metric records';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('teacherflavius_windsor_meta_reconciliation')::bigint);

  INSERT INTO private.marketing_campaign_aliases
    (alias,meta_campaign_id,meta_ad_account_id,started_at,scheduled_end_at,display_name)
  SELECT 'meta_' || c.campaign_id,
         c.campaign_id,
         p_ad_account_id,
         c.campaign_start_time,
         c.campaign_stop_time,
         'META ' || pg_catalog.to_char(
           (COALESCE(c.campaign_created_time,c.campaign_start_time) AT TIME ZONE 'America/Sao_Paulo')::date,
           'YYYY-MM-DD'
         ) || ' · Sem preço confirmado · #' || pg_catalog.right(c.campaign_id,11)
  FROM pg_catalog.jsonb_to_recordset(p_campaigns)
       AS c(campaign_id text, campaign_created_time timestamptz,
            campaign_start_time timestamptz, campaign_stop_time timestamptz)
  WHERE COALESCE(c.campaign_created_time,c.campaign_start_time) IS NOT NULL
  ON CONFLICT(meta_campaign_id) DO NOTHING;
  GET DIAGNOSTICS v_aliases_created = ROW_COUNT;

  UPDATE private.marketing_campaign_aliases a
  SET started_at = COALESCE(a.started_at, c.campaign_start_time),
      scheduled_end_at = COALESCE(a.scheduled_end_at, c.campaign_stop_time)
  FROM pg_catalog.jsonb_to_recordset(p_campaigns)
       AS c(campaign_id text,campaign_start_time timestamptz,campaign_stop_time timestamptz)
  WHERE a.meta_campaign_id = c.campaign_id
    AND a.meta_ad_account_id = p_ad_account_id
    AND ((a.started_at IS NULL AND c.campaign_start_time IS NOT NULL)
      OR (a.scheduled_end_at IS NULL AND c.campaign_stop_time IS NOT NULL));
  GET DIAGNOSTICS v_aliases_enriched = ROW_COUNT;

  INSERT INTO private.marketing_campaign_daily_metrics
    (meta_ad_account_id,meta_campaign_id,report_date,meta_campaign_name,
     currency,spend,impressions,clicks,messaging_conversations_started,imported_at)
  SELECT p_ad_account_id,d.campaign_id,d.date,d.campaign,
         d.account_currency,d.spend,d.impressions,d.clicks,
         d.actions_onsite_conversion_messaging_conversation_started_7d,now()
  FROM pg_catalog.jsonb_to_recordset(p_daily_metrics)
       AS d(campaign_id text,campaign text,date date,account_currency text,
            spend numeric,impressions bigint,clicks bigint,
            actions_onsite_conversion_messaging_conversation_started_7d bigint)
  ON CONFLICT(meta_ad_account_id,meta_campaign_id,report_date) DO UPDATE SET
    meta_campaign_name=EXCLUDED.meta_campaign_name,
    currency=EXCLUDED.currency,
    spend=EXCLUDED.spend,
    impressions=EXCLUDED.impressions,
    clicks=EXCLUDED.clicks,
    messaging_conversations_started=EXCLUDED.messaging_conversations_started,
    imported_at=now()
  WHERE (marketing_campaign_daily_metrics.meta_campaign_name,
         marketing_campaign_daily_metrics.currency,
         marketing_campaign_daily_metrics.spend,
         marketing_campaign_daily_metrics.impressions,
         marketing_campaign_daily_metrics.clicks,
         marketing_campaign_daily_metrics.messaging_conversations_started)
    IS DISTINCT FROM
        (EXCLUDED.meta_campaign_name, EXCLUDED.currency, EXCLUDED.spend,
         EXCLUDED.impressions, EXCLUDED.clicks, EXCLUDED.messaging_conversations_started);
  GET DIAGNOSTICS v_daily_written = ROW_COUNT;

  SELECT count(*) INTO v_status_changes
  FROM pg_catalog.jsonb_to_recordset(p_campaigns)
       AS c(campaign_id text, campaign_configured_status text, campaign_effective_status text)
  LEFT JOIN LATERAL (
    SELECT o.observation_id,o.configured_status,o.effective_status
    FROM private.marketing_campaign_observations o
    WHERE o.meta_ad_account_id=p_ad_account_id AND o.meta_campaign_id=c.campaign_id
    ORDER BY o.observed_at DESC,o.observation_id DESC LIMIT 1
  ) previous ON true
  WHERE previous.observation_id IS NOT NULL
    AND (previous.configured_status,previous.effective_status)
       IS DISTINCT FROM (c.campaign_configured_status,c.campaign_effective_status);

  INSERT INTO private.marketing_campaign_observations
    (meta_ad_account_id,meta_campaign_id,meta_campaign_name,
     configured_status,effective_status,meta_created_at,meta_started_at,
     meta_scheduled_stop_at,daily_budget_minor_units,objective,currency)
  SELECT p_ad_account_id,c.campaign_id,c.campaign,
         c.campaign_configured_status,c.campaign_effective_status,
         c.campaign_created_time,c.campaign_start_time,c.campaign_stop_time,
         c.campaign_daily_budget,c.campaign_objective,c.account_currency
  FROM pg_catalog.jsonb_to_recordset(p_campaigns)
       AS c(campaign_id text,campaign text,
            campaign_configured_status text,campaign_effective_status text,
            campaign_created_time timestamptz,campaign_start_time timestamptz,
            campaign_stop_time timestamptz,campaign_daily_budget numeric,
            campaign_objective text,account_currency text)
  LEFT JOIN LATERAL (
    SELECT o.* FROM private.marketing_campaign_observations o
    WHERE o.meta_ad_account_id=p_ad_account_id AND o.meta_campaign_id=c.campaign_id
    ORDER BY o.observed_at DESC,o.observation_id DESC LIMIT 1
  ) previous ON true
  WHERE previous.observation_id IS NULL
     OR (previous.meta_campaign_name,previous.configured_status,previous.effective_status,
         previous.meta_created_at,previous.meta_started_at,previous.meta_scheduled_stop_at,
         previous.daily_budget_minor_units,previous.objective,previous.currency)
        IS DISTINCT FROM
        (c.campaign,c.campaign_configured_status,c.campaign_effective_status,
         c.campaign_created_time,c.campaign_start_time,c.campaign_stop_time,
         c.campaign_daily_budget,c.campaign_objective,c.account_currency);
  GET DIAGNOSTICS v_observations_created = ROW_COUNT;

  INSERT INTO private.marketing_campaign_reconciliation_runs
    (meta_ad_account_id,campaign_rows_received,daily_rows_received,
     aliases_created,aliases_enriched,daily_rows_written,
     campaign_observations_created,status_changes_detected)
  VALUES
    (p_ad_account_id,v_campaign_count,v_daily_count,v_aliases_created,
     v_aliases_enriched,v_daily_written,v_observations_created,v_status_changes)
  RETURNING run_id INTO v_run_id;

  RETURN pg_catalog.jsonb_build_object(
    'run_id',v_run_id,
    'campaigns_received',v_campaign_count,
    'metrics_received',v_daily_count,
    'aliases_created',v_aliases_created,
    'aliases_enriched',v_aliases_enriched,
    'daily_rows_written',v_daily_written,
    'campaign_observations_created',v_observations_created,
    'status_changes_detected',v_status_changes
  );
END
$function$;
REVOKE ALL ON FUNCTION private.reconcile_windsor_meta_campaigns(jsonb,jsonb,text) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION private.reconcile_windsor_meta_campaigns(jsonb,jsonb,text) IS 'Idempotently reconciles Windsor.ai Meta campaign metadata, daily metrics, and status observations for account 804801286733503. Transactional, validates input, preserves canonical student attribution and manual campaign aliases.';