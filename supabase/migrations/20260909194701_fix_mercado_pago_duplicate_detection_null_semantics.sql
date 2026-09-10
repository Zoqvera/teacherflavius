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
  duplicate_payment_detected boolean := false;
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
    'payment_reversed', payment_was_reversed,
    'duplicate_payment_detected', duplicate_payment_detected
  );
end;
$$;

revoke all on function public.process_mercado_pago_payment(
  uuid, text, text, text, numeric, text, boolean, timestamptz, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.process_mercado_pago_payment(
  uuid, text, text, text, numeric, text, boolean, timestamptz, timestamptz, timestamptz
) to service_role;
