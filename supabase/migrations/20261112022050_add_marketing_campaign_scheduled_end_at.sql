alter table private.marketing_campaign_aliases add column scheduled_end_at timestamptz;
comment on column private.marketing_campaign_aliases.scheduled_end_at is 'Campaign end time scheduled in Meta Ads.';
