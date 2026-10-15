-- Homeworks — orçamento mensal global de USD 5,00 para GPT-6 Luna.
-- Valores em micros de dólar (1 USD = 1.000.000 micros).
-- Mês civil em America/Sao_Paulo; reserva pessimista antes da chamada.
-- Não altera homework_release_control e não libera nenhuma atividade.

create table public.homework_ai_budget_months (
  month_start date primary key
    check (extract(day from month_start) = 1),
  limit_micro_usd bigint not null default 5000000
    check (limit_micro_usd = 5000000),
  spent_micro_usd bigint not null default 0
    check (spent_micro_usd >= 0),
  reserved_micro_usd bigint not null default 0
    check (reserved_micro_usd >= 0),
  alert_80_sent boolean not null default false,
  alert_cap_sent boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint homework_budget_not_exceeded
    check (spent_micro_usd + reserved_micro_usd <= limit_micro_usd)
);

create table public.homework_ai_budget_calls (
  token uuid primary key,
  month_start date not null references public.homework_ai_budget_months(month_start),
  attempt_id uuid not null references public.exercise_attempts(id) on delete cascade,
  reserved_micro_usd bigint not null check (reserved_micro_usd > 0),
  actual_micro_usd bigint
    check (actual_micro_usd is null or actual_micro_usd between 0 and reserved_micro_usd),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  constraint homework_budget_settlement_consistent check (
    (actual_micro_usd is null and settled_at is null)
    or (actual_micro_usd is not null and settled_at is not null)
  )
);

create index homework_ai_budget_calls_month_idx
  on public.homework_ai_budget_calls(month_start,created_at);

alter table public.homework_ai_budget_months enable row level security;
alter table public.homework_ai_budget_calls enable row level security;
revoke all on public.homework_ai_budget_months from public,anon,authenticated;
revoke all on public.homework_ai_budget_calls from public,anon,authenticated;
grant select,insert,update on public.homework_ai_budget_months to service_role;
grant select,insert,update on public.homework_ai_budget_calls to service_role;

-- Reserve sempre o custo da pior chamada permitida por esta Edge:
-- <= 40.000 tokens de entrada, <= 1.400 tokens de saída.
-- GPT-6 Luna Standard: USD 0,10/1M input, USD 0,50/1M output.
-- (40.000 * 0,1 + 1.400 * 0,5) = 4.700 micros = USD 0,0047.
-- Se o provedor não informar usage, a reserva inteira continua consumida.
create function public.homework_ai_budget_reserve(
  p_attempt_id uuid, p_token uuid
) returns jsonb language plpgsql security invoker set search_path = ''
as $budget$
declare
  period date := date_trunc('month', now() at time zone 'America/Sao_Paulo')::date;
  reservation constant bigint := 4700;
  month_row public.homework_ai_budget_months;
  existing public.homework_ai_budget_calls;
  effective bigint;
begin
  if not (select public.homework_is_released()) then
    raise exception 'Recurso nao liberado.' using errcode='42501';
  end if;
  if p_attempt_id is null or p_token is null or not exists (
    select 1 from public.exercise_attempts t
    where t.id=p_attempt_id and t.status='evaluating'
      and t.evaluation_token=p_token
  ) then
    raise exception 'Avaliacao sem concessao valida.' using errcode='42501';
  end if;

  insert into public.homework_ai_budget_months (month_start)
    values (period) on conflict (month_start) do nothing;
  select * into month_row from public.homework_ai_budget_months
    where month_start=period for update;

  select * into existing from public.homework_ai_budget_calls
    where token=p_token;
  if found then
    if existing.attempt_id is distinct from p_attempt_id then
      raise exception 'Concessao de budget invalida.' using errcode='42501';
    end if;
    return jsonb_build_object('allowed',true,'reused',true,
      'reserved_micro_usd',existing.reserved_micro_usd,
      'month_start',existing.month_start);
  end if;

  effective := month_row.spent_micro_usd + month_row.reserved_micro_usd;
  if effective + reservation > month_row.limit_micro_usd then
    if not month_row.alert_cap_sent then
      update public.homework_ai_budget_months set alert_cap_sent=true,
        updated_at=now() where month_start=period;
      if coalesce(current_setting('app.homework_budget_notify',true),'true') <> 'false'
        and to_regprocedure('private.enqueue_system_health_alert(text,text,text,jsonb)') is not null then
        perform private.enqueue_system_health_alert(
          'homework_ai_budget_limit','critical',
          'homework_ai_budget_limit:'||to_char(period,'YYYYMM'),
          jsonb_build_object('month_start',period,'limit_usd',5,
            'accounted_micro_usd',effective));
      end if;
    end if;
    return jsonb_build_object('allowed',false,'reason','monthly_budget_exceeded',
      'month_start',period,'limit_usd',5,'accounted_micro_usd',effective);
  end if;

  insert into public.homework_ai_budget_calls(token,month_start,attempt_id,reserved_micro_usd)
    values (p_token,period,p_attempt_id,reservation);
  update public.homework_ai_budget_months
  set reserved_micro_usd=reserved_micro_usd+reservation,updated_at=now()
  where month_start=period;

  if effective + reservation >= 4000000 and not month_row.alert_80_sent then
    update public.homework_ai_budget_months set alert_80_sent=true,
      updated_at=now() where month_start=period;
    if coalesce(current_setting('app.homework_budget_notify',true),'true') <> 'false'
      and to_regprocedure('private.enqueue_system_health_alert(text,text,text,jsonb)') is not null then
      perform private.enqueue_system_health_alert(
        'homework_ai_budget_80_percent','warning',
        'homework_ai_budget_80_percent:'||to_char(period,'YYYYMM'),
        jsonb_build_object('month_start',period,'threshold_usd',4,
          'accounted_micro_usd',effective+reservation,'limit_usd',5));
    end if;
  end if;

  return jsonb_build_object('allowed',true,'reused',false,
    'reserved_micro_usd',reservation,'month_start',period,
    'accounted_micro_usd',effective+reservation);
end;
$budget$;

-- Custo conservador: ignora desconto de cache; sempre conta o total de input.
-- A liquidação devolve o excesso reservado somente se usage é válido.
create function public.homework_ai_budget_settle(
  p_attempt_id uuid, p_token uuid,
  p_input_tokens integer, p_output_tokens integer
) returns jsonb language plpgsql security invoker set search_path = ''
as $budget$
declare
  call_row public.homework_ai_budget_calls;
  month_row public.homework_ai_budget_months;
  actual bigint;
begin
  if p_attempt_id is null or p_token is null then
    raise exception 'Concessao invalida.' using errcode='42501';
  end if;
  -- 40k é limite conservador derivado dos comprimentos máximos do prompt/texto.
  if p_input_tokens is null or p_input_tokens not between 0 and 40000
    or p_output_tokens is null or p_output_tokens not between 0 and 1400 then
    raise exception 'Uso de tokens ausente ou fora do limite de reserva.';
  end if;
  select * into call_row from public.homework_ai_budget_calls
    where token=p_token;
  if not found or call_row.attempt_id is distinct from p_attempt_id then
    raise exception 'Concessao de budget desconhecida.' using errcode='42501';
  end if;

  select * into month_row from public.homework_ai_budget_months
    where month_start=call_row.month_start for update;
  select * into call_row from public.homework_ai_budget_calls
    where token=p_token for update;
  actual := ceil(p_input_tokens::numeric / 10
                 + p_output_tokens::numeric / 2)::bigint;
  if actual > call_row.reserved_micro_usd then
    raise exception 'Custo real excede a reserva.';
  end if;
  if call_row.actual_micro_usd is not null then
    if call_row.actual_micro_usd <> actual then
      raise exception 'Liquidação divergente.';
    end if;
    return jsonb_build_object('settled',true,'reused',true,
      'spent_micro_usd',month_row.spent_micro_usd);
  end if;
  update public.homework_ai_budget_calls set actual_micro_usd=actual,
    settled_at=now() where token=p_token;
  update public.homework_ai_budget_months
  set reserved_micro_usd=reserved_micro_usd-call_row.reserved_micro_usd,
    spent_micro_usd=spent_micro_usd+actual,updated_at=now()
  where month_start=call_row.month_start;
  return jsonb_build_object('settled',true,'reused',false,
    'charged_micro_usd',actual,'month_start',call_row.month_start);
end;
$budget$;

revoke all on function public.homework_ai_budget_reserve(uuid,uuid)
  from public,anon,authenticated;
revoke all on function public.homework_ai_budget_settle(uuid,uuid,integer,integer)
  from public,anon,authenticated;
grant execute on function public.homework_ai_budget_reserve(uuid,uuid) to service_role;
grant execute on function public.homework_ai_budget_settle(uuid,uuid,integer,integer) to service_role;

comment on table public.homework_ai_budget_months is
 'USD 5 mensal, meses Sao Paulo. Apenas custo de Writing nesta Edge Function.';
comment on table public.homework_ai_budget_calls is
 'Reservas por chamada real de Writing; falhas sem usage preservam a reserva.';
