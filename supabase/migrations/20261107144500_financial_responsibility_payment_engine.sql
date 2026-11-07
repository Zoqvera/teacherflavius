-- Stage 2: isolated quotation and settlement primitives.
-- Existing checkout is intentionally NOT routed here until full integration tests pass.
create table if not exists private.financial_responsibility_payment_items (
  attempt_id uuid not null references public.tuition_payment_attempts(id) on delete cascade,
  tuition_id uuid not null references public.monthly_tuition(id) on delete restrict,
  allocated_amount numeric(10,2) not null check (allocated_amount > 0),
  created_at timestamptz not null default now(),
  reversed_at timestamptz,
  primary key (attempt_id, tuition_id)
);
create index if not exists financial_responsibility_payment_items_tuition_idx
  on private.financial_responsibility_payment_items (tuition_id);
alter table private.financial_responsibility_payment_items enable row level security;
revoke all on private.financial_responsibility_payment_items from anon, authenticated;

create or replace function private.quote_financial_responsibility_payment(
  target_payer_id uuid, target_tuition_id uuid
)
returns jsonb language plpgsql stable security definer set search_path = ''
as $function$
declare
  primary_tuition public.monthly_tuition%rowtype;
  dependent record;
  dependent_tuition public.monthly_tuition%rowtype;
  items jsonb := '[]'::jsonb;
  total numeric(10,2);
begin
  select * into primary_tuition from public.monthly_tuition
  where id = target_tuition_id and student_id = target_payer_id;

  if not found then
    raise exception 'A mensalidade não pertence ao pagante.';
  end if;

  if primary_tuition.payment_date is not null or primary_tuition.is_exempt then
    raise exception 'Esta mensalidade já foi liquidada ou está isenta.';
  end if;

  -- Sponsored students cannot initiate their own payment for a covered month.
  if exists (
    select 1 from private.student_financial_responsibilities link
    where link.beneficiary_student_id = target_payer_id and link.state <> 'cancelled'
      and link.first_reference_month <= primary_tuition.reference_month
      and (link.first_uncovered_month is null
           or primary_tuition.reference_month < link.first_uncovered_month)
  ) then
    raise exception 'Esta mensalidade é paga pelo responsável financeiro.';
  end if;

  total := round(primary_tuition.amount_due, 2);
  items := jsonb_build_array(jsonb_build_object(
    'tuition_id', primary_tuition.id,
    'student_id', target_payer_id,
    'amount', total,
    'role', 'payer'
  ));

  for dependent in
    select link.beneficiary_student_id, profile.name
    from private.student_financial_responsibilities link
    join public.profiles profile on profile.id = link.beneficiary_student_id
    where link.payer_student_id = target_payer_id and link.state <> 'cancelled'
      and link.first_reference_month <= primary_tuition.reference_month
      and (link.first_uncovered_month is null
           or primary_tuition.reference_month < link.first_uncovered_month)
    order by link.beneficiary_student_id
  loop
    select * into dependent_tuition
    from public.monthly_tuition
    where student_id = dependent.beneficiary_student_id
      and reference_month = primary_tuition.reference_month;

    if not found then
      raise exception 'A mensalidade do aluno coberto ainda não foi gerada.';
    end if;
    if dependent_tuition.payment_date is not null or dependent_tuition.is_exempt then
      raise exception 'Uma mensalidade coberta já foi paga ou está isenta.';
    end if;

    total := total + round(dependent_tuition.amount_due, 2);
    items := items || jsonb_build_array(jsonb_build_object(
      'tuition_id', dependent_tuition.id,
      'student_id', dependent.beneficiary_student_id,
      'student_name', dependent.name,
      'amount', round(dependent_tuition.amount_due, 2),
      'role', 'beneficiary'
    ));
  end loop;

  return jsonb_build_object(
    'payer_student_id', target_payer_id,
    'primary_tuition_id', target_tuition_id,
    'reference_month', primary_tuition.reference_month,
    'total', round(total, 2),
    'sponsored', jsonb_array_length(items) > 1,
    'items', items
  );
end;
$function$;

create or replace function public.get_my_financial_responsibility_quote(target_tuition_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $function$
begin
  if auth.uid() is null then
    raise exception 'Faça login para consultar esta mensalidade.' using errcode = '42501';
  end if;
  return private.quote_financial_responsibility_payment(auth.uid(), target_tuition_id);
end;
$function$;

-- Called only by a trusted server after creating the primary payment attempt
-- with the exact amount returned by quote_financial_responsibility_payment.
create or replace function public.reserve_financial_responsibility_payment(
  target_attempt_id uuid, target_payer_student_id uuid
)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare
  attempt_row public.tuition_payment_attempts%rowtype;
  invoice public.monthly_tuition%rowtype;
  quote jsonb;
  item jsonb;
  allocated_count integer := 0;
  target_id uuid;
  item_amount numeric(10,2);
begin
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role'
     and session_user <> 'postgres' then
    raise exception 'Acesso exclusivo do serviço de pagamentos.' using errcode = '42501';
  end if;

  select * into attempt_row
  from public.tuition_payment_attempts
  where id = target_attempt_id and student_id = target_payer_student_id
  for update;

  if not found or attempt_row.status <> 'created'
     or attempt_row.provider_payment_id is not null then
    raise exception 'Tentativa não encontrada ou não pode receber rateio.';
  end if;

  quote := private.quote_financial_responsibility_payment(
    target_payer_student_id, attempt_row.tuition_id
  );

  if round(attempt_row.amount, 2) is distinct from (quote ->> 'total')::numeric then
    raise exception 'O total da tentativa não confere com as mensalidades contratadas.';
  end if;

  if coalesce((quote ->> 'sponsored')::boolean, false) = false then
    if exists (
      select 1 from private.financial_responsibility_payment_items
      where attempt_id = target_attempt_id
    ) then
      raise exception 'Tentativa comum não pode conter rateio de responsáveis.';
    end if;
    return jsonb_build_object('sponsored', false, 'total', attempt_row.amount);
  end if;

  -- Lock every invoice in a stable order to prevent concurrent settlement.
  for invoice in
    select tuition.*
    from public.monthly_tuition tuition
    where tuition.id in (
      select (value ->> 'tuition_id')::uuid
      from jsonb_array_elements(quote -> 'items')
    )
    order by tuition.id
    for update
  loop
    if invoice.payment_date is not null or invoice.is_exempt then
      raise exception 'Uma mensalidade foi alterada durante a preparação do pagamento.';
    end if;
  end loop;

  for item in select value from jsonb_array_elements(quote -> 'items')
  loop
    target_id := (item ->> 'tuition_id')::uuid;
    item_amount := (item ->> 'amount')::numeric;
    if exists (
      select 1 from public.tuition_payment_attempts other
      where other.tuition_id = target_id and other.id <> target_attempt_id
        and other.status in ('created', 'pending', 'authorized', 'in_process', 'in_mediation')
        and other.created_at > now() - interval '30 minutes'
    ) then
      raise exception 'Existe outra tentativa ativa para uma das mensalidades.';
    end if;

    insert into private.financial_responsibility_payment_items
      (attempt_id, tuition_id, allocated_amount)
    values (target_attempt_id, target_id, item_amount)
    on conflict (attempt_id, tuition_id) do nothing;
    if not exists (
      select 1 from private.financial_responsibility_payment_items existing
      where existing.attempt_id = target_attempt_id
        and existing.tuition_id = target_id
        and existing.allocated_amount = item_amount
        and existing.reversed_at is null
    ) then
      raise exception 'O rateio anterior não corresponde à cobrança imutável.';
    end if;
    allocated_count := allocated_count + 1;
  end loop;

  if (select count(*) from private.financial_responsibility_payment_items
      where attempt_id = target_attempt_id and reversed_at is null) <> allocated_count then
    raise exception 'Não foi possível reservar o rateio integral.';
  end if;

  return jsonb_build_object(
    'sponsored', true, 'total', attempt_row.amount, 'items', allocated_count
  );
end;
$function$;

-- Dedicated atomic settlement handler; the legacy handler remains unchanged.
create or replace function public.process_financial_responsibility_payment(
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
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare
  attempt_row public.tuition_payment_attempts%rowtype;
  invoice record;
  normalized_status text := lower(trim(coalesce(target_status, '')));
  normalized_method text := lower(trim(coalesce(target_payment_method, '')));
  normalized_payment_id text := trim(coalesce(target_provider_payment_id, ''));
  item_count integer;
  settled_count integer := 0;
  reversed_count integer := 0;
begin
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role'
     and session_user <> 'postgres' then
    raise exception 'Acesso exclusivo do serviço de pagamentos.' using errcode = '42501';
  end if;

  if normalized_payment_id = '' or length(normalized_payment_id) > 128
     or normalized_method not in ('pix', 'card')
     or normalized_status not in (
       'created', 'pending', 'approved', 'authorized', 'in_process',
       'in_mediation', 'rejected', 'cancelled', 'refunded', 'charged_back'
     ) then
    raise exception 'Dados do provedor inválidos.';
  end if;

  select * into attempt_row from public.tuition_payment_attempts
  where id = target_attempt_id for update;
  if not found then raise exception 'Tentativa não encontrada.'; end if;

  select count(*) into item_count
  from private.financial_responsibility_payment_items
  where attempt_id = target_attempt_id;

  if item_count < 2 then
    raise exception 'Tentativa não possui rateio financeiro consolidado.';
  end if;

  if normalized_status = 'approved'
     and (attempt_row.reversed_at is not null or exists (
       select 1 from private.financial_responsibility_payment_items item
       where item.attempt_id = target_attempt_id and item.reversed_at is not null
     )) then
    raise exception 'Um pagamento já estornado não pode ser reaplicado automaticamente.';
  end if;

  if round(target_amount, 2) is distinct from round(attempt_row.amount, 2)
     or (attempt_row.provider_payment_id is not null
         and attempt_row.provider_payment_id <> normalized_payment_id)
     or exists (
       select 1 from private.financial_responsibility_payment_items allocation
       join public.monthly_tuition tuition on tuition.id = allocation.tuition_id
       where allocation.attempt_id = target_attempt_id
         and round(allocation.allocated_amount, 2) <> round(tuition.amount_due, 2)
     )
     or (select round(sum(allocated_amount), 2)
         from private.financial_responsibility_payment_items
         where attempt_id = target_attempt_id) <> round(attempt_row.amount, 2)
  then
    raise exception 'Total do pagamento ou rateio financeiro inconsistente.';
  end if;

  update public.tuition_payment_attempts
  set provider_payment_id = normalized_payment_id,
      status = normalized_status,
      status_detail = nullif(trim(coalesce(target_status_detail, '')), ''),
      payment_method = normalized_method,
      live_mode = target_live_mode,
      provider_created_at = coalesce(provider_created_at, target_provider_created_at),
      provider_updated_at = coalesce(target_provider_updated_at, now()),
      last_reconciled_at = now(),
      reconciliation_failure_count = 0,
      last_reconciliation_error = null
  where id = target_attempt_id;

  if normalized_status = 'approved' then
    for invoice in
      select tuition.*, item.allocated_amount
      from private.financial_responsibility_payment_items item
      join public.monthly_tuition tuition on tuition.id = item.tuition_id
      where item.attempt_id = target_attempt_id and item.reversed_at is null
      order by tuition.id
      for update of tuition
    loop
      if invoice.payment_date is not null then
        if invoice.payment_provider <> 'mercado_pago'
          or invoice.provider_payment_id <> normalized_payment_id
          or round(invoice.amount_paid,2) <> round(invoice.allocated_amount,2) then
          raise exception 'Mensalidade liquidada por outro pagamento: análise manual necessária.';
        end if;
      elsif invoice.is_exempt then
        raise exception 'Mensalidade isenta não pode ser liquidada.';
      else
        update public.monthly_tuition
        set payment_date = coalesce(target_approved_at::date, timezone('America/Sao_Paulo', now())::date),
            amount_paid = invoice.allocated_amount,
            payment_method = normalized_method,
            payment_notes = 'Mercado Pago · responsável financeiro · pagamento ' || normalized_payment_id,
            payment_provider = 'mercado_pago',
            provider_payment_id = normalized_payment_id,
            updated_at = now(),
            updated_by = null
        where id = invoice.id;
        settled_count := settled_count + 1;

        insert into public.monthly_tuition_events (tuition_id, action, actor_id, details)
        values (invoice.id, 'payment_recorded', null,
          jsonb_build_object('source','financial_responsibility','attempt_id',target_attempt_id,
            'payer_student_id',attempt_row.student_id, 'provider_payment_id',normalized_payment_id,
            'amount_paid',invoice.allocated_amount, 'payment_method',normalized_method));
      end if;
    end loop;

    update public.tuition_payment_attempts
    set applied_at = coalesce(applied_at, coalesce(target_approved_at, now()))
    where id = target_attempt_id;

  elsif normalized_status in ('cancelled','refunded','charged_back')
    and attempt_row.applied_at is not null and attempt_row.reversed_at is null then
    for invoice in
      select tuition.*, item.allocated_amount
      from private.financial_responsibility_payment_items item
      join public.monthly_tuition tuition on tuition.id = item.tuition_id
      where item.attempt_id = target_attempt_id and item.reversed_at is null
      order by tuition.id for update of tuition
    loop
      if invoice.payment_provider <> 'mercado_pago'
         or invoice.provider_payment_id <> normalized_payment_id
         or round(invoice.amount_paid, 2) <> round(invoice.allocated_amount, 2) then
        raise exception 'O estorno exige conciliação manual: mensalidade divergente.';
      end if;
      update public.monthly_tuition
      set payment_date=null,amount_paid=null,payment_method=null,payment_notes=null,
          payment_provider=null,provider_payment_id=null,
          late_fine_paid=null, late_interest_paid=null,updated_at=now(),updated_by=null
      where id = invoice.id;
      reversed_count := reversed_count + 1;
      insert into public.monthly_tuition_events (tuition_id, action, actor_id, details)
      values (invoice.id, 'payment_reversed', null,
        jsonb_build_object('source','financial_responsibility','attempt_id',target_attempt_id,
          'payer_student_id',attempt_row.student_id,'provider_payment_id',normalized_payment_id,
          'provider_status',normalized_status,'allocated_amount',invoice.allocated_amount));
    end loop;
    if reversed_count <> item_count then raise exception 'O estorno não foi integral.'; end if;
    update private.financial_responsibility_payment_items
    set reversed_at=now() where attempt_id=target_attempt_id and reversed_at is null;
    update public.tuition_payment_attempts
    set reversed_at=now() where id=target_attempt_id;
  end if;

  return jsonb_build_object('ok',true,'status',normalized_status,
    'items',item_count,'newly_settled',settled_count,'newly_reversed',reversed_count);
end;
$function$;

revoke all on function private.quote_financial_responsibility_payment(uuid,uuid) from public, anon, authenticated;
revoke all on function public.get_my_financial_responsibility_quote(uuid) from public, anon;
grant execute on function public.get_my_financial_responsibility_quote(uuid) to authenticated;
revoke all on function public.reserve_financial_responsibility_payment(uuid,uuid) from public, anon, authenticated;
revoke all on function public.process_financial_responsibility_payment(uuid,text,text,text,numeric,text,boolean,timestamptz,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.reserve_financial_responsibility_payment(uuid,uuid) to service_role;
grant execute on function public.process_financial_responsibility_payment(uuid,text,text,text,numeric,text,boolean,timestamptz,timestamptz,timestamptz) to service_role;
