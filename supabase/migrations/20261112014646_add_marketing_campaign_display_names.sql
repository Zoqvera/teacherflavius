alter table private.marketing_campaign_aliases
  add column display_name text
    check (display_name is null or char_length(btrim(display_name)) between 1 and 120);

update private.marketing_campaign_aliases
set display_name = 'METASET50'
where meta_campaign_id = '120251622509920152';

create or replace view private.marketing_campaign_reporting
with (security_invoker = true)
as
with ad_totals as (
  select meta_ad_account_id, meta_campaign_id,
         (array_agg(meta_campaign_name order by report_date desc))[1] as meta_name,
         case when count(distinct currency) = 1 then min(currency) end as currency,
         case when count(distinct currency) = 1 then sum(spend) end as spend,
         sum(messaging_conversations_started) as conversations,
         min(report_date) as first_report_date,
         max(report_date) as last_report_date,
         max(imported_at) as imported_at
  from private.marketing_campaign_daily_metrics
  group by meta_ad_account_id, meta_campaign_id
), linked_payments as (
  select student.student_id, student.campaign_alias, tuition.amount_paid
  from private.marketing_campaign_students student
  join public.monthly_tuition tuition using (student_id)
  where tuition.amount_paid > 0
    and tuition.payment_date between student.enrollment_date
      and (now() at time zone 'America/Sao_Paulo')::date
  union all
  select student.student_id, student.campaign_alias, tuition.amount_paid
  from private.marketing_campaign_students student
  join public.administrative_weekly_tuition tuition using (student_id)
  where tuition.amount_paid > 0
    and tuition.payment_date between student.enrollment_date
      and (now() at time zone 'America/Sao_Paulo')::date
), paid_totals as (
  select campaign_alias, count(distinct student_id) as paying_students,
         sum(amount_paid) as received_revenue
  from linked_payments
  group by campaign_alias
), student_totals as (
  select campaign_alias, count(*) as linked_students,
         count(*) filter (where active) as active_students
  from private.marketing_campaign_students
  group by campaign_alias
)
select catalog.campaign_key, catalog.alias, catalog.meta_campaign_id, ads.meta_name,
       catalog.advertised_monthly_price, ads.currency, ads.spend, ads.conversations,
       ads.first_report_date, ads.last_report_date, ads.imported_at,
       case when catalog.alias is not null then coalesce(students.linked_students, 0) end as linked_students,
       case when catalog.alias is not null then coalesce(students.active_students, 0) end as active_students,
       case when catalog.alias is not null then coalesce(payments.paying_students, 0) end as paying_students,
       case when catalog.alias is not null then coalesce(payments.received_revenue, 0) end as received_revenue,
       round(ads.spend / nullif(ads.conversations, 0), 2) as cost_per_conversation,
       round(ads.spend / nullif(payments.paying_students, 0), 2) as cost_per_paying_student,
       labels.display_name
from private.marketing_campaign_catalog catalog
left join ad_totals ads using (meta_ad_account_id, meta_campaign_id)
left join student_totals students on students.campaign_alias = catalog.alias
left join paid_totals payments on payments.campaign_alias = catalog.alias
left join private.marketing_campaign_aliases labels on labels.alias = catalog.alias;
