-- Restore the financial subject reference invariants that production gained after
-- the original reconstruction snapshot. These columns let financial history
-- survive account deletion without retaining an active profile relationship.
alter table public.monthly_tuition
  add column if not exists subject_ref uuid;

update public.monthly_tuition
set subject_ref = student_id
where subject_ref is null;

alter table public.monthly_tuition
  alter column subject_ref set not null,
  alter column student_id drop not null;

alter table public.monthly_tuition
  drop constraint if exists monthly_tuition_student_id_fkey;

alter table public.monthly_tuition
  add constraint monthly_tuition_student_id_fkey
  foreign key (student_id)
  references public.profiles(id)
  on delete set null;

alter table public.tuition_payment_attempts
  add column if not exists subject_ref uuid;

update public.tuition_payment_attempts
set subject_ref = student_id
where subject_ref is null;

alter table public.tuition_payment_attempts
  alter column subject_ref set not null,
  alter column student_id drop not null;

alter table public.tuition_payment_attempts
  drop constraint if exists tuition_payment_attempts_student_id_fkey;

alter table public.tuition_payment_attempts
  add constraint tuition_payment_attempts_student_id_fkey
  foreign key (student_id)
  references public.profiles(id)
  on delete set null;

create table public.subscription_authorized_payments (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references public.student_subscriptions(id) on delete set null,
  student_id uuid references public.profiles(id) on delete set null,
  subject_ref uuid not null,
  provider text not null default 'mercado_pago',
  provider_authorized_payment_id text not null,
  provider_subscription_id text not null,
  provider_payment_id text,
  reference_month date not null,
  debit_date timestamptz not null,
  amount numeric(10,2) not null,
  currency_id text not null default 'BRL',
  invoice_status text not null,
  payment_status text,
  payment_status_detail text,
  payment_method text,
  live_mode boolean,
  provider_created_at timestamptz,
  provider_updated_at timestamptz,
  approved_at timestamptz,
  tuition_id uuid references public.monthly_tuition(id) on delete set null,
  applied_at timestamptz,
  reversed_at timestamptz,
  conflict_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscription_authorized_payments_provider_check
    check (provider = 'mercado_pago'),
  constraint subscription_authorized_payments_provider_invoice_id_check
    check (char_length(trim(provider_authorized_payment_id)) between 1 and 128),
  constraint subscription_authorized_payments_provider_subscription_id_check
    check (char_length(trim(provider_subscription_id)) between 1 and 128),
  constraint subscription_authorized_payments_provider_payment_id_check
    check (provider_payment_id is null or char_length(trim(provider_payment_id)) between 1 and 128),
  constraint subscription_authorized_payments_reference_first_day
    check (reference_month = date_trunc('month', reference_month::timestamptz)::date),
  constraint subscription_authorized_payments_amount_check
    check (amount > 0),
  constraint subscription_authorized_payments_currency_check
    check (currency_id = 'BRL'),
  constraint subscription_authorized_payments_invoice_status_check
    check (char_length(trim(invoice_status)) between 1 and 60),
  constraint subscription_authorized_payments_payment_status_check
    check (
      payment_status is null or payment_status in (
        'created', 'pending', 'approved', 'authorized', 'in_process',
        'in_mediation', 'rejected', 'cancelled', 'refunded', 'charged_back'
      )
    ),
  constraint subscription_authorized_payments_status_detail_check
    check (payment_status_detail is null or char_length(payment_status_detail) <= 300),
  constraint subscription_authorized_payments_payment_method_check
    check (payment_method is null or payment_method in ('pix', 'cash', 'bank_transfer', 'card', 'other')),
  constraint subscription_authorized_payments_conflict_code_check
    check (conflict_code is null or char_length(conflict_code) <= 120),
  unique (provider, provider_authorized_payment_id)
);

create unique index subscription_authorized_payments_provider_payment_idx
  on public.subscription_authorized_payments (provider, provider_payment_id)
  where provider_payment_id is not null;

create index subscription_authorized_payments_subscription_idx
  on public.subscription_authorized_payments (provider_subscription_id, debit_date desc);

create index subscription_authorized_payments_student_month_idx
  on public.subscription_authorized_payments (subject_ref, reference_month desc);

create index subscription_authorized_payments_status_idx
  on public.subscription_authorized_payments (payment_status, updated_at desc);

create or replace function public.set_subscription_authorized_payment_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.preserve_financial_subject_ref()
returns trigger
language plpgsql
set search_path = 'public', 'pg_temp'
as $$
begin
  if new.student_id is not null then
    new.subject_ref := new.student_id;
  elsif new.subject_ref is null then
    raise exception 'subject_ref é obrigatório para registros financeiros.';
  end if;
  return new;
end;
$$;

revoke all on function public.preserve_financial_subject_ref()
  from public, anon, authenticated;
grant execute on function public.preserve_financial_subject_ref()
  to service_role;

create trigger subscription_authorized_payments_subject_ref
before insert or update of student_id, subject_ref
on public.subscription_authorized_payments
for each row execute function public.preserve_financial_subject_ref();

create trigger subscription_authorized_payments_set_updated_at
before update on public.subscription_authorized_payments
for each row execute function public.set_subscription_authorized_payment_updated_at();

alter table public.subscription_authorized_payments enable row level security;

revoke all privileges on table public.subscription_authorized_payments from public, anon, authenticated;
grant select, insert, update, delete on table public.subscription_authorized_payments to service_role;

revoke all on function public.set_subscription_authorized_payment_updated_at()
  from public, anon, authenticated;
grant execute on function public.set_subscription_authorized_payment_updated_at()
  to service_role;

create or replace function public.process_mercado_pago_subscription_invoice(
  target_subscription_id uuid,
  target_provider_authorized_payment_id text,
  target_provider_subscription_id text,
  target_provider_payment_id text,
  target_invoice_status text,
  target_payment_status text,
  target_status_detail text,
  target_amount numeric,
  target_currency_id text,
  target_payment_method text,
  target_live_mode boolean,
  target_debit_date timestamptz,
  target_provider_created_at timestamptz,
  target_provider_updated_at timestamptz,
  target_approved_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  subscription_row public.student_subscriptions%rowtype;
  invoice_row public.subscription_authorized_payments%rowtype;
  tuition_row public.monthly_tuition%rowtype;
  normalized_invoice_id text := trim(coalesce(target_provider_authorized_payment_id, ''));
  normalized_subscription_id text := trim(coalesce(target_provider_subscription_id, ''));
  normalized_payment_id text := nullif(trim(coalesce(target_provider_payment_id, '')), '');
  normalized_invoice_status text := lower(trim(coalesce(target_invoice_status, '')));
  normalized_payment_status text := nullif(lower(trim(coalesce(target_payment_status, ''))), '');
  normalized_status_detail text := nullif(left(trim(coalesce(target_status_detail, '')), 300), '');
  normalized_currency text := upper(trim(coalesce(target_currency_id, '')));
  normalized_method text := nullif(lower(trim(coalesce(target_payment_method, ''))), '');
  reference_month date;
  calculated_due_date date;
  payment_was_applied boolean := false;
  payment_was_reversed boolean := false;
  payment_was_reinstated boolean := false;
  duplicate_payment_detected boolean := false;
  conflict text := null;
  affected_count integer := 0;
begin
  if normalized_invoice_id = '' or length(normalized_invoice_id) > 128 then
    raise exception 'Identificador de fatura recorrente inválido.';
  end if;

  if normalized_subscription_id = '' or length(normalized_subscription_id) > 128 then
    raise exception 'Identificador de assinatura inválido.';
  end if;

  if normalized_payment_id is not null and length(normalized_payment_id) > 128 then
    raise exception 'Identificador de pagamento inválido.';
  end if;

  if normalized_invoice_status = '' or length(normalized_invoice_status) > 60 then
    raise exception 'Status de fatura inválido.';
  end if;

  if normalized_payment_status is not null and normalized_payment_status not in (
    'created', 'pending', 'approved', 'authorized', 'in_process',
    'in_mediation', 'rejected', 'cancelled', 'refunded', 'charged_back'
  ) then
    raise exception 'Status de pagamento inválido.';
  end if;

  if normalized_payment_status = 'approved' and normalized_payment_id is null then
    raise exception 'Pagamento aprovado sem identificador do provedor.';
  end if;

  if normalized_method is not null and normalized_method not in ('pix', 'cash', 'bank_transfer', 'card', 'other') then
    raise exception 'Forma de pagamento inválida.';
  end if;

  if target_debit_date is null then
    raise exception 'Data de débito da fatura é obrigatória.';
  end if;

  if normalized_currency <> 'BRL' then
    raise exception 'Moeda da assinatura incompatível.';
  end if;

  select *
  into subscription_row
  from public.student_subscriptions subscription
  where subscription.id = target_subscription_id
    and subscription.provider = 'mercado_pago'
  for update;

  if not found then
    raise exception 'Assinatura local não encontrada.';
  end if;

  if subscription_row.provider_subscription_id is null
     or subscription_row.provider_subscription_id <> normalized_subscription_id then
    raise exception 'Fatura vinculada a outra assinatura.';
  end if;

  if round(target_amount, 2) is distinct from round(subscription_row.amount, 2) then
    raise exception 'Valor da fatura não corresponde à assinatura.';
  end if;

  reference_month := date_trunc(
    'month',
    target_debit_date at time zone 'America/Sao_Paulo'
  )::date;

  if reference_month < date_trunc('month', subscription_row.first_charge_date::timestamp)::date then
    raise exception 'Fatura anterior ao primeiro ciclo autorizado.';
  end if;

  calculated_due_date := make_date(
    extract(year from reference_month)::integer,
    extract(month from reference_month)::integer,
    least(
      subscription_row.due_day::integer,
      extract(day from (
        date_trunc('month', reference_month::timestamp)
        + interval '1 month - 1 day'
      ))::integer
    )
  );

  select *
  into invoice_row
  from public.subscription_authorized_payments invoice
  where invoice.provider = 'mercado_pago'
    and invoice.provider_authorized_payment_id = normalized_invoice_id
  for update;

  if found then
    if invoice_row.subscription_id is not null
       and invoice_row.subscription_id <> subscription_row.id then
      raise exception 'Fatura já vinculada a outra assinatura.';
    end if;

    if invoice_row.provider_subscription_id <> normalized_subscription_id
       or round(invoice_row.amount, 2) is distinct from round(target_amount, 2)
       or invoice_row.reference_month <> reference_month then
      raise exception 'Fatura recorrente incompatível com o registro existente.';
    end if;

    if invoice_row.provider_payment_id is not null
       and normalized_payment_id is not null
       and invoice_row.provider_payment_id <> normalized_payment_id then
      raise exception 'Fatura já vinculada a outro pagamento.';
    end if;

    update public.subscription_authorized_payments
    set
      subscription_id = subscription_row.id,
      student_id = subscription_row.student_id,
      provider_payment_id = coalesce(provider_payment_id, normalized_payment_id),
      debit_date = target_debit_date,
      invoice_status = normalized_invoice_status,
      payment_status = normalized_payment_status,
      payment_status_detail = normalized_status_detail,
      payment_method = normalized_method,
      live_mode = target_live_mode,
      provider_created_at = coalesce(provider_created_at, target_provider_created_at),
      provider_updated_at = coalesce(target_provider_updated_at, now()),
      approved_at = coalesce(target_approved_at, approved_at),
      conflict_code = null
    where id = invoice_row.id
    returning * into invoice_row;
  else
    insert into public.subscription_authorized_payments (
      subscription_id,
      student_id,
      subject_ref,
      provider,
      provider_authorized_payment_id,
      provider_subscription_id,
      provider_payment_id,
      reference_month,
      debit_date,
      amount,
      currency_id,
      invoice_status,
      payment_status,
      payment_status_detail,
      payment_method,
      live_mode,
      provider_created_at,
      provider_updated_at,
      approved_at
    )
    values (
      subscription_row.id,
      subscription_row.student_id,
      subscription_row.student_id,
      'mercado_pago',
      normalized_invoice_id,
      normalized_subscription_id,
      normalized_payment_id,
      reference_month,
      target_debit_date,
      round(target_amount, 2),
      normalized_currency,
      normalized_invoice_status,
      normalized_payment_status,
      normalized_status_detail,
      normalized_method,
      target_live_mode,
      target_provider_created_at,
      coalesce(target_provider_updated_at, now()),
      target_approved_at
    )
    returning * into invoice_row;
  end if;

  insert into public.monthly_tuition (
    student_id,
    reference_month,
    due_date,
    amount_due,
    created_by,
    updated_by
  )
  values (
    subscription_row.student_id,
    reference_month,
    calculated_due_date,
    round(target_amount, 2),
    null,
    null
  )
  on conflict (student_id, reference_month) do nothing;

  select *
  into tuition_row
  from public.monthly_tuition tuition
  where tuition.student_id = subscription_row.student_id
    and tuition.reference_month = reference_month
  for update;

  if not found then
    raise exception 'Mensalidade do ciclo recorrente não pôde ser criada.';
  end if;

  update public.subscription_authorized_payments
  set tuition_id = tuition_row.id
  where id = invoice_row.id
  returning * into invoice_row;

  if round(tuition_row.amount_due, 2) is distinct from round(target_amount, 2) then
    conflict := 'tuition_amount_mismatch';
  elsif tuition_row.is_exempt and normalized_payment_status = 'approved' then
    conflict := 'tuition_exempt';
  elsif normalized_payment_status = 'approved' then
    duplicate_payment_detected := tuition_row.payment_date is not null
      and not (
        tuition_row.payment_provider = 'mercado_pago'
        and tuition_row.provider_payment_id = normalized_payment_id
      );

    if duplicate_payment_detected then
      conflict := 'duplicate_payment';

      if not exists (
        select 1
        from public.monthly_tuition_events event
        where event.tuition_id = tuition_row.id
          and event.action = 'duplicate_payment_detected'
          and event.details ->> 'provider_payment_id' = normalized_payment_id
      ) then
        insert into public.monthly_tuition_events (tuition_id, action, actor_id, details)
        values (
          tuition_row.id,
          'duplicate_payment_detected',
          null,
          jsonb_build_object(
            'source', 'mercado_pago_subscription',
            'subscription_id', subscription_row.id,
            'authorized_payment_id', normalized_invoice_id,
            'provider_payment_id', normalized_payment_id,
            'amount', round(target_amount, 2),
            'existing_payment_provider', tuition_row.payment_provider,
            'existing_provider_payment_id', tuition_row.provider_payment_id,
            'existing_payment_method', tuition_row.payment_method,
            'existing_payment_date', tuition_row.payment_date
          )
        );
      end if;
    else
      payment_was_reinstated := invoice_row.reversed_at is not null;

      if tuition_row.payment_date is null then
        update public.monthly_tuition
        set
          payment_date = coalesce(target_approved_at::date, target_debit_date::date),
          amount_paid = round(target_amount, 2),
          payment_method = coalesce(normalized_method, 'card'),
          payment_notes = 'Mercado Pago · assinatura · pagamento ' || normalized_payment_id,
          payment_provider = 'mercado_pago',
          provider_payment_id = normalized_payment_id,
          updated_at = now(),
          updated_by = null
        where id = tuition_row.id
          and payment_date is null
          and not is_exempt;

        get diagnostics affected_count = row_count;
        payment_was_applied := affected_count > 0;
      else
        payment_was_applied := tuition_row.payment_provider = 'mercado_pago'
          and tuition_row.provider_payment_id = normalized_payment_id;
      end if;

      if payment_was_applied then
        if payment_was_reinstated then
          if not exists (
            select 1
            from public.monthly_tuition_events event
            where event.tuition_id = tuition_row.id
              and event.action = 'payment_reinstated'
              and event.details ->> 'provider_payment_id' = normalized_payment_id
          ) then
            insert into public.monthly_tuition_events (tuition_id, action, actor_id, details)
            values (
              tuition_row.id,
              'payment_reinstated',
              null,
              jsonb_build_object(
                'source', 'mercado_pago_subscription',
                'subscription_id', subscription_row.id,
                'authorized_payment_id', normalized_invoice_id,
                'provider_payment_id', normalized_payment_id,
                'amount_paid', round(target_amount, 2)
              )
            );
          end if;
        elsif not exists (
          select 1
          from public.monthly_tuition_events event
          where event.tuition_id = tuition_row.id
            and event.action = 'payment_recorded'
            and event.details ->> 'provider_payment_id' = normalized_payment_id
        ) then
          insert into public.monthly_tuition_events (tuition_id, action, actor_id, details)
          values (
            tuition_row.id,
            'payment_recorded',
            null,
            jsonb_build_object(
              'source', 'mercado_pago_subscription',
              'subscription_id', subscription_row.id,
              'authorized_payment_id', normalized_invoice_id,
              'provider_payment_id', normalized_payment_id,
              'amount_paid', round(target_amount, 2),
              'payment_method', coalesce(normalized_method, 'card'),
              'status_detail', normalized_status_detail
            )
          );
        end if;

        update public.subscription_authorized_payments
        set
          applied_at = coalesce(applied_at, coalesce(target_approved_at, now())),
          reversed_at = null,
          conflict_code = null
        where id = invoice_row.id
        returning * into invoice_row;
      end if;
    end if;
  elsif normalized_payment_status in ('cancelled', 'refunded', 'charged_back')
        and invoice_row.applied_at is not null
        and invoice_row.reversed_at is null
        and normalized_payment_id is not null then
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
      and provider_payment_id = normalized_payment_id;

    get diagnostics affected_count = row_count;
    payment_was_reversed := affected_count > 0;

    if payment_was_reversed then
      if not exists (
        select 1
        from public.monthly_tuition_events event
        where event.tuition_id = tuition_row.id
          and event.action = 'payment_reversed'
          and event.details ->> 'provider_payment_id' = normalized_payment_id
      ) then
        insert into public.monthly_tuition_events (tuition_id, action, actor_id, details)
        values (
          tuition_row.id,
          'payment_reversed',
          null,
          jsonb_build_object(
            'source', 'mercado_pago_subscription',
            'subscription_id', subscription_row.id,
            'authorized_payment_id', normalized_invoice_id,
            'provider_payment_id', normalized_payment_id,
            'provider_status', normalized_payment_status,
            'status_detail', normalized_status_detail
          )
        );
      end if;

      update public.subscription_authorized_payments
      set reversed_at = now()
      where id = invoice_row.id
      returning * into invoice_row;
    end if;
  end if;

  if conflict is not null then
    update public.subscription_authorized_payments
    set conflict_code = conflict
    where id = invoice_row.id
    returning * into invoice_row;
  end if;

  return jsonb_build_object(
    'ok', true,
    'subscription_id', subscription_row.id,
    'authorized_payment_id', normalized_invoice_id,
    'provider_payment_id', normalized_payment_id,
    'tuition_id', tuition_row.id,
    'reference_month', reference_month,
    'payment_status', normalized_payment_status,
    'payment_applied', payment_was_applied,
    'payment_reversed', payment_was_reversed,
    'payment_reinstated', payment_was_reinstated and payment_was_applied,
    'duplicate_payment_detected', duplicate_payment_detected,
    'conflict_code', conflict
  );
end;
$$;

revoke all on function public.process_mercado_pago_subscription_invoice(
  uuid, text, text, text, text, text, text, numeric, text, text, boolean,
  timestamptz, timestamptz, timestamptz, timestamptz
) from public, anon, authenticated;

grant execute on function public.process_mercado_pago_subscription_invoice(
  uuid, text, text, text, text, text, text, numeric, text, text, boolean,
  timestamptz, timestamptz, timestamptz, timestamptz
) to service_role;
