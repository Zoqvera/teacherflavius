-- Disposable fixture only: production definitions observed 2026-11-04.
-- Never apply this reconciliation overlay to production.
begin;
do $$
begin
  if (select count(*) from public.teacher_classes where class_number in (970001, 970002)) <> 2
    or exists (select 1 from public.profiles)
    or exists (select 1 from public.monthly_tuition)
    or exists (select 1 from cron.job where active) then
    raise exception 'Refusing payment fixture overlay on a non-disposable database';
  end if;
end;
$$;

CREATE OR REPLACE FUNCTION public.record_tuition_payment__mfa_inner(target_tuition_id uuid, target_payment_date date, target_amount_paid numeric, target_payment_method text, target_payment_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

CREATE OR REPLACE FUNCTION public.record_tuition_payment(target_tuition_id uuid, target_payment_date date, target_amount_paid numeric, target_payment_method text, target_payment_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$begin
  if not public.is_teacher_admin_mfa() then
    raise exception 'Autenticação administrativa em duas etapas obrigatória.' using errcode = '42501';
  end if;
  return public.record_tuition_payment__mfa_inner($1, $2, $3, $4, $5);
end;$function$;

revoke all on function public.record_tuition_payment__mfa_inner(uuid,date,numeric,text,text)
  from public, anon, authenticated;
commit;
