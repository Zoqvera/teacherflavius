CREATE TABLE IF NOT EXISTS private.marketing_campaign_observations (
  observation_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  meta_ad_account_id text NOT NULL,
  meta_campaign_id text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  meta_campaign_name text NOT NULL,
  configured_status text,
  effective_status text,
  meta_created_at timestamptz,
  meta_started_at timestamptz,
  meta_scheduled_stop_at timestamptz,
  daily_budget_minor_units numeric,
  objective text,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  source text NOT NULL DEFAULT 'windsor_ai'
);
CREATE INDEX IF NOT EXISTS marketing_campaign_observations_latest_idx
  ON private.marketing_campaign_observations (meta_ad_account_id, meta_campaign_id, observed_at DESC, observation_id DESC);
ALTER TABLE private.marketing_campaign_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.marketing_campaign_observations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE private.marketing_campaign_observations_observation_id_seq FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE private.marketing_campaign_observations IS 'Snapshots of Meta campaign configuration and status seen through Windsor.ai; observed_at is ingestion/observation time, NOT the event time of campaign activation or pausing.';
COMMENT ON COLUMN private.marketing_campaign_observations.daily_budget_minor_units IS 'Daily budget in account currency minor units (e.g. BRL cents), as reported by Meta.';