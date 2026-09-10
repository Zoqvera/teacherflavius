create or replace function public.get_payment_creation_control_internal()
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  control private.payment_creation_control%rowtype;
begin
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

revoke all on function public.get_payment_creation_control_internal() from public, anon, authenticated;
grant execute on function public.get_payment_creation_control_internal() to service_role;

create or replace function public.set_payment_creation_enabled_internal(
  target_enabled boolean,
  target_reason text,
  target_actor_user_id uuid
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
begin
  if target_enabled is null then
    raise exception 'Estado do controle de pagamentos é obrigatório.' using errcode = '22023';
  end if;
  if target_actor_user_id is null then
    raise exception 'Ator administrativo é obrigatório.' using errcode = '22023';
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
         updated_by = target_actor_user_id
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
      target_actor_user_id
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

revoke all on function public.set_payment_creation_enabled_internal(boolean, text, uuid) from public, anon, authenticated;
grant execute on function public.set_payment_creation_enabled_internal(boolean, text, uuid) to service_role;

drop function if exists public.get_teacher_payment_creation_control();
drop function if exists public.set_teacher_payment_creation_enabled(boolean, text);
