alter table private.marketing_campaign_aliases
  alter column meta_campaign_id drop not null,
  alter column meta_ad_account_id drop not null,
  alter column started_at drop not null,
  add column declared_source text unique,
  add column advertised_monthly_price numeric(12, 2)
    check (advertised_monthly_price >= 0),
  add constraint marketing_campaign_meta_identity_complete
    check ((meta_campaign_id is null) = (meta_ad_account_id is null));

create table private.marketing_campaign_daily_metrics (
  meta_ad_account_id text not null,
  meta_campaign_id text not null,
  report_date date not null,
  meta_campaign_name text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  spend numeric(14, 2) not null check (spend >= 0),
  impressions bigint not null check (impressions >= 0),
  clicks bigint not null check (clicks >= 0),
  messaging_conversations_started bigint check (messaging_conversations_started >= 0),
  imported_at timestamptz not null default now(),
  primary key (meta_ad_account_id, meta_campaign_id, report_date)
);

create table private.marketing_campaign_confirmed_students (
  student_id uuid primary key references public.profiles (id) on delete cascade,
  campaign_alias text not null references private.marketing_campaign_aliases (alias),
  evidence text not null check (length(btrim(evidence)) > 0),
  linked_at timestamptz not null default now()
);

create index marketing_campaign_confirmed_students_alias_idx
  on private.marketing_campaign_confirmed_students (campaign_alias);

alter table private.marketing_campaign_daily_metrics enable row level security;
alter table private.marketing_campaign_confirmed_students enable row level security;

revoke all on private.marketing_campaign_daily_metrics,
  private.marketing_campaign_confirmed_students from public, anon, authenticated;

grant select, insert, update on private.marketing_campaign_aliases,
  private.marketing_campaign_daily_metrics,
  private.marketing_campaign_confirmed_students to service_role;

-- Prefer a confirmed attribution over a campaign code declared at enrollment.
create view private.marketing_campaign_student_links
with (security_invoker = true)
as
select confirmed.student_id, confirmed.campaign_alias, confirmed.evidence
from private.marketing_campaign_confirmed_students confirmed
union all
select acquisition.student_id, campaign.alias, 'declared_source'::text
from private.student_acquisition acquisition
join private.marketing_campaign_aliases campaign
  on campaign.declared_source = acquisition.declared_source
where not exists (
  select 1
  from private.marketing_campaign_confirmed_students confirmed
  where confirmed.student_id = acquisition.student_id
);

revoke all on private.marketing_campaign_student_links from public, anon, authenticated;
grant select on private.marketing_campaign_student_links to service_role;
