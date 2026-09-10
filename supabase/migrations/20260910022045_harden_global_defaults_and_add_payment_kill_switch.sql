alter default privileges for role postgres in schema public
  revoke all privileges on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public
  grant all privileges on tables to service_role;
alter default privileges for role postgres in schema public
  grant all privileges on sequences to service_role;
alter default privileges for role postgres in schema public
  grant execute on functions to service_role;

revoke execute on function public.suppress_excluded_marketing_visitor_events() from public, anon, authenticated;
grant execute on function public.suppress_excluded_marketing_visitor_events() to service_role;

create table if not exists private.payment_creation_control (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default true,
  reason text,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint payment_creation_control_reason_length check (reason is null or char_length(reason) <= 500)
);

insert into private.payment_creation_control (singleton, enabled, reason)
values (true, true, 'Inicialização do controle operacional de pagamentos.')
on conflict (singleton) do nothing;

create table if not exists private.payment_creation_control_events (
  id bigint generated always as identity primary key,
  previous_enabled boolean not null,
  enabled boolean not null,
  reason text,
  cancelled_attempts integer not null default 0 check (cancelled_attempts >= 0),
  actor_user_id uuid,
  created_at timestamptz not null default now(),
  constraint payment_creation_control_events_reason_length check (reason is null or char_length(reason) <= 500)
);

create index if not exists payment_creation_control_events_created_at_idx
  on private.payment_creation_control_events (created_at desc);

create or replace function private.enforce_payment_creation_enabled()
returns trigger
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  creation_enabled boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('teacherflavius_payment_creation_gate', 0));

  select control.enabled
    into creation_enabled
  from private.payment_creation_control control
  where control.singleton = true;

  if coalesce(creation_enabled, false) is not true then
    raise exception using
      errcode = 'P0001',
      message = 'payment_creation_disabled';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_payment_creation_enabled() from public, anon, authenticated;
grant execute on function private.enforce_payment_creation_enabled() to service_role;

drop trigger if exists tuition_payment_attempts_payment_creation_gate on public.tuition_payment_attempts;
create trigger tuition_payment_attempts_payment_creation_gate
before insert on public.tuition_payment_attempts
for each row execute function private.enforce_payment_creation_enabled();

create or replace function public.get_teacher_payment_creation_control()
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  control private.payment_creation_control%rowtype;
begin
  if not public.is_teacher_admin_mfa() then
    raise exception 'MFA do professor é obrigatório.' using errcode = '42501';
  end if;

  select * into control
  from private.payment_creation_control
  where singleton = true;

  return jsonb_build_object(
    'enabled', control.enabled,
    'reason', control.reason,
    'updated_at', control.updated_at,
    'updated_by', control.updated_by
  );
end;
$$;

revoke all on function public.get_teacher_payment_creation_control() from public, anon;
grant execute on function public.get_teacher_payment_creation_control() to authenticated;

create or replace function public.set_teacher_payment_creation_enabled(
  target_enabled boolean,
  target_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  previous_enabled boolean;
  normalized_reason text;
  affected_attempts integer := 0;
  actor_id uuid := auth.uid();
begin
  if not public.is_teacher_admin_mfa() then
    raise exception 'MFA do professor é obrigatório.' using errcode = '42501';
  end if;

  if target_enabled is null then
    raise exception 'Estado do controle de pagamentos é obrigatório.' using errcode = '22023';
  end if;

  normalized_reason := nullif(btrim(coalesce(target_reason, '')), '');
  if normalized_reason is not null and char_length(normalized_reason) > 500 then
    raise exception 'Motivo muito longo.' using errcode = '22023';
  end if;
  if target_enabled = false and (normalized_reason is null or char_length(normalized_reason) < 5) then
    raise exception 'Informe um motivo com pelo menos 5 caracteres para bloquear novas cobranças.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('teacherflavius_payment_creation_gate', 0));

  select enabled into previous_enabled
  from private.payment_creation_control
  where singleton = true
  for update;

  if previous_enabled is null then
    raise exception 'Controle de pagamentos indisponível.' using errcode = '55000';
  end if;

  if target_enabled = false then
    update public.tuition_payment_attempts
       set status = 'cancelled',
           status_detail = 'payment_creation_disabled',
           idempotency_key = gen_random_uuid(),
           updated_at = now()
     where provider_payment_id is null
       and status in ('created', 'pending', 'authorized', 'in_process', 'in_mediation');
    get diagnostics affected_attempts = row_count;
  end if;

  update private.payment_creation_control
     set enabled = target_enabled,
         reason = coalesce(normalized_reason,
           case when target_enabled then 'Novas cobranças reativadas pelo professor.' else reason end),
         updated_at = now(),
         updated_by = actor_id
   where singleton = true;

  if previous_enabled is distinct from target_enabled then
    insert into private.payment_creation_control_events (
      previous_enabled,
      enabled,
      reason,
      cancelled_attempts,
      actor_user_id
    ) values (
      previous_enabled,
      target_enabled,
      coalesce(normalized_reason, case when target_enabled then 'Novas cobranças reativadas pelo professor.' else null end),
      affected_attempts,
      actor_id
    );
  end if;

  return jsonb_build_object(
    'enabled', target_enabled,
    'previous_enabled', previous_enabled,
    'reason', (select reason from private.payment_creation_control where singleton = true),
    'updated_at', (select updated_at from private.payment_creation_control where singleton = true),
    'cancelled_attempts', affected_attempts
  );
end;
$$;

revoke all on function public.set_teacher_payment_creation_enabled(boolean, text) from public, anon;
grant execute on function public.set_teacher_payment_creation_enabled(boolean, text) to authenticated;
