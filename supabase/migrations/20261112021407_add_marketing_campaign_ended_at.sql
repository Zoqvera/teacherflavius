alter table private.marketing_campaign_aliases
  add column ended_at timestamptz;

comment on column private.marketing_campaign_aliases.ended_at is
  'Actual campaign end timestamp, when confirmed.';
