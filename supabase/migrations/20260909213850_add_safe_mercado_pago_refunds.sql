create table if not exists public.payment_refund_requests (
  id uuid primary key default gen_random_uuid(),
  tuition_id uuid not null references public.monthly_tuition(id) on delete restrict,
  attempt_id uuid not null references public.tuition_payment_attempts(id) on delete restrict,
  provider_payment_id text not null,
  idempotency_key uuid not null default gen_random_uuid(),
  status text not null default 'created',
  requested_by uuid null references auth.users(id) on delete set null,
  reason text null,
  provider_refund_id text null,
  attempt_count integer not null default 0,
  started_at timestamptz null,
  provider_accepted_at timestamptz null,
  completed_at timestamptz null,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_refund_requests_provider_payment_id_key unique (provider_payment_id),
  constraint payment_refund_requests_idempotency_key_key unique (idempotency_key),
  constraint payment_refund_requests_status_check check (
    status in ('created','processing','provider_accepted','synchronized','failed')
  ),
  constraint payment_refund_requests_attempt_count_check check (attempt_count >= 0),
  constraint payment_refund_requests_provider_payment_id_check check (
    length(trim(provider_payment_id)) between 1 and 128
  )
);

create index if not exists payment_refund_requests_status_updated_idx
  on public.payment_refund_requests(status, updated_at);

alter table public.payment_refund_requests enable row level security;
revoke all on table public.payment_refund_requests from public, anon, authenticated;
grant select, insert, update on table public.payment_refund_requests to service_role;

create or replace function public.begin_mercado_pago_refund(
  target_tuition_id uuid,
  target_actor_id uuid,
  target_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  tuition_row public.monthly_tuition%rowtype;
  attempt_row public.tuition_payment_attempts%rowtype;
  refund_row public.payment_refund_requests%rowtype;
  normalized_reason text := nullif(left(trim(coalesce(target_reason, '')), 500), '');
begin
  if target_tuition_id is null or target_actor_id is null then
    raise exception 'Dados obrigatórios ausentes.' using errcode = '22023';
  end if;

  select *
  into tuition_row
  from public.monthly_tuition tuition
  where tuition.id = target_tuition_id
  for update;

  if not found then
    raise exception 'Mensalidade não encontrada.' using errcode = 'P0002';
  end if;

  if tuition_row.payment_date is null
     or tuition_row.payment_provider is distinct from 'mercado_pago'
     or nullif(trim(coalesce(tuition_row.provider_payment_id, '')), '') is null then
    raise exception 'Esta mensalidade não possui pagamento Mercado Pago elegível a reembolso.' using errcode = '22023';
  end if;

  select *
  into attempt_row
  from public.tuition_payment_attempts attempt
  where attempt.tuition_id = tuition_row.id
    and attempt.provider = 'mercado_pago'
    and attempt.provider_payment_id = tuition_row.provider_payment_id
  order by attempt.created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'Tentativa Mercado Pago vinculada não encontrada.' using errcode = 'P0002';
  end if;

  if attempt_row.status <> 'approved'
     or attempt_row.applied_at is null
     or attempt_row.reversed_at is not null then
    raise exception 'O pagamento não está em estado elegível para reembolso integral.' using errcode = '22023';
  end if;

  select *
  into refund_row
  from public.payment_refund_requests request
  where request.provider_payment_id = tuition_row.provider_payment_id
  for update;

  if not found then
    insert into public.payment_refund_requests (
      tuition_id,
      attempt_id,
      provider_payment_id,
      requested_by,
      reason
    ) values (
      tuition_row.id,
      attempt_row.id,
      tuition_row.provider_payment_id,
      target_actor_id,
      normalized_reason
    )
    returning * into refund_row;
  end if;

  if refund_row.status = 'synchronized' then
    return jsonb_build_object(
      'ok', true,
      'already_complete', true,
      'busy', false,
      'skip_provider_call', true,
      'request_id', refund_row.id,
      'attempt_id', refund_row.attempt_id,
      'provider_payment_id', refund_row.provider_payment_id,
      'idempotency_key', refund_row.idempotency_key,
      'amount', tuition_row.amount_paid,
      'status', refund_row.status
    );
  end if;

  if refund_row.status = 'processing'
     and refund_row.started_at is not null
     and refund_row.started_at > now() - interval '2 minutes' then
    return jsonb_build_object(
      'ok', true,
      'already_complete', false,
      'busy', true,
      'skip_provider_call', false,
      'request_id', refund_row.id,
      'attempt_id', refund_row.attempt_id,
      'provider_payment_id', refund_row.provider_payment_id,
      'idempotency_key', refund_row.idempotency_key,
      'amount', tuition_row.amount_paid,
      'status', refund_row.status
    );
  end if;

  if refund_row.status = 'provider_accepted' then
    update public.payment_refund_requests
    set
      requested_by = coalesce(requested_by, target_actor_id),
      reason = coalesce(normalized_reason, reason),
      updated_at = now()
    where id = refund_row.id
    returning * into refund_row;

    return jsonb_build_object(
      'ok', true,
      'already_complete', false,
      'busy', false,
      'skip_provider_call', true,
      'request_id', refund_row.id,
      'attempt_id', refund_row.attempt_id,
      'provider_payment_id', refund_row.provider_payment_id,
      'idempotency_key', refund_row.idempotency_key,
      'amount', tuition_row.amount_paid,
      'status', refund_row.status
    );
  end if;

  update public.payment_refund_requests
  set
    status = 'processing',
    requested_by = coalesce(requested_by, target_actor_id),
    reason = coalesce(normalized_reason, reason),
    attempt_count = attempt_count + 1,
    started_at = now(),
    last_error = null,
    updated_at = now()
  where id = refund_row.id
  returning * into refund_row;

  return jsonb_build_object(
    'ok', true,
    'already_complete', false,
    'busy', false,
    'skip_provider_call', false,
    'request_id', refund_row.id,
    'attempt_id', refund_row.attempt_id,
    'provider_payment_id', refund_row.provider_payment_id,
    'idempotency_key', refund_row.idempotency_key,
    'amount', tuition_row.amount_paid,
    'status', refund_row.status
  );
end;
$$;

create or replace function public.finish_mercado_pago_refund(
  target_request_id uuid,
  target_status text,
  target_provider_refund_id text default null,
  target_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_status text := lower(trim(coalesce(target_status, '')));
  normalized_refund_id text := nullif(left(trim(coalesce(target_provider_refund_id, '')), 128), '');
  normalized_error text := nullif(left(trim(coalesce(target_error, '')), 1000), '');
  refund_attempt_id uuid;
begin
  if normalized_status not in ('provider_accepted','synchronized','failed') then
    raise exception 'Status de reembolso inválido.' using errcode = '22023';
  end if;

  update public.payment_refund_requests
  set
    status = normalized_status,
    provider_refund_id = coalesce(normalized_refund_id, provider_refund_id),
    provider_accepted_at = case
      when normalized_status in ('provider_accepted','synchronized') then coalesce(provider_accepted_at, now())
      else provider_accepted_at
    end,
    completed_at = case
      when normalized_status = 'synchronized' then coalesce(completed_at, now())
      else completed_at
    end,
    last_error = normalized_error,
    updated_at = now()
  where id = target_request_id
  returning attempt_id into refund_attempt_id;

  if refund_attempt_id is null then
    return false;
  end if;

  if normalized_status = 'provider_accepted' then
    update public.tuition_payment_attempts
    set last_reconciled_at = null
    where id = refund_attempt_id;
  end if;

  return true;
end;
$$;

create or replace function public.get_teacher_mercado_pago_refund_candidates(
  target_reference_month date
)
returns table(
  tuition_id uuid,
  provider_payment_id text,
  attempt_id uuid,
  amount_paid numeric,
  payment_method text,
  payment_date date,
  refund_status text,
  refund_attempt_count integer
)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  normalized_month date;
begin
  if not public.is_teacher_admin_mfa() then
    raise exception 'Autenticação administrativa em duas etapas obrigatória.' using errcode = '42501';
  end if;

  normalized_month := date_trunc('month', coalesce(target_reference_month, current_date))::date;

  return query
  select
    tuition.id,
    tuition.provider_payment_id,
    attempt.id,
    tuition.amount_paid,
    tuition.payment_method,
    tuition.payment_date,
    refund.status,
    coalesce(refund.attempt_count, 0)
  from public.monthly_tuition tuition
  join lateral (
    select candidate.*
    from public.tuition_payment_attempts candidate
    where candidate.tuition_id = tuition.id
      and candidate.provider = 'mercado_pago'
      and candidate.provider_payment_id = tuition.provider_payment_id
    order by candidate.created_at desc
    limit 1
  ) attempt on true
  left join public.payment_refund_requests refund
    on refund.provider_payment_id = tuition.provider_payment_id
  where tuition.reference_month = normalized_month
    and tuition.payment_date is not null
    and tuition.payment_provider = 'mercado_pago'
    and tuition.provider_payment_id is not null
    and attempt.status = 'approved'
    and attempt.applied_at is not null
    and attempt.reversed_at is null
  order by tuition.payment_date desc, tuition.id;
end;
$$;

create or replace function public.reverse_tuition_payment__mfa_inner(
  target_tuition_id uuid,
  target_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  previous_payment jsonb;
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso negado: usuário não cadastrado como administrador.';
  end if;

  select jsonb_build_object(
    'payment_date', mt.payment_date,
    'amount_paid', mt.amount_paid,
    'payment_method', mt.payment_method,
    'payment_notes', mt.payment_notes,
    'payment_provider', mt.payment_provider,
    'provider_payment_id', mt.provider_payment_id
  )
  into previous_payment
  from public.monthly_tuition mt
  where mt.id = target_tuition_id
    and mt.payment_date is not null
  for update;

  if not found then
    raise exception 'Pagamento registrado não encontrado.';
  end if;

  if nullif(trim(coalesce(previous_payment ->> 'payment_provider', '')), '') is not null
     or nullif(trim(coalesce(previous_payment ->> 'provider_payment_id', '')), '') is not null then
    raise exception 'Pagamentos confirmados por gateway devem ser reembolsados no provedor antes da reversão local.' using errcode = '22023';
  end if;

  update public.monthly_tuition
  set
    payment_date = null,
    amount_paid = null,
    payment_method = null,
    payment_notes = null,
    payment_provider = null,
    provider_payment_id = null,
    updated_at = now(),
    updated_by = auth.uid()
  where id = target_tuition_id;

  insert into public.monthly_tuition_events (tuition_id, action, actor_id, details)
  values (
    target_tuition_id,
    'payment_reversed',
    auth.uid(),
    previous_payment || jsonb_build_object(
      'reason', nullif(trim(coalesce(target_reason, '')), '')
    )
  );

  return jsonb_build_object('ok', true, 'tuition_id', target_tuition_id);
end;
$$;

revoke all on function public.begin_mercado_pago_refund(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.finish_mercado_pago_refund(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.begin_mercado_pago_refund(uuid, uuid, text) to service_role;
grant execute on function public.finish_mercado_pago_refund(uuid, text, text, text) to service_role;

revoke all on function public.get_teacher_mercado_pago_refund_candidates(date) from public, anon;
grant execute on function public.get_teacher_mercado_pago_refund_candidates(date) to authenticated;
