create table if not exists public.marketing_acquisition_events (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique,
  event_name text not null check (event_name in ('page_view', 'generate_lead')),
  visitor_id uuid not null,
  session_id uuid not null,
  source text not null default 'direct',
  medium text not null default 'none',
  campaign text not null default 'not_set',
  traffic_channel text not null default 'direct',
  ai_assistant text,
  page_path text not null default '/',
  landing_page text not null default '/',
  link_position text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.marketing_acquisition_events enable row level security;
revoke all on table public.marketing_acquisition_events from public, anon, authenticated;
grant select, insert, delete on table public.marketing_acquisition_events to service_role;

create index if not exists marketing_acquisition_events_occurred_at_idx
  on public.marketing_acquisition_events (occurred_at desc);
create index if not exists marketing_acquisition_events_event_name_idx
  on public.marketing_acquisition_events (event_name, occurred_at desc);
create index if not exists marketing_acquisition_events_source_idx
  on public.marketing_acquisition_events (source, occurred_at desc);
create index if not exists marketing_acquisition_events_ai_assistant_idx
  on public.marketing_acquisition_events (ai_assistant, occurred_at desc)
  where ai_assistant is not null;

create or replace function public.get_teacher_acquisition_summary(period_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requester_email text;
  bounded_days integer;
  result jsonb;
begin
  requester_email := auth.jwt() ->> 'email';
  if requester_email is null or not exists (
    select 1
    from public.teacher_admins ta
    where lower(ta.email) = lower(requester_email)
  ) then
    raise exception 'Acesso negado: usuário não cadastrado como professor.' using errcode = '42501';
  end if;

  bounded_days := greatest(1, least(coalesce(period_days, 30), 365));

  with base as (
    select *
    from public.marketing_acquisition_events
    where occurred_at >= now() - make_interval(days => bounded_days)
  ),
  overview as (
    select
      count(distinct visitor_id) filter (where event_name = 'page_view') as visitors,
      count(distinct visitor_id) filter (where event_name = 'generate_lead') as leads,
      count(distinct visitor_id) filter (where event_name = 'page_view' and ai_assistant = 'chatgpt') as chatgpt_visitors,
      count(distinct visitor_id) filter (where event_name = 'generate_lead' and ai_assistant = 'chatgpt') as chatgpt_leads
    from base
  ),
  source_stats as (
    select
      coalesce(nullif(source, ''), 'direct') as source_name,
      count(distinct visitor_id) filter (where event_name = 'page_view') as visitors,
      count(distinct visitor_id) filter (where event_name = 'generate_lead') as leads
    from base
    group by coalesce(nullif(source, ''), 'direct')
  ),
  ai_stats as (
    select
      ai_assistant as assistant,
      count(distinct visitor_id) filter (where event_name = 'page_view') as visitors,
      count(distinct visitor_id) filter (where event_name = 'generate_lead') as leads
    from base
    where ai_assistant is not null and ai_assistant <> '' and ai_assistant <> 'not_set'
    group by ai_assistant
  ),
  cta_stats as (
    select
      coalesce(nullif(link_position, ''), 'unknown') as position,
      count(distinct visitor_id) as leads
    from base
    where event_name = 'generate_lead'
    group by coalesce(nullif(link_position, ''), 'unknown')
  ),
  daily_stats as (
    select
      (occurred_at at time zone 'America/Sao_Paulo')::date as day,
      count(distinct visitor_id) filter (where event_name = 'page_view') as visitors,
      count(distinct visitor_id) filter (where event_name = 'generate_lead') as leads
    from base
    group by (occurred_at at time zone 'America/Sao_Paulo')::date
  )
  select jsonb_build_object(
    'period_days', bounded_days,
    'visitors', coalesce(o.visitors, 0),
    'leads', coalesce(o.leads, 0),
    'conversion_rate', case when coalesce(o.visitors, 0) = 0 then 0 else round((o.leads::numeric * 100) / o.visitors, 1) end,
    'chatgpt_visitors', coalesce(o.chatgpt_visitors, 0),
    'chatgpt_leads', coalesce(o.chatgpt_leads, 0),
    'chatgpt_conversion_rate', case when coalesce(o.chatgpt_visitors, 0) = 0 then 0 else round((o.chatgpt_leads::numeric * 100) / o.chatgpt_visitors, 1) end,
    'channels', coalesce((
      select jsonb_agg(jsonb_build_object(
        'source', s.source_name,
        'visitors', s.visitors,
        'leads', s.leads,
        'conversion_rate', case when s.visitors = 0 then 0 else round((s.leads::numeric * 100) / s.visitors, 1) end
      ) order by s.visitors desc, s.leads desc, s.source_name)
      from source_stats s
    ), '[]'::jsonb),
    'ai_assistants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'assistant', a.assistant,
        'visitors', a.visitors,
        'leads', a.leads,
        'conversion_rate', case when a.visitors = 0 then 0 else round((a.leads::numeric * 100) / a.visitors, 1) end
      ) order by a.visitors desc, a.leads desc, a.assistant)
      from ai_stats a
    ), '[]'::jsonb),
    'cta_positions', coalesce((
      select jsonb_agg(jsonb_build_object('position', c.position, 'leads', c.leads) order by c.leads desc, c.position)
      from cta_stats c
    ), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('date', d.day, 'visitors', d.visitors, 'leads', d.leads) order by d.day)
      from daily_stats d
    ), '[]'::jsonb)
  ) into result
  from overview o;

  return coalesce(result, jsonb_build_object(
    'period_days', bounded_days,
    'visitors', 0,
    'leads', 0,
    'conversion_rate', 0,
    'chatgpt_visitors', 0,
    'chatgpt_leads', 0,
    'chatgpt_conversion_rate', 0,
    'channels', '[]'::jsonb,
    'ai_assistants', '[]'::jsonb,
    'cta_positions', '[]'::jsonb,
    'daily', '[]'::jsonb
  ));
end;
$$;

revoke all on function public.get_teacher_acquisition_summary(integer) from public, anon;
grant execute on function public.get_teacher_acquisition_summary(integer) to authenticated;
