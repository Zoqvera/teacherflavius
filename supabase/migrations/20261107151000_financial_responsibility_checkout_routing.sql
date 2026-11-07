-- Stage 3: route existing provider reconciliation safely and expose a
-- server-authoritative quote for the authenticated payer.
create or replace function public.get_financial_responsibility_payment_quote_internal(
  target_payer_id uuid, target_tuition_id uuid
)
returns jsonb language plpgsql stable security definer set search_path = ''
as $function$
begin
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role'
     and session_user <> 'postgres' then
    raise exception 'Acesso exclusivo do servidor.' using errcode = '42501';
  end if;
  return private.quote_financial_responsibility_payment(target_payer_id, target_tuition_id);
end;
$function$;

create or replace function public.get_my_financial_responsibility_coverage()
returns jsonb language plpgsql stable security definer set search_path = ''
as $function$
declare
  coverage jsonb;
  current_reference date := date_trunc('month', timezone('America/Sao_Paulo', now())::date)::date;
begin
  if auth.uid() is null then
    raise exception 'Autenticação obrigatória.' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'payer_name', payer.name,
    'first_reference_month', link.first_reference_month,
    'first_uncovered_month', link.first_uncovered_month
  ) into coverage
  from private.student_financial_responsibilities link
  join public.profiles payer on payer.id = link.payer_student_id
  where link.beneficiary_student_id = auth.uid()
    and link.state <> 'cancelled'
    and link.first_reference_month <= current_reference
    and (link.first_uncovered_month is null or current_reference < link.first_uncovered_month)
  order by link.created_at desc
  limit 1;
  return coverage;
end;
$function$;

-- Prevent the sponsored student's direct checkout even if an old client
-- attempts to bypass the pending-invoices RPC.
create or replace function private.prevent_sponsored_direct_checkout()
returns trigger language plpgsql security definer set search_path = ''
as $function$
declare
  target_month date;
begin
  select tuition.reference_month into target_month
  from public.monthly_tuition tuition
  where tuition.id = new.tuition_id
    and tuition.student_id = new.student_id;
  if target_month is null then return new; end if;

  if exists (
    select 1 from private.student_financial_responsibilities link
    where link.beneficiary_student_id = new.student_id
      and link.state <> 'cancelled'
      and link.first_reference_month <= target_month
      and (link.first_uncovered_month is null or target_month < link.first_uncovered_month)
  ) then
    raise exception 'Esta mensalidade deve ser paga pelo responsável financeiro.';
  end if;
  return new;
end;
$function$;

drop trigger if exists prevent_sponsored_direct_checkout on public.tuition_payment_attempts;
create trigger prevent_sponsored_direct_checkout before insert
  on public.tuition_payment_attempts for each row
  execute function private.prevent_sponsored_direct_checkout();

-- A provider-managed recurring subscription and a combined one-off charge
-- must never be simultaneously active for the same person.
create or replace function private.protect_sponsored_subscription_collision()
returns trigger language plpgsql security definer set search_path = ''
as $function$
begin
  if tg_table_name = 'student_financial_responsibilities' then
    if new.state = 'active' and exists (
      select 1 from public.student_subscriptions subscription
      where subscription.student_id in (new.payer_student_id,new.beneficiary_student_id)
        and subscription.status not in ('draft','paused','cancelled','rejected')
    ) then
      raise exception 'Suspenda as assinaturas recorrentes existentes antes de vincular o responsável financeiro.';
    end if;
  else
    if new.status not in ('draft','paused','cancelled','rejected') and exists (
      select 1 from private.student_financial_responsibilities link
      where link.state = 'active'
        and new.student_id in (link.payer_student_id,link.beneficiary_student_id)
    ) then
      raise exception 'A assinatura recorrente é incompatível com uma responsabilidade financeira ativa.';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists protect_sponsored_subscription_collision
  on private.student_financial_responsibilities;
create trigger protect_sponsored_subscription_collision
  before insert or update on private.student_financial_responsibilities
  for each row execute function private.protect_sponsored_subscription_collision();

drop trigger if exists protect_sponsored_subscription_collision
  on public.student_subscriptions;
create trigger protect_sponsored_subscription_collision
  before insert or update on public.student_subscriptions
  for each row execute function private.protect_sponsored_subscription_collision();

-- Service-only quote and reconciliation gateways. No direct table grants.
revoke all on function public.get_financial_responsibility_payment_quote_internal(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_financial_responsibility_payment_quote_internal(uuid,uuid) to service_role;
revoke all on function public.get_my_financial_responsibility_coverage() from public,anon;
grant execute on function public.get_my_financial_responsibility_coverage() to authenticated;
revoke all on function private.prevent_sponsored_direct_checkout() from public,anon,authenticated;
revoke all on function private.protect_sponsored_subscription_collision() from public,anon,authenticated;

-- Only service_role may run the settlement RPC; preserve existing grants on
-- process_mercado_pago_payment without exposing new privileged operations.


-- RPC: do not expose covered invoices in the beneficiary account.
CREATE OR REPLACE FUNCTION public.get_my_pending_tuitions()
 RETURNS TABLE(tuition_id uuid, reference_month date, due_date date, amount_due numeric, payment_status text, attempt_id uuid, provider_payment_id text, attempt_status text, attempt_status_detail text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  current_user_id uuid := auth.uid();
  local_today date := timezone('America/Sao_Paulo', now())::date;
begin
  if current_user_id is null then
    raise exception 'É necessário entrar na conta para consultar mensalidades.';
  end if;

  return query
  select
    tuition.id,
    tuition.reference_month,
    availability.effective_due_date,
    tuition.amount_due,
    case
      when availability.effective_due_date < local_today then 'overdue'
      when availability.effective_due_date = local_today then 'due_today'
      when availability.effective_due_date = local_today + 1 then 'due_tomorrow'
      when availability.effective_due_date = local_today + 2 then 'due_in_two_days'
      when availability.effective_due_date <= local_today + 7 then 'due_soon'
      else 'open'
    end::text,
    latest_attempt.id,
    latest_attempt.provider_payment_id,
    latest_attempt.status,
    latest_attempt.status_detail
  from public.monthly_tuition tuition
  cross join lateral private.get_tuition_student_availability(tuition.id) availability
  left join lateral (
    select
      attempt.id,
      attempt.provider_payment_id,
      attempt.status,
      attempt.status_detail
    from public.tuition_payment_attempts attempt
    where attempt.tuition_id = tuition.id
      and attempt.student_id = current_user_id
    order by attempt.created_at desc
    limit 1
  ) latest_attempt on true
  where tuition.student_id = current_user_id
    and tuition.payment_date is null
    and not tuition.is_exempt
    and availability.available_on is not null
    and availability.available_on <= local_today
    and not exists (
      select 1 from private.student_financial_responsibilities link
      where link.beneficiary_student_id = current_user_id
        and link.state <> 'cancelled'
        and link.first_reference_month <= tuition.reference_month
        and (link.first_uncovered_month is null
             or tuition.reference_month < link.first_uncovered_month)
    )
  order by availability.effective_due_date asc, tuition.reference_month asc;
end;
$function$;

-- Gateway: retain ordinary payment behavior and route sponsored payments.
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

  -- Consolidated invoices are settled atomically, through a separate
  -- server-only function. Ordinary payments continue through legacy rules.
  if exists (
    select 1 from private.financial_responsibility_payment_items group_item
    where group_item.attempt_id = target_attempt_id
  ) then
    return public.process_financial_responsibility_payment(
      target_attempt_id, target_provider_payment_id, target_status,
      target_status_detail, target_amount, target_payment_method,
      target_live_mode, target_provider_created_at,
      target_provider_updated_at, target_approved_at
    );
  end if;

  select *
  into tuition_row
  from public.monthly_tuition tuition
  where tuition.id = attempt_row.tuition_id
    and (
      tuition.student_id = attempt_row.student_id
      or (
        tuition.student_id is null
        and attempt_row.student_id is null
        and attempt_row.subject_ref is not null
        and tuition.subject_ref = attempt_row.subject_ref
      )
    )
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
