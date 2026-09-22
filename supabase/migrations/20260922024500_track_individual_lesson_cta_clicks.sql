alter table public.marketing_acquisition_events
  drop constraint if exists marketing_acquisition_events_event_name_check;

alter table public.marketing_acquisition_events
  add constraint marketing_acquisition_events_event_name_check
  check (event_name in ('page_view', 'generate_lead', 'cta_click'));

create index if not exists marketing_acquisition_events_cta_page_idx
  on public.marketing_acquisition_events (page_path, occurred_at desc)
  where event_name = 'cta_click';

create or replace function public.get_teacher_individual_cta_summary(period_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  bounded_days integer;
  result jsonb;
begin
  if not public.is_teacher_admin_mfa() then
    raise exception 'Autenticação administrativa em duas etapas obrigatória.' using errcode = '42501';
  end if;

  bounded_days := greatest(1, least(coalesce(period_days, 30), 365));

  with filtered as (
    select visitor_id, coalesce(nullif(link_position, ''), 'unknown') as cta_id
    from public.marketing_acquisition_events
    where event_name = 'cta_click'
      and page_path in ('/aulas-individuais', '/aulas-individuais/')
      and occurred_at >= now() - make_interval(days => bounded_days)
  ),
  grouped as (
    select
      cta_id,
      count(*)::integer as clicks,
      count(distinct visitor_id)::integer as unique_visitors
    from filtered
    group by cta_id
  )
  select jsonb_build_object(
    'period_days', bounded_days,
    'page_path', '/aulas-individuais/',
    'total_clicks', (select count(*) from filtered),
    'unique_visitors', (select count(distinct visitor_id) from filtered),
    'active_ctas', (select count(*) from grouped),
    'ctas', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'cta_id', grouped.cta_id,
          'clicks', grouped.clicks,
          'unique_visitors', grouped.unique_visitors
        )
        order by grouped.clicks desc, grouped.cta_id
      )
      from grouped
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

revoke all on function public.get_teacher_individual_cta_summary(integer) from public, anon, authenticated;
grant execute on function public.get_teacher_individual_cta_summary(integer) to authenticated;
