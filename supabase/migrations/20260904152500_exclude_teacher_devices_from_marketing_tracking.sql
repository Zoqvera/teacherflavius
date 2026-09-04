create table if not exists public.marketing_acquisition_excluded_visitors (
  visitor_id uuid primary key,
  excluded_by uuid,
  excluded_at timestamptz not null default now()
);

alter table public.marketing_acquisition_excluded_visitors enable row level security;
revoke all on table public.marketing_acquisition_excluded_visitors from public, anon, authenticated;

create or replace function public.exclude_teacher_marketing_visitor(target_visitor_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requester_email text;
begin
  requester_email := auth.jwt() ->> 'email';
  if requester_email is null or not exists (
    select 1
    from public.teacher_admins ta
    where lower(ta.email) = lower(requester_email)
  ) then
    raise exception 'Acesso negado: usuário não cadastrado como professor.' using errcode = '42501';
  end if;

  if target_visitor_id is null then
    raise exception 'visitor_id é obrigatório.' using errcode = '22023';
  end if;

  insert into public.marketing_acquisition_excluded_visitors (visitor_id, excluded_by, excluded_at)
  values (target_visitor_id, auth.uid(), now())
  on conflict (visitor_id) do update
    set excluded_by = excluded.excluded_by,
        excluded_at = excluded.excluded_at;

  return true;
end;
$$;

revoke all on function public.exclude_teacher_marketing_visitor(uuid) from public, anon;
grant execute on function public.exclude_teacher_marketing_visitor(uuid) to authenticated;

create or replace function public.restore_teacher_marketing_visitor(target_visitor_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requester_email text;
begin
  requester_email := auth.jwt() ->> 'email';
  if requester_email is null or not exists (
    select 1
    from public.teacher_admins ta
    where lower(ta.email) = lower(requester_email)
  ) then
    raise exception 'Acesso negado: usuário não cadastrado como professor.' using errcode = '42501';
  end if;

  delete from public.marketing_acquisition_excluded_visitors
  where visitor_id = target_visitor_id;

  return found;
end;
$$;

revoke all on function public.restore_teacher_marketing_visitor(uuid) from public, anon;
grant execute on function public.restore_teacher_marketing_visitor(uuid) to authenticated;

create or replace function public.suppress_excluded_marketing_visitor_events()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from public.marketing_acquisition_excluded_visitors x
    where x.visitor_id = new.visitor_id
  ) then
    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists suppress_excluded_marketing_visitor_events on public.marketing_acquisition_events;
create trigger suppress_excluded_marketing_visitor_events
before insert on public.marketing_acquisition_events
for each row execute function public.suppress_excluded_marketing_visitor_events();
