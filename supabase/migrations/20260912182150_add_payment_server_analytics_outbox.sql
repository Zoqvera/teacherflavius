create table public.payment_analytics_context (
  attempt_id uuid primary key references public.tuition_payment_attempts(id) on delete cascade,
  client_id text not null,
  session_id text,
  consent_observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_analytics_context_client_id_check check (
    char_length(client_id) between 1 and 80
    and client_id ~ '^[A-Za-z0-9._-]+$'
  ),
  constraint payment_analytics_context_session_id_check check (
    session_id is null
    or (
      char_length(session_id) between 1 and 80
      and session_id ~ '^[A-Za-z0-9._-]+$'
    )
  )
);

alter table public.payment_analytics_context enable row level security;
revoke all on table public.payment_analytics_context from public, anon, authenticated;
grant select, insert, update, delete on table public.payment_analytics_context to service_role;

create table public.payment_analytics_outbox (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  attempt_id uuid not null references public.tuition_payment_attempts(id) on delete cascade,
  tuition_id uuid not null references public.monthly_tuition(id) on delete cascade,
  provider_payment_id text not null,
  client_id text not null,
  session_id text,
  value numeric(12,2) not null,
  currency text not null default 'BRL',
  payment_method text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  processing_started_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_analytics_outbox_event_name_check check (event_name in ('purchase','refund')),
  constraint payment_analytics_outbox_provider_payment_id_check check (char_length(provider_payment_id) between 1 and 120),
  constraint payment_analytics_outbox_client_id_check check (
    char_length(client_id) between 1 and 80
    and client_id ~ '^[A-Za-z0-9._-]+$'
  ),
  constraint payment_analytics_outbox_session_id_check check (
    session_id is null
    or (
      char_length(session_id) between 1 and 80
      and session_id ~ '^[A-Za-z0-9._-]+$'
    )
  ),
  constraint payment_analytics_outbox_value_check check (value > 0),
  constraint payment_analytics_outbox_currency_check check (currency = 'BRL'),
  constraint payment_analytics_outbox_payment_method_check check (payment_method in ('pix','card')),
  constraint payment_analytics_outbox_status_check check (status in ('pending','processing','sent','failed')),
  constraint payment_analytics_outbox_attempts_check check (attempts >= 0),
  constraint payment_analytics_outbox_event_payment_unique unique (event_name, provider_payment_id)
);

create index payment_analytics_outbox_dispatch_idx
  on public.payment_analytics_outbox(status, next_attempt_at, created_at);
create index payment_analytics_outbox_attempt_idx
  on public.payment_analytics_outbox(attempt_id);
create index payment_analytics_outbox_tuition_idx
  on public.payment_analytics_outbox(tuition_id);

alter table public.payment_analytics_outbox enable row level security;
revoke all on table public.payment_analytics_outbox from public, anon, authenticated;
grant select, insert, update, delete on table public.payment_analytics_outbox to service_role;

create or replace function private.enqueue_payment_analytics_event()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  target_attempt_id uuid;
  target_event_name text;
  target_provider_payment_id text;
  target_value numeric;
  target_payment_method text;
  analytics_context public.payment_analytics_context%rowtype;
  payment_attempt public.tuition_payment_attempts%rowtype;
begin
  if new.action not in ('payment_recorded', 'payment_reversed') then
    return new;
  end if;

  if coalesce(new.details ->> 'source', '') <> 'mercado_pago' then
    return new;
  end if;

  begin
    target_attempt_id := nullif(new.details ->> 'attempt_id', '')::uuid;
  exception when invalid_text_representation then
    return new;
  end;

  if target_attempt_id is null then
    return new;
  end if;

  select * into analytics_context
  from public.payment_analytics_context
  where attempt_id = target_attempt_id;

  if not found then
    return new;
  end if;

  select * into payment_attempt
  from public.tuition_payment_attempts
  where id = target_attempt_id;

  if not found then
    return new;
  end if;

  target_provider_payment_id := coalesce(
    nullif(new.details ->> 'provider_payment_id', ''),
    payment_attempt.provider_payment_id
  );
  target_payment_method := case
    when coalesce(new.details ->> 'payment_method', payment_attempt.payment_method) = 'pix' then 'pix'
    else 'card'
  end;

  if new.action = 'payment_recorded' then
    target_event_name := 'purchase';
    target_value := coalesce(
      nullif(new.details ->> 'amount_paid', '')::numeric,
      payment_attempt.amount
    );
  elsif coalesce(new.details ->> 'provider_status', '') = 'refunded' then
    target_event_name := 'refund';
    target_value := payment_attempt.amount;
  else
    return new;
  end if;

  if target_provider_payment_id is null or target_provider_payment_id = '' or target_value is null or target_value <= 0 then
    return new;
  end if;

  insert into public.payment_analytics_outbox (
    event_name,
    attempt_id,
    tuition_id,
    provider_payment_id,
    client_id,
    session_id,
    value,
    currency,
    payment_method
  ) values (
    target_event_name,
    payment_attempt.id,
    payment_attempt.tuition_id,
    target_provider_payment_id,
    analytics_context.client_id,
    analytics_context.session_id,
    target_value,
    'BRL',
    target_payment_method
  )
  on conflict (event_name, provider_payment_id) do nothing;

  return new;
end;
$$;

revoke all on function private.enqueue_payment_analytics_event() from public, anon, authenticated, service_role;

create trigger monthly_tuition_events_payment_analytics_outbox
  after insert on public.monthly_tuition_events
  for each row
  execute function private.enqueue_payment_analytics_event();

create or replace function public.claim_payment_analytics_outbox(target_limit integer default 20)
returns setof public.payment_analytics_outbox
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  target_limit := greatest(1, least(coalesce(target_limit, 20), 50));

  update public.payment_analytics_outbox
  set
    status = 'pending',
    processing_started_at = null,
    next_attempt_at = now(),
    updated_at = now(),
    last_error = coalesce(last_error, 'stale_processing_recovered')
  where status = 'processing'
    and processing_started_at < now() - interval '10 minutes';

  return query
  with candidates as (
    select o.id
    from public.payment_analytics_outbox o
    where o.status in ('pending','failed')
      and o.next_attempt_at <= now()
    order by o.created_at asc
    for update skip locked
    limit target_limit
  )
  update public.payment_analytics_outbox o
  set
    status = 'processing',
    attempts = o.attempts + 1,
    processing_started_at = now(),
    updated_at = now(),
    last_error = null
  from candidates c
  where o.id = c.id
  returning o.*;
end;
$$;

revoke all on function public.claim_payment_analytics_outbox(integer) from public, anon, authenticated;
grant execute on function public.claim_payment_analytics_outbox(integer) to service_role;

create or replace function public.finish_payment_analytics_outbox(
  target_id uuid,
  target_success boolean,
  target_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  affected integer;
begin
  if target_id is null then
    return false;
  end if;

  update public.payment_analytics_outbox
  set
    status = case when target_success then 'sent' else 'failed' end,
    sent_at = case when target_success then now() else sent_at end,
    processing_started_at = null,
    next_attempt_at = case
      when target_success then next_attempt_at
      else now() + make_interval(secs => least(3600, greatest(60, (attempts * attempts) * 60)))
    end,
    last_error = case
      when target_success then null
      else left(coalesce(nullif(target_error, ''), 'analytics_delivery_failed'), 500)
    end,
    updated_at = now()
  where id = target_id
    and status = 'processing';

  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

revoke all on function public.finish_payment_analytics_outbox(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.finish_payment_analytics_outbox(uuid, boolean, text) to service_role;
