create table public.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'mercado_pago',
  deduplication_key text not null unique,
  request_id text,
  provider_event_id text,
  provider_payment_id text,
  event_type text,
  action text,
  status text not null default 'received',
  delivery_count integer not null default 1,
  processing_attempts integer not null default 0,
  replay_count integer not null default 0,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  first_received_at timestamptz not null default now(),
  last_received_at timestamptz not null default now(),
  last_processing_started_at timestamptz,
  processed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint payment_webhook_events_provider_check
    check (provider = 'mercado_pago'),
  constraint payment_webhook_events_deduplication_key_check
    check (deduplication_key ~ '^[0-9a-f]{64}$'),
  constraint payment_webhook_events_request_id_check
    check (request_id is null or length(request_id) <= 160),
  constraint payment_webhook_events_provider_event_id_check
    check (provider_event_id is null or length(provider_event_id) <= 128),
  constraint payment_webhook_events_provider_payment_id_check
    check (provider_payment_id is null or length(provider_payment_id) <= 128),
  constraint payment_webhook_events_event_type_check
    check (event_type is null or length(event_type) <= 50),
  constraint payment_webhook_events_action_check
    check (action is null or length(action) <= 100),
  constraint payment_webhook_events_status_check
    check (status in ('received', 'processing', 'processed', 'ignored', 'failed')),
  constraint payment_webhook_events_delivery_count_check
    check (delivery_count >= 1),
  constraint payment_webhook_events_processing_attempts_check
    check (processing_attempts >= 0),
  constraint payment_webhook_events_replay_count_check
    check (replay_count >= 0),
  constraint payment_webhook_events_last_error_check
    check (last_error is null or length(last_error) <= 500),
  constraint payment_webhook_events_metadata_check
    check (jsonb_typeof(metadata) = 'object')
);

alter table public.payment_webhook_events enable row level security;
revoke all on table public.payment_webhook_events from public, anon, authenticated;
grant select, insert, update on table public.payment_webhook_events to service_role;

create index payment_webhook_events_status_received_idx
  on public.payment_webhook_events (status, last_received_at desc);

create index payment_webhook_events_provider_payment_idx
  on public.payment_webhook_events (provider_payment_id, last_received_at desc)
  where provider_payment_id is not null;

create or replace function public.register_mercado_pago_webhook_event(
  target_deduplication_key text,
  target_request_id text,
  target_provider_event_id text,
  target_provider_payment_id text,
  target_event_type text,
  target_action text,
  target_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  event_row public.payment_webhook_events%rowtype;
  normalized_key text := lower(trim(coalesce(target_deduplication_key, '')));
  normalized_metadata jsonb := coalesce(target_metadata, '{}'::jsonb);
begin
  if normalized_key !~ '^[0-9a-f]{64}$' then
    raise exception 'Chave de deduplicação de webhook inválida.';
  end if;

  if jsonb_typeof(normalized_metadata) <> 'object' then
    raise exception 'Metadados de webhook inválidos.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(normalized_key, 0));

  select *
  into event_row
  from public.payment_webhook_events event
  where event.deduplication_key = normalized_key
  for update;

  if found then
    update public.payment_webhook_events
    set
      delivery_count = delivery_count + 1,
      last_received_at = now(),
      request_id = coalesce(nullif(trim(target_request_id), ''), request_id),
      provider_event_id = coalesce(nullif(trim(target_provider_event_id), ''), provider_event_id),
      provider_payment_id = coalesce(nullif(trim(target_provider_payment_id), ''), provider_payment_id),
      event_type = coalesce(nullif(trim(target_event_type), ''), event_type),
      action = coalesce(nullif(trim(target_action), ''), action),
      metadata = metadata || normalized_metadata,
      updated_at = now()
    where id = event_row.id
    returning * into event_row;
  else
    insert into public.payment_webhook_events (
      deduplication_key,
      request_id,
      provider_event_id,
      provider_payment_id,
      event_type,
      action,
      metadata
    )
    values (
      normalized_key,
      nullif(trim(target_request_id), ''),
      nullif(trim(target_provider_event_id), ''),
      nullif(trim(target_provider_payment_id), ''),
      nullif(trim(target_event_type), ''),
      nullif(trim(target_action), ''),
      normalized_metadata
    )
    returning * into event_row;
  end if;

  return jsonb_build_object(
    'event_id', event_row.id,
    'status', event_row.status,
    'delivery_count', event_row.delivery_count,
    'processing_attempts', event_row.processing_attempts,
    'replay_count', event_row.replay_count,
    'last_processing_started_at', event_row.last_processing_started_at
  );
end;
$$;

create or replace function public.begin_mercado_pago_webhook_processing(
  target_event_id uuid,
  target_is_replay boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  event_row public.payment_webhook_events%rowtype;
begin
  select *
  into event_row
  from public.payment_webhook_events event
  where event.id = target_event_id
  for update;

  if not found then
    raise exception 'Evento de webhook não encontrado.';
  end if;

  if event_row.status = 'processing'
     and event_row.last_processing_started_at > now() - interval '2 minutes' then
    raise exception 'Evento de webhook já está em processamento.';
  end if;

  update public.payment_webhook_events
  set
    status = 'processing',
    processing_attempts = processing_attempts + 1,
    replay_count = replay_count + case when target_is_replay then 1 else 0 end,
    last_processing_started_at = now(),
    last_error = null,
    updated_at = now()
  where id = event_row.id
  returning * into event_row;

  return jsonb_build_object(
    'event_id', event_row.id,
    'provider', event_row.provider,
    'provider_payment_id', event_row.provider_payment_id,
    'event_type', event_row.event_type,
    'status', event_row.status,
    'processing_attempts', event_row.processing_attempts,
    'replay_count', event_row.replay_count
  );
end;
$$;

create or replace function public.finish_mercado_pago_webhook_event(
  target_event_id uuid,
  target_status text,
  target_error text default null
)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  normalized_status text := lower(trim(coalesce(target_status, '')));
  normalized_error text := nullif(left(trim(coalesce(target_error, '')), 500), '');
begin
  if normalized_status not in ('processed', 'ignored', 'failed') then
    raise exception 'Status final de webhook inválido.';
  end if;

  update public.payment_webhook_events
  set
    status = normalized_status,
    last_error = normalized_error,
    processed_at = case
      when normalized_status in ('processed', 'ignored') then now()
      else processed_at
    end,
    updated_at = now()
  where id = target_event_id;

  if not found then
    raise exception 'Evento de webhook não encontrado.';
  end if;
end;
$$;

create or replace function public.get_teacher_payment_webhook_events(
  target_limit integer default 25
)
returns table (
  event_id uuid,
  provider_payment_id text,
  event_type text,
  action text,
  status text,
  delivery_count integer,
  processing_attempts integer,
  replay_count integer,
  last_error text,
  first_received_at timestamptz,
  last_received_at timestamptz,
  last_processing_started_at timestamptz,
  processed_at timestamptz
)
language plpgsql
security definer
set search_path = 'public', 'auth', 'pg_temp'
as $$
declare
  safe_limit integer := greatest(1, least(coalesce(target_limit, 25), 100));
begin
  if not public.is_teacher_admin_mfa() then
    raise exception 'Autenticação administrativa em duas etapas obrigatória.' using errcode = '42501';
  end if;

  return query
  select
    event.id,
    event.provider_payment_id,
    event.event_type,
    event.action,
    event.status,
    event.delivery_count,
    event.processing_attempts,
    event.replay_count,
    event.last_error,
    event.first_received_at,
    event.last_received_at,
    event.last_processing_started_at,
    event.processed_at
  from public.payment_webhook_events event
  order by event.last_received_at desc
  limit safe_limit;
end;
$$;

revoke all on function public.register_mercado_pago_webhook_event(text,text,text,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.begin_mercado_pago_webhook_processing(uuid,boolean) from public, anon, authenticated;
revoke all on function public.finish_mercado_pago_webhook_event(uuid,text,text) from public, anon, authenticated;
revoke all on function public.get_teacher_payment_webhook_events(integer) from public, anon;

grant execute on function public.register_mercado_pago_webhook_event(text,text,text,text,text,text,jsonb) to service_role;
grant execute on function public.begin_mercado_pago_webhook_processing(uuid,boolean) to service_role;
grant execute on function public.finish_mercado_pago_webhook_event(uuid,text,text) to service_role;
grant execute on function public.get_teacher_payment_webhook_events(integer) to authenticated, service_role;
