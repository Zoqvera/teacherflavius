-- Pagamentos de mensalidades pelo Mercado Pago.
--
-- Execute depois de supabase_mensalidades.sql. Este arquivo:
--   1. registra tentativas de pagamento sem armazenar dados de cartão;
--   2. expõe ao aluno somente as próprias mensalidades em aberto por RPC;
--   3. permite que apenas a service_role confirme pagamentos do provedor;
--   4. mantém o histórico financeiro já usado pela área do professor.

begin;

alter table public.monthly_tuition
  add column if not exists payment_provider text,
  add column if not exists provider_payment_id text;

do $constraints$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.monthly_tuition'::regclass
      and conname = 'monthly_tuition_payment_provider_check'
  ) then
    alter table public.monthly_tuition
      add constraint monthly_tuition_payment_provider_check
      check (
        (payment_provider is null and provider_payment_id is null)
        or
        (payment_provider = 'mercado_pago' and provider_payment_id is not null)
      );
  end if;
end;
$constraints$;

create unique index if not exists monthly_tuition_provider_payment_id_uidx
  on public.monthly_tuition (provider_payment_id)
  where provider_payment_id is not null;

create table if not exists public.tuition_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  tuition_id uuid not null references public.monthly_tuition(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null default 'mercado_pago' check (provider = 'mercado_pago'),
  provider_payment_id text,
  idempotency_key uuid not null unique,
  amount numeric(10,2) not null check (amount > 0),
  payment_method text check (payment_method is null or payment_method in ('pix', 'card')),
  status text not null default 'created' check (
    status in (
      'created',
      'pending',
      'approved',
      'authorized',
      'in_process',
      'in_mediation',
      'rejected',
      'cancelled',
      'refunded',
      'charged_back'
    )
  ),
  status_detail text,
  live_mode boolean,
  provider_created_at timestamptz,
  provider_updated_at timestamptz,
  applied_at timestamptz,
  reversed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_payment_id)
);

create index if not exists tuition_payment_attempts_tuition_idx
  on public.tuition_payment_attempts (tuition_id, created_at desc);

create index if not exists tuition_payment_attempts_student_idx
  on public.tuition_payment_attempts (student_id, created_at desc);

create index if not exists tuition_payment_attempts_pending_idx
  on public.tuition_payment_attempts (status, updated_at desc)
  where status in ('created', 'pending', 'authorized', 'in_process', 'in_mediation');

alter table public.tuition_payment_attempts enable row level security;

-- A tabela não é consultada diretamente pelo navegador. A leitura do aluno
-- passa pela RPC get_my_pending_tuitions(), que filtra obrigatoriamente auth.uid().
drop policy if exists tuition_payment_attempts_no_direct_client_access
  on public.tuition_payment_attempts;
create policy tuition_payment_attempts_no_direct_client_access
  on public.tuition_payment_attempts
  for all
  to anon, authenticated
  using (false)
  with check (false);

revoke all on public.tuition_payment_attempts from public, anon, authenticated;
grant select, insert, update, delete on public.tuition_payment_attempts to service_role;

create or replace function public.set_tuition_payment_attempt_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tuition_payment_attempts_set_updated_at
  on public.tuition_payment_attempts;
create trigger tuition_payment_attempts_set_updated_at
before update on public.tuition_payment_attempts
for each row execute function public.set_tuition_payment_attempt_updated_at();

create or replace function public.get_my_pending_tuitions()
returns table (
  tuition_id uuid,
  reference_month date,
  due_date date,
  amount_due numeric,
  payment_status text,
  attempt_id uuid,
  provider_payment_id text,
  attempt_status text,
  attempt_status_detail text
)
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
  current_user_id uuid := auth.uid();
  local_today date := timezone('America/Sao_Paulo', now())::date;
begin
  if current_user_id is null then
    raise exception 'É necessário entrar na conta para consultar mensalidades.';
  end if;

  return query
  select
    mt.id,
    mt.reference_month,
    mt.due_date,
    mt.amount_due,
    case
      when mt.due_date < local_today then 'overdue'
      when mt.due_date = local_today then 'due_today'
      when mt.due_date = local_today + 1 then 'due_tomorrow'
      when mt.due_date = local_today + 2 then 'due_in_two_days'
      when mt.due_date <= local_today + 7 then 'due_soon'
      else 'open'
    end::text,
    latest_attempt.id,
    latest_attempt.provider_payment_id,
    latest_attempt.status,
    latest_attempt.status_detail
  from public.monthly_tuition mt
  left join public.student_billing_settings settings
    on settings.student_id = current_user_id
  left join lateral (
    select
      attempt.id,
      attempt.provider_payment_id,
      attempt.status,
      attempt.status_detail
    from public.tuition_payment_attempts attempt
    where attempt.tuition_id = mt.id
      and attempt.student_id = current_user_id
    order by attempt.created_at desc
    limit 1
  ) latest_attempt on true
  where mt.student_id = current_user_id
    and mt.payment_date is null
    and not mt.is_exempt
    and (
      mt.reference_month <= date_trunc('month', local_today)::date
      or mt.reference_month = settings.billing_start_month
    )
  order by mt.due_date asc, mt.reference_month asc;
end;
$$;

revoke all on function public.get_my_pending_tuitions() from public, anon;
grant execute on function public.get_my_pending_tuitions() to authenticated, service_role;

-- Chamada somente pelas Edge Functions com service_role. O valor retornado pelo
-- Mercado Pago precisa coincidir com a tentativa e com a mensalidade no banco.
create or replace function public.process_mercado_pago_payment(
  target_attempt_id uuid,
  target_provider_payment_id text,
  target_status text,
  target_status_detail text,
  target_amount numeric,
  target_payment_method text,
  target_live_mode boolean,
  target_provider_created_at timestamptz,
  target_provider_updated_at timestamptz,
  target_approved_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  attempt_row public.tuition_payment_attempts%rowtype;
  tuition_row public.monthly_tuition%rowtype;
  normalized_status text := lower(trim(coalesce(target_status, '')));
  normalized_method text := lower(trim(coalesce(target_payment_method, '')));
  normalized_provider_payment_id text := trim(coalesce(target_provider_payment_id, ''));
  affected_count integer := 0;
  payment_was_applied boolean := false;
  payment_was_reversed boolean := false;
begin
  if normalized_provider_payment_id = '' or length(normalized_provider_payment_id) > 128 then
    raise exception 'Identificador de pagamento inválido.';
  end if;

  if normalized_status not in (
    'created', 'pending', 'approved', 'authorized', 'in_process',
    'in_mediation', 'rejected', 'cancelled', 'refunded', 'charged_back'
  ) then
    raise exception 'Status de pagamento inválido.';
  end if;

  if normalized_method not in ('pix', 'card') then
    raise exception 'Forma de pagamento inválida.';
  end if;

  select *
  into attempt_row
  from public.tuition_payment_attempts attempt
  where attempt.id = target_attempt_id
  for update;

  if not found then
    raise exception 'Tentativa de pagamento não encontrada.';
  end if;

  select *
  into tuition_row
  from public.monthly_tuition tuition
  where tuition.id = attempt_row.tuition_id
    and tuition.student_id = attempt_row.student_id
  for update;

  if not found then
    raise exception 'Mensalidade vinculada não encontrada.';
  end if;

  if round(target_amount, 2) is distinct from round(attempt_row.amount, 2)
     or round(target_amount, 2) is distinct from round(tuition_row.amount_due, 2) then
    raise exception 'O valor confirmado não corresponde à mensalidade.';
  end if;

  if attempt_row.provider_payment_id is not null
     and attempt_row.provider_payment_id <> normalized_provider_payment_id then
    raise exception 'A tentativa já está vinculada a outro pagamento.';
  end if;

  update public.tuition_payment_attempts
  set
    provider_payment_id = normalized_provider_payment_id,
    status = normalized_status,
    status_detail = nullif(trim(coalesce(target_status_detail, '')), ''),
    payment_method = normalized_method,
    live_mode = target_live_mode,
    provider_created_at = coalesce(provider_created_at, target_provider_created_at),
    provider_updated_at = coalesce(target_provider_updated_at, now())
  where id = attempt_row.id;

  if normalized_status = 'approved' then
    update public.monthly_tuition
    set
      payment_date = coalesce(target_approved_at::date, current_date),
      amount_paid = round(target_amount, 2),
      payment_method = normalized_method,
      payment_notes = 'Mercado Pago · pagamento ' || normalized_provider_payment_id,
      payment_provider = 'mercado_pago',
      provider_payment_id = normalized_provider_payment_id,
      updated_at = now(),
      updated_by = null
    where id = tuition_row.id
      and payment_date is null;

    get diagnostics affected_count = row_count;
    payment_was_applied := affected_count > 0;

    if payment_was_applied then
      insert into public.monthly_tuition_events (tuition_id, action, actor_id, details)
      values (
        tuition_row.id,
        'payment_recorded',
        null,
        jsonb_build_object(
          'source', 'mercado_pago',
          'attempt_id', attempt_row.id,
          'provider_payment_id', normalized_provider_payment_id,
          'amount_paid', round(target_amount, 2),
          'payment_method', normalized_method,
          'status_detail', nullif(trim(coalesce(target_status_detail, '')), '')
        )
      );
    end if;

    if payment_was_applied
       or (
         tuition_row.payment_provider = 'mercado_pago'
         and tuition_row.provider_payment_id = normalized_provider_payment_id
       ) then
      update public.tuition_payment_attempts
      set applied_at = coalesce(applied_at, coalesce(target_approved_at, now()))
      where id = attempt_row.id;
    end if;
  elsif normalized_status in ('cancelled', 'refunded', 'charged_back')
        and attempt_row.applied_at is not null
        and attempt_row.reversed_at is null then
    update public.monthly_tuition
    set
      payment_date = null,
      amount_paid = null,
      payment_method = null,
      payment_notes = null,
      payment_provider = null,
      provider_payment_id = null,
      updated_at = now(),
      updated_by = null
    where id = tuition_row.id
      and payment_provider = 'mercado_pago'
      and provider_payment_id = normalized_provider_payment_id;

    get diagnostics affected_count = row_count;
    payment_was_reversed := affected_count > 0;

    if payment_was_reversed then
      insert into public.monthly_tuition_events (tuition_id, action, actor_id, details)
      values (
        tuition_row.id,
        'payment_reversed',
        null,
        jsonb_build_object(
          'source', 'mercado_pago',
          'attempt_id', attempt_row.id,
          'provider_payment_id', normalized_provider_payment_id,
          'provider_status', normalized_status,
          'status_detail', nullif(trim(coalesce(target_status_detail, '')), '')
        )
      );

      update public.tuition_payment_attempts
      set reversed_at = coalesce(reversed_at, now())
      where id = attempt_row.id;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'tuition_id', tuition_row.id,
    'attempt_id', attempt_row.id,
    'status', normalized_status,
    'payment_applied', payment_was_applied,
    'payment_reversed', payment_was_reversed
  );
end;
$$;

revoke all on function public.process_mercado_pago_payment(
  uuid, text, text, text, numeric, text, boolean, timestamptz, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.process_mercado_pago_payment(
  uuid, text, text, text, numeric, text, boolean, timestamptz, timestamptz, timestamptz
) to service_role;

-- As operações manuais do professor limpam qualquer vínculo antigo com um
-- pagamento online, evitando que um webhook posterior altere o registro errado.
create or replace function public.record_tuition_payment(
  target_tuition_id uuid,
  target_payment_date date,
  target_amount_paid numeric,
  target_payment_method text,
  target_payment_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_row public.monthly_tuition%rowtype;
  normalized_method text;
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso negado: usuário não cadastrado como administrador.';
  end if;

  select * into target_row
  from public.monthly_tuition mt
  where mt.id = target_tuition_id
  for update;

  if not found then
    raise exception 'Mensalidade não encontrada.';
  end if;

  if target_amount_paid is null or target_amount_paid <= 0 then
    raise exception 'Informe um valor pago maior que zero.';
  end if;

  normalized_method := lower(trim(coalesce(target_payment_method, '')));
  if normalized_method not in ('pix', 'cash', 'bank_transfer', 'card', 'other') then
    raise exception 'Forma de pagamento inválida.';
  end if;

  update public.monthly_tuition
  set
    payment_date = coalesce(target_payment_date, current_date),
    amount_paid = round(target_amount_paid, 2),
    payment_method = normalized_method,
    payment_notes = nullif(trim(coalesce(target_payment_notes, '')), ''),
    payment_provider = null,
    provider_payment_id = null,
    updated_at = now(),
    updated_by = auth.uid()
  where id = target_tuition_id;

  insert into public.monthly_tuition_events (tuition_id, action, actor_id, details)
  values (
    target_tuition_id,
    'payment_recorded',
    auth.uid(),
    jsonb_build_object(
      'payment_date', coalesce(target_payment_date, current_date),
      'amount_paid', round(target_amount_paid, 2),
      'payment_method', normalized_method,
      'payment_notes', nullif(trim(coalesce(target_payment_notes, '')), '')
    )
  );

  return jsonb_build_object('ok', true, 'tuition_id', target_tuition_id);
end;
$$;

create or replace function public.reverse_tuition_payment(
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

revoke all on function public.record_tuition_payment(uuid, date, numeric, text, text) from public, anon;
revoke all on function public.reverse_tuition_payment(uuid, text) from public, anon;
grant execute on function public.record_tuition_payment(uuid, date, numeric, text, text) to authenticated, service_role;
grant execute on function public.reverse_tuition_payment(uuid, text) to authenticated, service_role;

commit;

-- Verificação esperada:
select
  to_regclass('public.tuition_payment_attempts') is not null as attempts_table_ready,
  to_regprocedure('public.get_my_pending_tuitions()') is not null as student_rpc_ready,
  to_regprocedure(
    'public.process_mercado_pago_payment(uuid,text,text,text,numeric,text,boolean,timestamp with time zone,timestamp with time zone,timestamp with time zone)'
  ) is not null as provider_rpc_ready;
