-- Complete quoted-amount and settlement wiring. Activation is disabled by default.
-- Never backdate contracted charges or modify existing Mercado Pago amounts.

create table if not exists private.late_payment_charge_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
revoke all on private.late_payment_charge_settings from public, anon, authenticated;
grant select, update on private.late_payment_charge_settings to service_role;
alter table private.late_payment_charge_settings enable row level security;
insert into private.late_payment_charge_settings(singleton, enabled)
values (true, false)
on conflict (singleton) do nothing;

alter table public.tuition_payment_attempts
  add column if not exists late_principal_amount numeric(12,2),
  add column if not exists late_fine_amount numeric(12,2),
  add column if not exists late_interest_amount numeric(12,2),
  add column if not exists late_policy_version text;
alter table public.tuition_payment_attempts
  add constraint tuition_payment_attempt_late_breakdown_check check (
    late_principal_amount is null
    or (
      late_principal_amount > 0
      and late_fine_amount is not null
      and late_interest_amount is not null
      and late_fine_amount >= 0
      and late_interest_amount >= 0
      and late_policy_version = '2026-10-20-v1'
      and round(amount, 2) = round(
        late_principal_amount + late_fine_amount + late_interest_amount, 2
      )
    )
  );

alter table public.monthly_tuition
  add column if not exists late_fine_paid numeric(12,2),
  add column if not exists late_interest_paid numeric(12,2);
alter table public.monthly_tuition
  add constraint monthly_tuition_late_fine_paid_check
    check (late_fine_paid is null or late_fine_paid >= 0);
alter table public.monthly_tuition
  add constraint monthly_tuition_late_interest_paid_check
    check (late_interest_paid is null or late_interest_paid >= 0);

create or replace function private.get_tuition_late_payment_quote(
  target_tuition_id uuid,
  quote_date date
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $function$
declare
  target_tuition public.monthly_tuition%rowtype;
  agreement_date date;
  accepted_at_value timestamptz;
  attempt_amount numeric;
  attempt_fine numeric;
  attempt_interest numeric;
  charges_enabled boolean := false;
  components jsonb;
begin
  select *
  into target_tuition
  from public.monthly_tuition t
  where t.id = target_tuition_id;

  if not found then
    raise exception 'Mensalidade não encontrada.';
  end if;
  if quote_date is null then
    raise exception 'Data da cotação obrigatória.';
  end if;

  select s.enabled into charges_enabled
  from private.late_payment_charge_settings s
  where s.singleton = true;
  charges_enabled := coalesce(charges_enabled, false);

  -- Preserve the immutable amount of a payment already sent to Mercado Pago.
  select a.amount, coalesce(a.late_fine_amount, 0), coalesce(a.late_interest_amount, 0)
  into attempt_amount, attempt_fine, attempt_interest
  from public.tuition_payment_attempts a
  where a.tuition_id = target_tuition_id
    and a.provider_payment_id is not null
    and a.status in ('created','pending','authorized','in_process','in_mediation')
  order by a.created_at desc
  limit 1;

  select p.accepted_at
  into accepted_at_value
  from private.student_policy_acceptances p
  where p.student_id = target_tuition.student_id
    and p.policy_key = 'tuition-late-payment'
    and p.policy_version = '2026-10-20-v1';

  agreement_date := (accepted_at_value at time zone 'America/Sao_Paulo')::date;

  if not charges_enabled or target_tuition.payment_date is not null
     or coalesce(target_tuition.is_exempt, false)
     or accepted_at_value is null then
    components := private.calculate_late_payment_components(
      target_tuition.amount_due, target_tuition.due_date,
      quote_date, quote_date
    );
  else
    components := private.calculate_late_payment_components(
      target_tuition.amount_due, target_tuition.due_date,
      agreement_date, quote_date
    );
  end if;

  -- The preview cannot override a frozen third-party transaction.
  if attempt_amount is not null then
    components := jsonb_build_object(
      'principal_amount', round(target_tuition.amount_due, 2),
      'fine_amount', attempt_fine, 'interest_amount', attempt_interest,
      'total_amount', round(attempt_amount, 2),
      'chargeable_days', 0
    );
  end if;

  return components || jsonb_build_object(
    'tuition_id', target_tuition_id,
    'due_date', target_tuition.due_date,
    'quote_date', quote_date,
    'policy_version', '2026-10-20-v1',
    'terms_accepted_at', accepted_at_value,
    'preexisting_attempt', attempt_amount is not null,
    'billing_enabled', charges_enabled,
    'preview_only', not charges_enabled
  );
end;
$function$;


revoke all on function private.get_tuition_late_payment_quote(uuid, date)
  from public, anon, authenticated;
grant execute on function private.get_tuition_late_payment_quote(uuid, date)
  to service_role;

-- Service role is authorized only after the Edge Function independently checks
-- that the tuition belongs to the authenticated account.
create or replace function public.get_checkout_late_tuition_quote(
  target_tuition_id uuid
)
returns jsonb language sql stable security definer
set search_path = ''
as $function$
  select private.get_tuition_late_payment_quote(
    target_tuition_id, timezone('America/Sao_Paulo', now())::date
  );
$function$;
revoke all on function public.get_checkout_late_tuition_quote(uuid)
  from public, anon, authenticated;
grant execute on function public.get_checkout_late_tuition_quote(uuid)
  to service_role;

-- A single source of truth for principal and surcharge recorded on approval.
CREATE OR REPLACE FUNCTION public.process_mercado_pago_payment(target_attempt_id uuid, target_provider_payment_id text, target_status text, target_status_detail text, target_amount numeric, target_payment_method text, target_live_mode boolean, target_provider_created_at timestamp with time zone, target_provider_updated_at timestamp with time zone, target_approved_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  attempt_row public.tuition_payment_attempts%rowtype;
  tuition_row public.monthly_tuition%rowtype;
  normalized_status text := lower(trim(coalesce(target_status, '')));
  normalized_method text := lower(trim(coalesce(target_payment_method, '')));
  normalized_provider_payment_id text := trim(coalesce(target_provider_payment_id, ''));
  affected_count integer := 0;
  payment_was_applied boolean := false;
  payment_was_reversed boolean := false;
  duplicate_payment_detected boolean := false;
  split_is_valid boolean := false;
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

  if tuition_row.is_exempt and normalized_status = 'approved' then
    raise exception 'Mensalidade isenta. O pagamento aprovado não pode ser aplicado automaticamente.';
  end if;

  split_is_valid := private.has_valid_mercado_pago_split(attempt_row.id);
  -- Verify the immutable transaction amount for every status.
  -- A tuition plan may change while an older Pix remains pending; only an
  -- approved transaction may be compared to the current tuition obligation.
  -- Approved outdated amounts must never settle the revised monthly fee.
  if round(target_amount, 2) is distinct from round(attempt_row.amount, 2)
     or (
       normalized_status = 'approved'
       and round(coalesce(attempt_row.late_principal_amount, target_amount), 2)
           is distinct from round(tuition_row.amount_due, 2)
       and not split_is_valid
     )
     or (
       attempt_row.late_principal_amount is not null
       and (
         attempt_row.late_policy_version is distinct from '2026-10-20-v1'
         or round(attempt_row.amount, 2) is distinct from round(
           attempt_row.late_principal_amount
           + coalesce(attempt_row.late_fine_amount, 0)
           + coalesce(attempt_row.late_interest_amount, 0), 2
         )
       )
     ) then
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
    provider_updated_at = coalesce(target_provider_updated_at, now()),
    last_reconciled_at = now(),
    reconciliation_failure_count = 0,
    last_reconciliation_error = null
  where id = attempt_row.id;

  if normalized_status = 'approved' then
    duplicate_payment_detected := tuition_row.payment_date is not null
      and not coalesce(
        tuition_row.payment_provider = 'mercado_pago'
        and tuition_row.provider_payment_id = normalized_provider_payment_id,
        false
      );

    if duplicate_payment_detected then
      if not exists (
        select 1
        from public.monthly_tuition_events event
        where event.tuition_id = tuition_row.id
          and event.action = 'duplicate_payment_detected'
          and event.details ->> 'provider_payment_id' = normalized_provider_payment_id
      ) then
        insert into public.monthly_tuition_events (tuition_id, action, actor_id, details)
        values (
          tuition_row.id,
          'duplicate_payment_detected',
          null,
          jsonb_build_object(
            'source', 'mercado_pago',
            'attempt_id', attempt_row.id,
            'provider_payment_id', normalized_provider_payment_id,
            'amount', round(target_amount, 2),
            'payment_method', normalized_method,
            'existing_payment_provider', tuition_row.payment_provider,
            'existing_provider_payment_id', tuition_row.provider_payment_id,
            'existing_payment_method', tuition_row.payment_method,
            'existing_payment_date', tuition_row.payment_date
          )
        );
      end if;
    else
      update public.monthly_tuition
      set
        payment_date = coalesce(target_approved_at::date, current_date),
        amount_paid = round(target_amount, 2),
        late_fine_paid = coalesce(attempt_row.late_fine_amount, 0),
        late_interest_paid = coalesce(attempt_row.late_interest_amount, 0),
        payment_method = normalized_method,
        payment_notes = 'Mercado Pago · pagamento ' || normalized_provider_payment_id,
        payment_provider = 'mercado_pago',
        provider_payment_id = normalized_provider_payment_id,
        updated_at = now(),
        updated_by = null
      where id = tuition_row.id
        and payment_date is null
        and not is_exempt;

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
            'principal_paid', coalesce(attempt_row.late_principal_amount, round(target_amount, 2)),
            'late_fine_paid', coalesce(attempt_row.late_fine_amount, 0),
            'late_interest_paid', coalesce(attempt_row.late_interest_amount, 0),
            'late_policy_version', attempt_row.late_policy_version,
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
    end if;
  elsif normalized_status in ('cancelled', 'refunded', 'charged_back')
        and attempt_row.applied_at is not null
        and attempt_row.reversed_at is null then
    if split_is_valid then
      update public.monthly_tuition tuition
      set
        payment_date = null,
        amount_paid = null,
        late_fine_paid = null,
        late_interest_paid = null,
        payment_method = null,
        payment_notes = null,
        payment_provider = null,
        provider_payment_id = null,
        updated_at = now(),
        updated_by = null
      from private.mercado_pago_tuition_allocations allocation
      where allocation.attempt_id = attempt_row.id
        and allocation.tuition_id = tuition.id
        and allocation.reversed_at is null
        and tuition.payment_date is not null
        and round(tuition.amount_paid, 2) = round(allocation.allocated_amount, 2)
        and (
          (tuition.id = tuition_row.id
           and tuition.payment_provider = 'mercado_pago'
           and tuition.provider_payment_id = normalized_provider_payment_id)
          or (tuition.id <> tuition_row.id and tuition.payment_provider is null)
        );
      get diagnostics affected_count = row_count;

      if affected_count <> (
        select count(*) from private.mercado_pago_tuition_allocations
        where attempt_id = attempt_row.id and reversed_at is null
      ) then
        raise exception 'O rateio não pôde ser revertido integralmente.';
      end if;

      insert into public.monthly_tuition_events (tuition_id, action, actor_id, details)
      select allocation.tuition_id, 'payment_reversed', null,
        jsonb_build_object('source', 'mercado_pago_split',
          'attempt_id', attempt_row.id,
          'provider_status', normalized_status,
          'allocated_amount', allocation.allocated_amount)
      from private.mercado_pago_tuition_allocations allocation
      where allocation.attempt_id = attempt_row.id
        and allocation.tuition_id <> tuition_row.id
        and allocation.reversed_at is null;

      update private.mercado_pago_tuition_allocations allocation
      set reversed_at = now()
      where allocation.attempt_id = attempt_row.id
        and allocation.reversed_at is null;
    else
      update public.monthly_tuition
      set
        payment_date = null,
        amount_paid = null,
        late_fine_paid = null,
        late_interest_paid = null,
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
    end if;

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
    'payment_reversed', payment_was_reversed,
    'duplicate_payment_detected', duplicate_payment_detected
  );
end;
$function$;


notify pgrst, 'reload schema';
