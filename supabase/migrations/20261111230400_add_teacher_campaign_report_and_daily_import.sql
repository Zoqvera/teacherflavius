create view private.marketing_campaign_catalog
with (security_invoker = true)
as
select campaign.alias as campaign_key, campaign.alias,
       campaign.meta_ad_account_id, campaign.meta_campaign_id,
       campaign.advertised_monthly_price
from private.marketing_campaign_aliases campaign
union all
select distinct 'meta:' || metric.meta_ad_account_id || ':' || metric.meta_campaign_id,
       null::text, metric.meta_ad_account_id, metric.meta_campaign_id, null::numeric
from private.marketing_campaign_daily_metrics metric
where not exists (
  select 1 from private.marketing_campaign_aliases campaign
  where campaign.meta_ad_account_id = metric.meta_ad_account_id
    and campaign.meta_campaign_id = metric.meta_campaign_id
);

create view private.marketing_campaign_students
with (security_invoker = true)
as
select link.campaign_alias, profile.id as student_id,
       coalesce(nullif(btrim(profile.name), ''), 'Aluno sem nome') as student_name,
       (profile.enrolled_at at time zone 'America/Sao_Paulo')::date as enrollment_date,
       profile.enrolled is true and profile.archived is false as active,
       link.evidence
from private.marketing_campaign_student_links link
join public.profiles profile on profile.id = link.student_id;

create view private.marketing_campaign_reporting
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
       round(ads.spend / nullif(payments.paying_students, 0), 2) as cost_per_paying_student
from private.marketing_campaign_catalog catalog
left join ad_totals ads using (meta_ad_account_id, meta_campaign_id)
left join student_totals students on students.campaign_alias = catalog.alias
left join paid_totals payments on payments.campaign_alias = catalog.alias;

create function public.get_teacher_campaign_report(p_campaign_key text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  campaign private.marketing_campaign_catalog%rowtype;
begin
  if not public.is_teacher_admin() then
    raise exception 'Acesso administrativo do professor obrigatório.' using errcode = '42501';
  end if;

  if p_campaign_key is null then
    return (
      select coalesce(jsonb_agg(to_jsonb(report) order by (report.alias is null),
               report.first_report_date nulls last, report.campaign_key), '[]'::jsonb)
      from private.marketing_campaign_reporting report
    );
  end if;

  select * into strict campaign
  from private.marketing_campaign_catalog catalog
  where catalog.campaign_key = p_campaign_key;

  return jsonb_build_object(
    'students', (
      select coalesce(jsonb_agg(to_jsonb(student) - 'student_id' - 'campaign_alias'
                 order by student.enrollment_date desc nulls last, student.student_name), '[]'::jsonb)
      from private.marketing_campaign_students student
      where student.campaign_alias = campaign.alias
    ),
    'days', (
      select coalesce(jsonb_agg(to_jsonb(metric) - 'meta_ad_account_id' - 'meta_campaign_id'
                 - 'meta_campaign_name' - 'imported_at' order by metric.report_date desc), '[]'::jsonb)
      from private.marketing_campaign_daily_metrics metric
      where metric.meta_ad_account_id = campaign.meta_ad_account_id
        and metric.meta_campaign_id = campaign.meta_campaign_id
    )
  );
end;
$function$;

create function private.import_marketing_campaign_daily_metrics(
  p_meta_ad_account_id text,
  p_rows jsonb
)
returns integer
language plpgsql
set search_path = ''
as $function$
declare
  affected_rows integer;
begin
  if p_meta_ad_account_id is null or p_meta_ad_account_id !~ '^[0-9]+$'
     or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Conta ou lote de campanhas inválido.' using errcode = '22023';
  end if;

  if jsonb_array_length(p_rows) not between 1 and 2000 then
    raise exception 'O lote deve conter entre 1 e 2000 registros.' using errcode = '22023';
  end if;

  insert into private.marketing_campaign_daily_metrics
    (meta_ad_account_id, meta_campaign_id, report_date, meta_campaign_name,
     currency, spend, impressions, clicks, messaging_conversations_started)
  select p_meta_ad_account_id, metric.campaign_id, metric.date, metric.campaign,
         metric.account_currency, metric.spend, metric.impressions, metric.clicks,
         metric.actions_onsite_conversion_messaging_conversation_started_7d
  from jsonb_to_recordset(p_rows) as metric(
    campaign_id text, date date, campaign text, account_currency text, spend numeric,
    impressions bigint, clicks bigint, actions_onsite_conversion_messaging_conversation_started_7d bigint
  )
  on conflict (meta_ad_account_id, meta_campaign_id, report_date) do update
    set meta_campaign_name = excluded.meta_campaign_name,
        currency = excluded.currency,
        spend = excluded.spend,
        impressions = excluded.impressions,
        clicks = excluded.clicks,
        messaging_conversations_started = excluded.messaging_conversations_started,
        imported_at = excluded.imported_at;

  get diagnostics affected_rows = row_count;
  return affected_rows;
end;
$function$;

revoke all on private.marketing_campaign_catalog, private.marketing_campaign_students,
  private.marketing_campaign_reporting from public, anon, authenticated;
grant select on private.marketing_campaign_catalog, private.marketing_campaign_students,
  private.marketing_campaign_reporting to service_role;

revoke all on function public.get_teacher_campaign_report(text) from public, anon, authenticated;
grant execute on function public.get_teacher_campaign_report(text) to authenticated;

revoke all on function private.import_marketing_campaign_daily_metrics(text, jsonb)
  from public, anon, authenticated;
grant execute on function private.import_marketing_campaign_daily_metrics(text, jsonb) to service_role;
