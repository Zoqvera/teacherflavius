alter table public.monthly_tuition
  add column if not exists is_exempt boolean not null default false,
  add column if not exists exempted_at timestamptz,
  add column if not exists exemption_notes text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.monthly_tuition'::regclass
      and conname = 'monthly_tuition_exemption_state_check'
  ) then
    alter table public.monthly_tuition
      add constraint monthly_tuition_exemption_state_check
      check (
        not is_exempt
        or (
          payment_date is null
          and amount_paid is null
          and payment_method is null
          and payment_provider is null
          and provider_payment_id is null
        )
      );
  end if;
end;
$$;

alter table public.monthly_tuition_events
  drop constraint if exists monthly_tuition_events_action_check;

alter table public.monthly_tuition_events
  add constraint monthly_tuition_events_action_check
  check (action in (
    'payment_recorded',
    'payment_reversed',
    'tuition_exempted',
    'tuition_exemption_reversed'
  ));

create or replace function public.generate_monthly_tuition(target_reference_month date)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  normalized_reference_month date;
  affected_count integer := 0;
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso negado: usuário não cadastrado como administrador.';
  end if;

  normalized_reference_month := date_trunc(
    'month',
    coalesce(target_reference_month, current_date)
  )::date;

  insert into public.monthly_tuition (
    student_id,
    reference_month,
    due_date,
    amount_due,
    created_by,
    updated_by
  )
  select
    s.student_id,
    generated_month.reference_month::date,
    make_date(
      extract(year from generated_month.reference_month)::integer,
      extract(month from generated_month.reference_month)::integer,
      least(
        s.due_day::integer,
        extract(
          day from (
            date_trunc('month', generated_month.reference_month)
            + interval '1 month - 1 day'
          )
        )::integer
      )
    ),
    s.monthly_fee,
    auth.uid(),
    auth.uid()
  from public.student_billing_settings s
  join public.profiles p on p.id = s.student_id
  cross join lateral generate_series(
    s.billing_start_month::timestamp,
    normalized_reference_month::timestamp,
    interval '1 month'
  ) as generated_month(reference_month)
  where s.active = true
    and s.billing_start_month <= normalized_reference_month
    and coalesce(p.enrolled, false) = true
    and coalesce(p.archived, false) = false
  on conflict (student_id, reference_month) do update
  set
    due_date = excluded.due_date,
    amount_due = excluded.amount_due,
    updated_at = now(),
    updated_by = auth.uid()
  where public.monthly_tuition.payment_date is null
    and not public.monthly_tuition.is_exempt
    and (
      public.monthly_tuition.due_date is distinct from excluded.due_date
      or public.monthly_tuition.amount_due is distinct from excluded.amount_due
    );

  get diagnostics affected_count = row_count;
  return affected_count;
end;
$function$;

create or replace function public.get_teacher_monthly_tuition(target_reference_month date)
returns table(
  tuition_id uuid,
  student_id uuid,
  student_name text,
  student_email text,
  reference_month date,
  due_date date,
  amount_due numeric,
  payment_date date,
  amount_paid numeric,
  payment_method text,
  payment_notes text,
  payment_status text
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  normalized_reference_month date;
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso negado: usuário não cadastrado como administrador.';
  end if;

  normalized_reference_month := date_trunc(
    'month',
    coalesce(target_reference_month, current_date)
  )::date;

  return query
  select
    mt.id,
    mt.student_id,
    coalesce(p.name, '')::text,
    coalesce(p.email, '')::text,
    mt.reference_month,
    mt.due_date,
    mt.amount_due,
    mt.payment_date,
    mt.amount_paid,
    mt.payment_method,
    case
      when mt.is_exempt then coalesce(mt.exemption_notes, '')
      else coalesce(mt.payment_notes, '')
    end::text,
    case
      when mt.is_exempt then 'exempt'
      when mt.payment_date is not null then 'paid'
      when mt.due_date < current_date then 'overdue'
      when mt.due_date <= current_date + 7 then 'due_soon'
      else 'open'
    end::text
  from public.monthly_tuition mt
  join public.profiles p on p.id = mt.student_id
  where coalesce(p.archived, false) = false
    and (
      mt.reference_month = normalized_reference_month
      or (
        mt.reference_month < normalized_reference_month
        and mt.payment_date is null
        and not mt.is_exempt
      )
    )
  order by mt.due_date asc, p.name asc nulls last;
end;
$function$;

create or replace function public.get_teacher_student_tuition_history(target_student_id uuid)
returns table(
  tuition_id uuid,
  reference_month date,
  due_date date,
  amount_due numeric,
  payment_date date,
  amount_paid numeric,
  payment_method text,
  payment_notes text,
  payment_status text
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso negado: usuário não cadastrado como administrador.';
  end if;

  return query
  select
    mt.id,
    mt.reference_month,
    mt.due_date,
    mt.amount_due,
    mt.payment_date,
    mt.amount_paid,
    mt.payment_method,
    case
      when mt.is_exempt then coalesce(mt.exemption_notes, '')
      else coalesce(mt.payment_notes, '')
    end::text,
    case
      when mt.is_exempt then 'exempt'
      when mt.payment_date is not null then 'paid'
      when mt.due_date < current_date then 'overdue'
      when mt.due_date <= current_date + 7 then 'due_soon'
      else 'open'
    end::text
  from public.monthly_tuition mt
  where mt.student_id = target_student_id
  order by mt.reference_month desc;
end;
$function$;

create or replace function public.get_my_pending_tuitions()
returns table(
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
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  current_user_id uuid := auth.uid();
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
      when mt.due_date < current_date then 'overdue'
      when mt.due_date = current_date then 'due_today'
      when mt.due_date = current_date + 1 then 'due_tomorrow'
      when mt.due_date = current_date + 2 then 'due_in_two_days'
      when mt.due_date <= current_date + 7 then 'due_soon'
      else 'open'
    end::text,
    latest_attempt.id,
    latest_attempt.provider_payment_id,
    latest_attempt.status,
    latest_attempt.status_detail
  from public.monthly_tuition mt
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
    and mt.reference_month <= date_trunc('month', current_date)::date
  order by mt.due_date asc, mt.reference_month asc;
end;
$function$;

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
set search_path to 'public', 'pg_temp'
as $function$
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

  if target_row.is_exempt then
    raise exception 'Mensalidade isenta. Remova a isenção antes de registrar um pagamento.';
  end if;

  if target_row.payment_date is not null then
    raise exception 'Esta mensalidade já está paga.';
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
$function$;

create or replace function public.mark_tuition_exempt(
  target_tuition_id uuid,
  target_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  target_row public.monthly_tuition%rowtype;
  normalized_reason text := nullif(trim(coalesce(target_reason, '')), '');
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

  if target_row.is_exempt then
    return jsonb_build_object('ok', true, 'tuition_id', target_tuition_id, 'already_exempt', true);
  end if;

  if target_row.payment_date is not null then
    raise exception 'Não é possível isentar uma mensalidade que já está paga.';
  end if;

  if exists (
    select 1
    from public.tuition_payment_attempts attempt
    where attempt.tuition_id = target_tuition_id
      and (
        attempt.status in ('pending', 'approved', 'authorized', 'in_process', 'in_mediation')
        or (
          attempt.status = 'created'
          and attempt.created_at >= now() - interval '15 minutes'
        )
      )
  ) then
    raise exception 'Existe um pagamento em processamento para esta mensalidade. Aguarde a conclusão antes de aplicar a isenção.';
  end if;

  update public.monthly_tuition
  set
    is_exempt = true,
    exempted_at = now(),
    exemption_notes = normalized_reason,
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
    'tuition_exempted',
    auth.uid(),
    jsonb_build_object(
      'amount_due', target_row.amount_due,
      'reason', normalized_reason
    )
  );

  return jsonb_build_object('ok', true, 'tuition_id', target_tuition_id, 'status', 'exempt');
end;
$function$;

create or replace function public.reverse_tuition_exemption(
  target_tuition_id uuid,
  target_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  target_row public.monthly_tuition%rowtype;
  normalized_reason text := nullif(trim(coalesce(target_reason, '')), '');
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

  if not target_row.is_exempt then
    raise exception 'Esta mensalidade não está isenta.';
  end if;

  update public.monthly_tuition
  set
    is_exempt = false,
    exempted_at = null,
    exemption_notes = null,
    updated_at = now(),
    updated_by = auth.uid()
  where id = target_tuition_id;

  insert into public.monthly_tuition_events (tuition_id, action, actor_id, details)
  values (
    target_tuition_id,
    'tuition_exemption_reversed',
    auth.uid(),
    jsonb_build_object(
      'previous_reason', target_row.exemption_notes,
      'reason', normalized_reason
    )
  );

  return jsonb_build_object('ok', true, 'tuition_id', target_tuition_id, 'status', 'open');
end;
$function$;

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
set search_path to 'public', 'pg_temp'
as $function$
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
$function$;

revoke all on function public.mark_tuition_exempt(uuid, text) from public;
revoke all on function public.reverse_tuition_exemption(uuid, text) from public;
grant execute on function public.mark_tuition_exempt(uuid, text) to authenticated;
grant execute on function public.reverse_tuition_exemption(uuid, text) to authenticated;
