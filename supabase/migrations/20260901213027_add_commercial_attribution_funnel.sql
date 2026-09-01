create table if not exists public.marketing_commercial_leads (
  id uuid primary key default gen_random_uuid(),
  source_event_id uuid not null unique,
  visitor_id uuid not null,
  session_id uuid not null,
  source text not null default 'direct',
  medium text not null default 'none',
  campaign text not null default 'not_set',
  traffic_channel text not null default 'direct',
  ai_assistant text,
  landing_page text not null default '/',
  link_position text,
  lead_event_at timestamptz not null,
  confirmed_at timestamptz not null default now(),
  student_id uuid references public.profiles(id) on delete set null,
  enrolled_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.marketing_commercial_leads enable row level security;
revoke all on table public.marketing_commercial_leads from public, anon, authenticated;
grant select, insert, update, delete on table public.marketing_commercial_leads to service_role;

create index if not exists marketing_commercial_leads_event_at_idx
  on public.marketing_commercial_leads (lead_event_at desc);
create index if not exists marketing_commercial_leads_source_idx
  on public.marketing_commercial_leads (source, lead_event_at desc);
create unique index if not exists marketing_commercial_leads_student_unique_idx
  on public.marketing_commercial_leads (student_id)
  where student_id is not null;

create policy deny_direct_marketing_commercial_leads_access
on public.marketing_commercial_leads
for all
to anon, authenticated
using (false)
with check (false);

create or replace function public.confirm_teacher_marketing_lead(p_event_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requester_email text;
  requester_id uuid;
  lead_id uuid;
begin
  requester_email := auth.jwt() ->> 'email';
  requester_id := auth.uid();
  if requester_email is null or not exists (
    select 1 from public.teacher_admins ta where lower(ta.email) = lower(requester_email)
  ) then
    raise exception 'Acesso negado: usuário não cadastrado como professor.' using errcode = '42501';
  end if;

  insert into public.marketing_commercial_leads (
    source_event_id, visitor_id, session_id, source, medium, campaign,
    traffic_channel, ai_assistant, landing_page, link_position,
    lead_event_at, confirmed_at, created_by
  )
  select
    e.event_id, e.visitor_id, e.session_id,
    coalesce(nullif(e.source, ''), 'direct'),
    coalesce(nullif(e.medium, ''), 'none'),
    coalesce(nullif(e.campaign, ''), 'not_set'),
    coalesce(nullif(e.traffic_channel, ''), 'direct'),
    nullif(e.ai_assistant, ''),
    coalesce(nullif(e.landing_page, ''), '/'),
    nullif(e.link_position, ''),
    e.occurred_at, now(), requester_id
  from public.marketing_acquisition_events e
  where e.event_id = p_event_id and e.event_name = 'generate_lead'
  on conflict (source_event_id) do update
    set updated_at = now()
  returning id into lead_id;

  if lead_id is null then
    raise exception 'Clique de WhatsApp não encontrado.' using errcode = 'P0002';
  end if;

  return lead_id;
end;
$$;

create or replace function public.unconfirm_teacher_marketing_lead(p_lead_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requester_email text;
  affected integer;
begin
  requester_email := auth.jwt() ->> 'email';
  if requester_email is null or not exists (
    select 1 from public.teacher_admins ta where lower(ta.email) = lower(requester_email)
  ) then
    raise exception 'Acesso negado: usuário não cadastrado como professor.' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.marketing_commercial_leads l
    where l.id = p_lead_id and l.student_id is not null
  ) then
    raise exception 'Desvincule a matrícula antes de desfazer a confirmação.' using errcode = '23514';
  end if;

  delete from public.marketing_commercial_leads where id = p_lead_id;
  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

create or replace function public.link_teacher_marketing_lead_student(p_lead_id uuid, p_student_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requester_email text;
  student_created_at timestamptz;
  result_id uuid;
begin
  requester_email := auth.jwt() ->> 'email';
  if requester_email is null or not exists (
    select 1 from public.teacher_admins ta where lower(ta.email) = lower(requester_email)
  ) then
    raise exception 'Acesso negado: usuário não cadastrado como professor.' using errcode = '42501';
  end if;

  select p.created_at into student_created_at
  from public.profiles p
  where p.id = p_student_id
    and coalesce(p.enrolled, false) = true
    and coalesce(p.archived, false) = false;

  if not found then
    raise exception 'Aluno ativo e matriculado não encontrado.' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.marketing_commercial_leads other
    where other.student_id = p_student_id and other.id <> p_lead_id
  ) then
    raise exception 'Este aluno já está vinculado a outra origem de aquisição.' using errcode = '23505';
  end if;

  update public.marketing_commercial_leads
  set student_id = p_student_id,
      enrolled_at = coalesce(student_created_at, now()),
      updated_at = now()
  where id = p_lead_id
  returning id into result_id;

  if result_id is null then
    raise exception 'Lead comercial não encontrado.' using errcode = 'P0002';
  end if;

  return result_id;
end;
$$;

create or replace function public.unlink_teacher_marketing_lead_student(p_lead_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requester_email text;
  affected integer;
begin
  requester_email := auth.jwt() ->> 'email';
  if requester_email is null or not exists (
    select 1 from public.teacher_admins ta where lower(ta.email) = lower(requester_email)
  ) then
    raise exception 'Acesso negado: usuário não cadastrado como professor.' using errcode = '42501';
  end if;

  update public.marketing_commercial_leads
  set student_id = null, enrolled_at = null, updated_at = now()
  where id = p_lead_id;
  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

create or replace function public.get_teacher_attribution_students()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requester_email text;
  result jsonb;
begin
  requester_email := auth.jwt() ->> 'email';
  if requester_email is null or not exists (
    select 1 from public.teacher_admins ta where lower(ta.email) = lower(requester_email)
  ) then
    raise exception 'Acesso negado: usuário não cadastrado como professor.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'name', coalesce(nullif(p.name, ''), nullif(p.email, ''), 'Aluno sem nome'),
    'email', p.email,
    'created_at', p.created_at
  ) order by lower(coalesce(nullif(p.name, ''), nullif(p.email, ''), 'Aluno sem nome'))), '[]'::jsonb)
  into result
  from public.profiles p
  where coalesce(p.enrolled, false) = true
    and coalesce(p.archived, false) = false;

  return result;
end;
$$;

create or replace function public.get_teacher_recent_marketing_leads(period_days integer default 30)
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
    select 1 from public.teacher_admins ta where lower(ta.email) = lower(requester_email)
  ) then
    raise exception 'Acesso negado: usuário não cadastrado como professor.' using errcode = '42501';
  end if;

  bounded_days := greatest(1, least(coalesce(period_days, 30), 365));

  select coalesce(jsonb_agg(row_data order by occurred_at desc), '[]'::jsonb)
  into result
  from (
    select
      e.occurred_at,
      jsonb_build_object(
        'event_id', e.event_id,
        'occurred_at', e.occurred_at,
        'source', coalesce(nullif(e.source, ''), 'direct'),
        'medium', coalesce(nullif(e.medium, ''), 'none'),
        'campaign', coalesce(nullif(e.campaign, ''), 'not_set'),
        'ai_assistant', e.ai_assistant,
        'landing_page', coalesce(nullif(e.landing_page, ''), '/'),
        'link_position', coalesce(nullif(e.link_position, ''), 'unknown'),
        'confirmed', (l.id is not null),
        'commercial_lead_id', l.id,
        'confirmed_at', l.confirmed_at,
        'student_id', l.student_id,
        'student_name', p.name,
        'enrolled_at', l.enrolled_at,
        'revenue', coalesce((
          select sum(mt.amount_paid)
          from public.monthly_tuition mt
          where mt.student_id = l.student_id
            and mt.payment_date is not null
            and mt.amount_paid is not null
            and mt.payment_date >= (l.lead_event_at at time zone 'America/Sao_Paulo')::date
        ), 0)
      ) as row_data
    from public.marketing_acquisition_events e
    left join public.marketing_commercial_leads l on l.source_event_id = e.event_id
    left join public.profiles p on p.id = l.student_id
    where e.event_name = 'generate_lead'
      and e.occurred_at >= now() - make_interval(days => bounded_days)
    order by e.occurred_at desc
    limit 100
  ) recent;

  return result;
end;
$$;

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
    select 1 from public.teacher_admins ta where lower(ta.email) = lower(requester_email)
  ) then
    raise exception 'Acesso negado: usuário não cadastrado como professor.' using errcode = '42501';
  end if;

  bounded_days := greatest(1, least(coalesce(period_days, 30), 365));

  with base as (
    select *
    from public.marketing_acquisition_events
    where occurred_at >= now() - make_interval(days => bounded_days)
  ),
  commercial as (
    select l.*,
      coalesce((
        select sum(mt.amount_paid)
        from public.monthly_tuition mt
        where mt.student_id = l.student_id
          and mt.payment_date is not null
          and mt.amount_paid is not null
          and mt.payment_date >= (l.lead_event_at at time zone 'America/Sao_Paulo')::date
      ), 0)::numeric as revenue
    from public.marketing_commercial_leads l
    where l.lead_event_at >= now() - make_interval(days => bounded_days)
  ),
  overview as (
    select
      count(distinct visitor_id) filter (where event_name = 'page_view') as visitors,
      count(distinct visitor_id) filter (where event_name = 'generate_lead') as leads,
      count(distinct visitor_id) filter (where event_name = 'page_view' and ai_assistant = 'chatgpt') as chatgpt_visitors,
      count(distinct visitor_id) filter (where event_name = 'generate_lead' and ai_assistant = 'chatgpt') as chatgpt_leads
    from base
  ),
  commercial_overview as (
    select
      count(*) as confirmed_leads,
      count(*) filter (where student_id is not null) as enrollments,
      coalesce(sum(revenue), 0) as revenue,
      count(*) filter (where ai_assistant = 'chatgpt') as chatgpt_confirmed_leads,
      count(*) filter (where ai_assistant = 'chatgpt' and student_id is not null) as chatgpt_enrollments,
      coalesce(sum(revenue) filter (where ai_assistant = 'chatgpt'), 0) as chatgpt_revenue
    from commercial
  ),
  source_events as (
    select
      coalesce(nullif(source, ''), 'direct') as source_name,
      count(distinct visitor_id) filter (where event_name = 'page_view') as visitors,
      count(distinct visitor_id) filter (where event_name = 'generate_lead') as leads
    from base
    group by coalesce(nullif(source, ''), 'direct')
  ),
  source_commercial as (
    select
      coalesce(nullif(source, ''), 'direct') as source_name,
      count(*) as confirmed_leads,
      count(*) filter (where student_id is not null) as enrollments,
      coalesce(sum(revenue), 0) as revenue
    from commercial
    group by coalesce(nullif(source, ''), 'direct')
  ),
  all_sources as (
    select source_name from source_events
    union
    select source_name from source_commercial
  ),
  ai_events as (
    select
      ai_assistant as assistant,
      count(distinct visitor_id) filter (where event_name = 'page_view') as visitors,
      count(distinct visitor_id) filter (where event_name = 'generate_lead') as leads
    from base
    where ai_assistant is not null and ai_assistant <> '' and ai_assistant <> 'not_set'
    group by ai_assistant
  ),
  ai_commercial as (
    select
      ai_assistant as assistant,
      count(*) as confirmed_leads,
      count(*) filter (where student_id is not null) as enrollments,
      coalesce(sum(revenue), 0) as revenue
    from commercial
    where ai_assistant is not null and ai_assistant <> '' and ai_assistant <> 'not_set'
    group by ai_assistant
  ),
  all_ai as (
    select assistant from ai_events
    union
    select assistant from ai_commercial
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
      (b.occurred_at at time zone 'America/Sao_Paulo')::date as day,
      count(distinct b.visitor_id) filter (where b.event_name = 'page_view') as visitors,
      count(distinct b.visitor_id) filter (where b.event_name = 'generate_lead') as leads
    from base b
    group by (b.occurred_at at time zone 'America/Sao_Paulo')::date
  )
  select jsonb_build_object(
    'period_days', bounded_days,
    'visitors', coalesce(o.visitors, 0),
    'leads', coalesce(o.leads, 0),
    'conversion_rate', case when coalesce(o.visitors, 0) = 0 then 0 else round((o.leads::numeric * 100) / o.visitors, 1) end,
    'confirmed_leads', coalesce(co.confirmed_leads, 0),
    'enrollments', coalesce(co.enrollments, 0),
    'revenue', coalesce(co.revenue, 0),
    'lead_confirmation_rate', case when coalesce(o.leads, 0) = 0 then 0 else round((coalesce(co.confirmed_leads,0)::numeric * 100) / o.leads, 1) end,
    'enrollment_rate', case when coalesce(co.confirmed_leads, 0) = 0 then 0 else round((coalesce(co.enrollments,0)::numeric * 100) / co.confirmed_leads, 1) end,
    'chatgpt_visitors', coalesce(o.chatgpt_visitors, 0),
    'chatgpt_leads', coalesce(o.chatgpt_leads, 0),
    'chatgpt_conversion_rate', case when coalesce(o.chatgpt_visitors, 0) = 0 then 0 else round((o.chatgpt_leads::numeric * 100) / o.chatgpt_visitors, 1) end,
    'chatgpt_confirmed_leads', coalesce(co.chatgpt_confirmed_leads, 0),
    'chatgpt_enrollments', coalesce(co.chatgpt_enrollments, 0),
    'chatgpt_revenue', coalesce(co.chatgpt_revenue, 0),
    'channels', coalesce((
      select jsonb_agg(jsonb_build_object(
        'source', s.source_name,
        'visitors', coalesce(se.visitors, 0),
        'leads', coalesce(se.leads, 0),
        'confirmed_leads', coalesce(sc.confirmed_leads, 0),
        'enrollments', coalesce(sc.enrollments, 0),
        'revenue', coalesce(sc.revenue, 0),
        'conversion_rate', case when coalesce(se.visitors, 0) = 0 then 0 else round((coalesce(se.leads,0)::numeric * 100) / se.visitors, 1) end,
        'confirmation_rate', case when coalesce(se.leads, 0) = 0 then 0 else round((coalesce(sc.confirmed_leads,0)::numeric * 100) / se.leads, 1) end,
        'enrollment_rate', case when coalesce(sc.confirmed_leads, 0) = 0 then 0 else round((coalesce(sc.enrollments,0)::numeric * 100) / sc.confirmed_leads, 1) end
      ) order by coalesce(se.visitors,0) desc, coalesce(sc.revenue,0) desc, s.source_name)
      from all_sources s
      left join source_events se on se.source_name = s.source_name
      left join source_commercial sc on sc.source_name = s.source_name
    ), '[]'::jsonb),
    'ai_assistants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'assistant', a.assistant,
        'visitors', coalesce(ae.visitors, 0),
        'leads', coalesce(ae.leads, 0),
        'confirmed_leads', coalesce(ac.confirmed_leads, 0),
        'enrollments', coalesce(ac.enrollments, 0),
        'revenue', coalesce(ac.revenue, 0),
        'conversion_rate', case when coalesce(ae.visitors, 0) = 0 then 0 else round((coalesce(ae.leads,0)::numeric * 100) / ae.visitors, 1) end,
        'confirmation_rate', case when coalesce(ae.leads, 0) = 0 then 0 else round((coalesce(ac.confirmed_leads,0)::numeric * 100) / ae.leads, 1) end,
        'enrollment_rate', case when coalesce(ac.confirmed_leads, 0) = 0 then 0 else round((coalesce(ac.enrollments,0)::numeric * 100) / ac.confirmed_leads, 1) end
      ) order by coalesce(ae.visitors,0) desc, coalesce(ac.revenue,0) desc, a.assistant)
      from all_ai a
      left join ai_events ae on ae.assistant = a.assistant
      left join ai_commercial ac on ac.assistant = a.assistant
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
  from overview o cross join commercial_overview co;

  return coalesce(result, '{}'::jsonb);
end;
$$;

revoke all on function public.confirm_teacher_marketing_lead(uuid) from public, anon;
revoke all on function public.unconfirm_teacher_marketing_lead(uuid) from public, anon;
revoke all on function public.link_teacher_marketing_lead_student(uuid, uuid) from public, anon;
revoke all on function public.unlink_teacher_marketing_lead_student(uuid) from public, anon;
revoke all on function public.get_teacher_attribution_students() from public, anon;
revoke all on function public.get_teacher_recent_marketing_leads(integer) from public, anon;
revoke all on function public.get_teacher_acquisition_summary(integer) from public, anon;

grant execute on function public.confirm_teacher_marketing_lead(uuid) to authenticated;
grant execute on function public.unconfirm_teacher_marketing_lead(uuid) to authenticated;
grant execute on function public.link_teacher_marketing_lead_student(uuid, uuid) to authenticated;
grant execute on function public.unlink_teacher_marketing_lead_student(uuid) to authenticated;
grant execute on function public.get_teacher_attribution_students() to authenticated;
grant execute on function public.get_teacher_recent_marketing_leads(integer) to authenticated;
grant execute on function public.get_teacher_acquisition_summary(integer) to authenticated;
