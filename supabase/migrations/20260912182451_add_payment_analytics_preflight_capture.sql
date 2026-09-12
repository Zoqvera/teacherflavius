create table public.payment_analytics_preflight (
  idempotency_key uuid primary key,
  tuition_id uuid not null references public.monthly_tuition(id) on delete cascade,
  student_id uuid not null,
  client_id text not null,
  session_id text,
  consent_observed_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '2 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_analytics_preflight_client_id_check check (
    char_length(client_id) between 1 and 80
    and client_id ~ '^[A-Za-z0-9._-]+$'
  ),
  constraint payment_analytics_preflight_session_id_check check (
    session_id is null
    or (
      char_length(session_id) between 1 and 80
      and session_id ~ '^[A-Za-z0-9._-]+$'
    )
  ),
  constraint payment_analytics_preflight_expiry_check check (expires_at > consent_observed_at)
);

create index payment_analytics_preflight_tuition_idx
  on public.payment_analytics_preflight(tuition_id);
create index payment_analytics_preflight_student_idx
  on public.payment_analytics_preflight(student_id);
create index payment_analytics_preflight_expiry_idx
  on public.payment_analytics_preflight(expires_at);

alter table public.payment_analytics_preflight enable row level security;
revoke all on table public.payment_analytics_preflight from public, anon, authenticated;
grant select, insert, update, delete on table public.payment_analytics_preflight to service_role;

create or replace function private.enqueue_payment_analytics_event_id(target_event_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  payment_event public.monthly_tuition_events%rowtype;
  payment_attempt public.tuition_payment_attempts%rowtype;
  analytics_context public.payment_analytics_context%rowtype;
  preflight_context public.payment_analytics_preflight%rowtype;
  target_attempt_id uuid;
  target_event_name text;
  target_provider_payment_id text;
  target_value numeric;
  target_payment_method text;
  inserted_rows integer := 0;
begin
  if target_event_id is null then
    return false;
  end if;

  select * into payment_event
  from public.monthly_tuition_events
  where id = target_event_id;

  if not found
    or payment_event.action not in ('payment_recorded', 'payment_reversed')
    or coalesce(payment_event.details ->> 'source', '') <> 'mercado_pago'
  then
    return false;
  end if;

  begin
    target_attempt_id := nullif(payment_event.details ->> 'attempt_id', '')::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  if target_attempt_id is null then
    return false;
  end if;

  select * into payment_attempt
  from public.tuition_payment_attempts
  where id = target_attempt_id;

  if not found then
    return false;
  end if;

  select * into analytics_context
  from public.payment_analytics_context
  where attempt_id = target_attempt_id;

  if not found then
    select * into preflight_context
    from public.payment_analytics_preflight
    where idempotency_key = payment_attempt.idempotency_key
      and tuition_id = payment_attempt.tuition_id
      and student_id = payment_attempt.student_id
      and expires_at > now();

    if not found then
      return false;
    end if;

    insert into public.payment_analytics_context (
      attempt_id,
      client_id,
      session_id,
      consent_observed_at,
      updated_at
    ) values (
      payment_attempt.id,
      preflight_context.client_id,
      preflight_context.session_id,
      preflight_context.consent_observed_at,
      now()
    )
    on conflict (attempt_id) do update
      set client_id = excluded.client_id,
          session_id = excluded.session_id,
          consent_observed_at = excluded.consent_observed_at,
          updated_at = now();

    select * into analytics_context
    from public.payment_analytics_context
    where attempt_id = target_attempt_id;

    delete from public.payment_analytics_preflight
    where idempotency_key = payment_attempt.idempotency_key;
  end if;

  target_provider_payment_id := coalesce(
    nullif(payment_event.details ->> 'provider_payment_id', ''),
    payment_attempt.provider_payment_id
  );
  target_payment_method := case
    when coalesce(payment_event.details ->> 'payment_method', payment_attempt.payment_method) = 'pix' then 'pix'
    else 'card'
  end;

  if payment_event.action = 'payment_recorded' then
    target_event_name := 'purchase';
    begin
      target_value := coalesce(
        nullif(payment_event.details ->> 'amount_paid', '')::numeric,
        payment_attempt.amount
      );
    exception when invalid_text_representation then
      target_value := payment_attempt.amount;
    end;
  elsif coalesce(payment_event.details ->> 'provider_status', '') = 'refunded' then
    target_event_name := 'refund';
    target_value := payment_attempt.amount;
  else
    return false;
  end if;

  if target_provider_payment_id is null
    or target_provider_payment_id = ''
    or target_value is null
    or target_value <= 0
  then
    return false;
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

  get diagnostics inserted_rows = row_count;
  return inserted_rows = 1;
end;
$$;

revoke all on function private.enqueue_payment_analytics_event_id(uuid) from public, anon, authenticated, service_role;

create or replace function private.enqueue_payment_analytics_event()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  perform private.enqueue_payment_analytics_event_id(new.id);
  return new;
end;
$$;

revoke all on function private.enqueue_payment_analytics_event() from public, anon, authenticated, service_role;

create or replace function public.backfill_payment_analytics_outbox(target_attempt_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  payment_event_id uuid;
  enqueued integer := 0;
begin
  if target_attempt_id is null then
    return 0;
  end if;

  for payment_event_id in
    select e.id
    from public.monthly_tuition_events e
    where e.action in ('payment_recorded', 'payment_reversed')
      and e.details ->> 'source' = 'mercado_pago'
      and e.details ->> 'attempt_id' = target_attempt_id::text
    order by e.created_at asc
  loop
    if private.enqueue_payment_analytics_event_id(payment_event_id) then
      enqueued := enqueued + 1;
    end if;
  end loop;

  return enqueued;
end;
$$;

revoke all on function public.backfill_payment_analytics_outbox(uuid) from public, anon, authenticated;
grant execute on function public.backfill_payment_analytics_outbox(uuid) to service_role;
