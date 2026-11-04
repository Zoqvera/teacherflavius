-- Cross-overload, telephone-scoped budgets share the existing service-side
-- rate-limit ledger, without exposing phone numbers or client-chosen keys.
-- This does not replace per-IP anti-automation at the API perimeter.
create or replace function private.assert_public_class_seat_attempt_budget(
  target_whatsapp text,
  target_operation text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  normalized_phone text := private.normalize_trial_phone(target_whatsapp);
  hourly_limit integer;
  daily_limit integer;
  bucket_prefix text;
  hourly_allowed boolean;
  daily_allowed boolean;
begin
  if normalized_phone is null then
    raise exception 'Informe um WhatsApp com DDD válido.' using errcode = '22023';
  end if;

  case target_operation
    when 'hold' then
      hourly_limit := 8;
      daily_limit := 18;
    when 'waitlist' then
      hourly_limit := 12;
      daily_limit := 30;
    else
      raise exception 'Operação inválida.' using errcode = '22023';
  end case;

  -- No raw phone or untrusted browser key is recorded in the rate buckets.
  bucket_prefix := 'public-seat:v1:' || target_operation || ':' ||
    encode(extensions.digest(normalized_phone, 'sha256'), 'hex');

  hourly_allowed := public.consume_api_rate_limit(
    bucket_prefix || ':hour', 3600, hourly_limit
  );
  if not hourly_allowed then
    raise exception 'Muitas tentativas para este WhatsApp. Tente novamente mais tarde.'
      using errcode = '22023';
  end if;

  daily_allowed := public.consume_api_rate_limit(
    bucket_prefix || ':day', 86400, daily_limit
  );
  if not daily_allowed then
    raise exception 'Limite diário de solicitações para este WhatsApp atingido.'
      using errcode = '22023';
  end if;
end;
$function$;

revoke all on function private.assert_public_class_seat_attempt_budget(text,text)
  from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_public_class_seat_hold(target_class_number integer, target_name text, target_whatsapp text, target_client_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  applicant_key text := private.class_seat_applicant_key(target_whatsapp,target_client_key);
  applicant_name text := btrim(coalesce(target_name,''));
  secret text;
  hold_id uuid;
  expiry timestamptz;
  capacity integer;
begin
  if length(applicant_name) not between 2 and 120 or
     private.normalize_trial_phone(target_whatsapp) is null then
    raise exception 'Informe nome e WhatsApp com DDD válidos para reservar.' using errcode='22023';
  end if;

  -- Capacity, active applicant and expiration changes remain atomic.
  perform private.assert_public_class_seat_attempt_budget(target_whatsapp, 'hold');

  perform pg_catalog.pg_advisory_xact_lock(73008,target_class_number);
  perform pg_catalog.pg_advisory_xact_lock(73009,hashtext(applicant_key));

  perform 1 from public.teacher_classes tc
  where tc.class_number=target_class_number and tc.is_active
    and tc.class_type='quintet'
    and tc.class_weekday is not null
    and tc.class_start_time is not null
    and upper(btrim(tc.class_name)) not like 'AULA EXPERIMENTAL%';
  if not found then
    raise exception 'Turma não disponível para reserva.' using errcode='22023';
  end if;

  update private.class_seat_holds
  set status='expired',updated_at=now()
  where normalized_phone=applicant_key
    and status='active' and expires_at<=now();

  if exists(
    select 1 from private.class_seat_holds
    where normalized_phone=applicant_key and status='active'
  ) then
    raise exception 'Já existe uma reserva vigente neste navegador ou WhatsApp.' using errcode='23505';
  end if;
  if (
    select count(*) from private.class_seat_holds
    where normalized_phone=applicant_key
      and created_at>now()-interval '24 hours'
  )>=3 then
    raise exception 'Limite diário de reservas atingido. Fale com o professor.' using errcode='22023';
  end if;

  capacity := private.get_class_operational_capacity(target_class_number);
  if capacity is null or
     private.count_class_seat_members(target_class_number)
       + private.count_class_seat_holds(target_class_number) >= capacity then
    raise exception 'A última vaga desta turma já foi ocupada. Atualize a lista.' using errcode='23514';
  end if;

  secret := encode(extensions.gen_random_bytes(32),'hex');
  expiry := now()+interval '15 minutes';
  insert into private.class_seat_holds(
    class_number,applicant_name,whatsapp,normalized_phone,token_digest,expires_at
  ) values (
    target_class_number,applicant_name,
    nullif(btrim(coalesce(target_whatsapp,'')),''),
    applicant_key,encode(extensions.digest(secret,'sha256'),'hex'),expiry
  ) returning id into hold_id;

  return jsonb_build_object(
    'reservation_id',hold_id,'token',secret,
    'expires_at',expiry,'class_number',target_class_number
  );
end;
$function$

CREATE OR REPLACE FUNCTION public.create_public_class_seat_hold(target_class_number integer, target_name text, target_whatsapp text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  normalized text := private.normalize_trial_phone(target_whatsapp);
  cleaned_name text := btrim(coalesce(target_name,''));
  secret text;
  hold_id uuid;
  expiry timestamptz;
  capacity integer;
begin
  if length(cleaned_name) not between 2 and 120 or normalized is null then
    raise exception 'Informe nome e WhatsApp com DDD válidos.' using errcode='22023';
  end if;
  -- Any valid Brazilian WhatsApp is accepted, even if different from the trial contact.

  -- Lock shared with membership triggers: two applicants cannot take the last seat.
  perform private.assert_public_class_seat_attempt_budget(target_whatsapp, 'hold');

  perform pg_catalog.pg_advisory_xact_lock(73008,target_class_number);
  perform 1 from public.teacher_classes tc
  where tc.class_number=target_class_number and tc.is_active
    and tc.class_type='quintet'
    and tc.class_weekday is not null and tc.class_start_time is not null
    and upper(btrim(tc.class_name)) not like 'AULA EXPERIMENTAL%';
  if not found then
    raise exception 'Turma não disponível para reserva.' using errcode='22023';
  end if;

  -- Expired records are released lazily; no cron or delayed worker is required.
  update private.class_seat_holds set status='expired', updated_at=now()
  where status='active' and expires_at<=now() and normalized_phone=normalized;

  if exists(select 1 from private.class_seat_holds
            where normalized_phone=normalized and status='active') then
    raise exception 'Já existe uma reserva válida para este WhatsApp.' using errcode='23505';
  end if;
  if (select count(*) from private.class_seat_holds
      where normalized_phone=normalized and created_at>now()-interval '24 hours')>=3 then
    raise exception 'Limite de reservas temporárias atingido. Entre em contato com o professor.' using errcode='22023';
  end if;

  capacity := private.get_class_operational_capacity(target_class_number);
  if capacity is null or
     private.count_class_seat_members(target_class_number)
       + private.count_class_seat_holds(target_class_number) >= capacity then
    raise exception 'A última vaga desta turma já foi ocupada. Atualize a lista.' using errcode='23514';
  end if;

  secret := encode(extensions.gen_random_bytes(32),'hex');
  expiry := now()+interval '15 minutes';
  insert into private.class_seat_holds(
    class_number,applicant_name,whatsapp,normalized_phone,token_digest,expires_at)
  values(target_class_number,cleaned_name,btrim(target_whatsapp),
    normalized,encode(extensions.digest(secret,'sha256'),'hex'),expiry)
  returning id into hold_id;
  return jsonb_build_object('reservation_id',hold_id,'token',secret,'expires_at',expiry,
    'class_number',target_class_number);
end;
$function$

CREATE OR REPLACE FUNCTION public.join_public_class_seat_waitlist(target_class_number integer, target_name text, target_whatsapp text, target_client_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  applicant_key text := private.class_seat_applicant_key(target_whatsapp,target_client_key);
  applicant_name text := btrim(coalesce(target_name,''));
begin
  if length(applicant_name) not between 2 and 120 or
     private.normalize_trial_phone(target_whatsapp) is null then
    raise exception 'Informe nome e WhatsApp com DDD válidos para a lista de espera.' using errcode='22023';
  end if;

  perform private.assert_public_class_seat_attempt_budget(target_whatsapp, 'waitlist');

  perform 1 from public.teacher_classes
  where class_number=target_class_number and is_active and class_type='quintet'
    and class_weekday is not null and class_start_time is not null;
  if not found then raise exception 'Turma indisponível.' using errcode='22023'; end if;

  insert into private.class_seat_waitlist(
    class_number,applicant_name,whatsapp,normalized_phone
  ) values (
    target_class_number,applicant_name,
    nullif(btrim(coalesce(target_whatsapp,'')),''),applicant_key
  )
  on conflict (class_number, normalized_phone) do nothing;
  return true;
end;
$function$

CREATE OR REPLACE FUNCTION public.join_public_class_seat_waitlist(target_class_number integer, target_name text, target_whatsapp text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare normalized text := private.normalize_trial_phone(target_whatsapp);
begin
  if length(btrim(coalesce(target_name,''))) not between 2 and 120 or normalized is null then
    raise exception 'Informe nome e WhatsApp com DDD válidos.' using errcode='22023';
  end if;
  -- Any valid Brazilian WhatsApp is accepted, even if different from the trial contact.
  perform private.assert_public_class_seat_attempt_budget(target_whatsapp, 'waitlist');

  perform 1 from public.teacher_classes
  where class_number=target_class_number and is_active and class_type='quintet';
  if not found then raise exception 'Turma indisponível.' using errcode='22023'; end if;
  insert into private.class_seat_waitlist(class_number,applicant_name,whatsapp,normalized_phone)
  values(target_class_number,btrim(target_name),btrim(target_whatsapp),normalized)
  on conflict (class_number, normalized_phone) do nothing;
  return true;
end;
$function$
