-- Canonical student cancellation policy, effective 2026-11-05.
-- Regular lessons: last seven days before start; >=12 hours still grants credit.
-- Confirmed replacement lessons: no student cancellation.
-- Teacher administrative cancellation remains unchanged.

create or replace function private.lesson_can_be_cancelled(
  target_starts_at timestamptz,
  evaluated_at timestamptz
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $function$
  select target_starts_at is not null
    and evaluated_at >= target_starts_at - interval '7 days'
    and evaluated_at < target_starts_at;
$function$;

revoke execute on function private.lesson_can_be_cancelled(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function private.lesson_can_be_cancelled(timestamptz, timestamptz)
  to service_role;

-- Legacy and canonical student replacement cancellation endpoints stay present
-- for historical compatibility but have no student execution privileges.
revoke execute on function public.cancel_my_lesson_replacement(uuid)
  from public, anon, authenticated;
revoke execute on function public.cancel_my_makeup_class_booking(uuid)
  from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cancel_my_regular_lesson(target_credit_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  caller_id uuid := auth.uid();
  credit_row private.lesson_credits%rowtype;
  cancellation_time timestamptz := now();
  credit_granted boolean := false;
  next_status text;
begin
  if caller_id is null then
    raise exception 'Faça login para cancelar sua aula.' using errcode = '42501';
  end if;

  select credit.*
  into credit_row
  from private.lesson_credits credit
  where credit.id = target_credit_id
    and credit.student_id = caller_id
    and credit.revoked_at is null
  for update;

  if not found then
    raise exception 'Crédito de aula não encontrado.';
  end if;

  if credit_row.status <> 'scheduled' or credit_row.regular_starts_at is null then
    raise exception 'Somente uma aula regular confirmada pode ser cancelada por esta ação.';
  end if;

  if cancellation_time < credit_row.regular_starts_at - interval '7 days' then
    raise exception 'Esta aula só poderá ser cancelada nos 7 dias anteriores ao início.';
  end if;

  if not private.lesson_can_be_cancelled(credit_row.regular_starts_at, cancellation_time) then
    raise exception 'Esta aula já começou e não pode mais ser cancelada.';
  end if;

  insert into private.student_regular_lesson_cancellations (
    student_id,
    class_number,
    lesson_date,
    cancelled_by
  ) values (
    caller_id,
    credit_row.regular_class_number,
    (credit_row.regular_starts_at at time zone 'America/Sao_Paulo')::date,
    caller_id
  )
  on conflict (student_id, class_number, lesson_date) do nothing;

  credit_granted := private.lesson_cancellation_grants_credit(
    credit_row.regular_starts_at,
    cancellation_time
  );
  next_status := case when credit_granted then 'available' else 'forfeited' end;

  update private.lesson_credits credit
  set
    status = next_status,
    cancelled_at = cancellation_time
  where credit.id = credit_row.id;

  return jsonb_build_object(
    'ok', true,
    'credit_id', credit_row.id,
    'status', next_status,
    'credit_granted', credit_granted
  );
end;
$function$;


CREATE OR REPLACE FUNCTION public.cancel_my_unpaid_lesson(target_class_number integer, target_starts_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  cancellation_time timestamptz := now();
  grants_replacement boolean;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Faça login para cancelar esta aula.' USING errcode = '42501';
  END IF;

  -- Serialize against payment and credit allocation for this student.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller_id::text, 0)
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles profile
    WHERE profile.id = caller_id
      AND profile.enrolled = true
      AND coalesce(profile.archived, false) = false
  ) THEN
    RAISE EXCEPTION 'Sua matrícula não está ativa.';
  END IF;

  IF target_starts_at IS NULL OR target_starts_at <= cancellation_time THEN
    RAISE EXCEPTION 'Esta aula já começou e não pode mais ser cancelada.';
  END IF;

  IF cancellation_time < target_starts_at - interval '7 days' THEN
    RAISE EXCEPTION 'Esta aula só poderá ser cancelada nos 7 dias anteriores ao início.';
  END IF;

  IF NOT private.lesson_can_be_cancelled(target_starts_at, cancellation_time) THEN
    RAISE EXCEPTION 'Esta aula não está disponível para cancelamento.';
  END IF;

  -- Verify the exact two forecast slots, rather than accepting arbitrary
  -- timestamps supplied by the browser.
  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      coalesce(public.get_my_lesson_forecast()->'predicted_lessons', '[]'::jsonb)
    ) AS preview(lesson)
    WHERE (preview.lesson->>'class_number')::integer = target_class_number
      AND (preview.lesson->>'starts_at')::timestamptz = target_starts_at
      AND preview.lesson->>'status' = 'predicted'
      AND (preview.lesson->>'can_cancel')::boolean = true
  ) THEN
    RAISE EXCEPTION 'Esta aula não está disponível para cancelamento antecipado.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM private.student_regular_lesson_cancellations cancellation
    WHERE cancellation.student_id = caller_id
      AND cancellation.class_number = target_class_number
      AND cancellation.lesson_date =
        (target_starts_at at time zone 'America/Sao_Paulo')::date
  ) THEN
    RAISE EXCEPTION 'Esta aula já foi cancelada.';
  END IF;

  grants_replacement := private.lesson_cancellation_grants_credit(
    target_starts_at, cancellation_time
  );

  INSERT INTO private.unpaid_lesson_cancellations (
    student_id, class_number, starts_at, cancelled_at, eligible_for_replacement
  ) VALUES (
    caller_id, target_class_number, target_starts_at,
    cancellation_time, grants_replacement
  );

  -- The same cancellation ledger also suppresses future class attendance.
  INSERT INTO private.student_regular_lesson_cancellations (
    student_id, class_number, lesson_date, cancelled_by
  ) VALUES (
    caller_id, target_class_number,
    (target_starts_at at time zone 'America/Sao_Paulo')::date,
    caller_id
  ) ON CONFLICT (student_id, class_number, lesson_date) DO NOTHING;

  RETURN jsonb_build_object(
    'ok', true,
    'credit_granted', false,
    'eligible_after_payment', grants_replacement
  );
END;
$function$;


CREATE OR REPLACE FUNCTION public.get_my_lesson_credits()
 RETURNS TABLE(credit_id uuid, reference_month date, credit_number smallint, status text, class_number integer, class_name text, starts_at timestamp with time zone, ends_at timestamp with time zone, meeting_url text, original_class_number integer, original_class_name text, original_starts_at timestamp with time zone, cancellation_deadline timestamp with time zone, can_cancel boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  caller_id uuid := auth.uid();
  local_today date := (now() at time zone 'America/Sao_Paulo')::date;
  active_tuition_id uuid;
begin
  if caller_id is null then
    raise exception 'Faça login para visualizar suas aulas.' using errcode = '42501';
  end if;

  active_tuition_id := private.get_active_settled_tuition_id(caller_id, local_today);

  return query
  select
    credit.id,
    credit.reference_month,
    credit.credit_number,
    credit.status,
    case when credit.status = 'used' then booking.class_number else credit.regular_class_number end,
    case when credit.status = 'used' then booking.class_name else credit.regular_class_name end,
    case when credit.status = 'used' then slot.starts_at else credit.regular_starts_at end,
    case when credit.status = 'used' then slot.ends_at else credit.regular_ends_at end,
    case
      when credit.status = 'used' then booking.meeting_url
      else regular_resource.video_lesson_url
    end,
    credit.regular_class_number,
    credit.regular_class_name,
    credit.regular_starts_at,
    case
      when credit.status = 'scheduled' then credit.regular_starts_at - interval '12 hours'
      else null
    end,
    case
      when credit.status = 'scheduled'
        then private.lesson_can_be_cancelled(credit.regular_starts_at, now())
      else false
    end
  from private.lesson_credits credit
  left join public.makeup_class_bookings booking
    on booking.id = credit.makeup_booking_id
  left join public.makeup_class_slots slot
    on slot.id = booking.slot_id
  left join public.class_resources regular_resource
    on regular_resource.class_number = credit.regular_class_number
  where credit.student_id = caller_id
    and credit.revoked_at is null
    and (
      credit.tuition_id = active_tuition_id
      or credit.status = 'available'
      -- Keep paid future lessons visible after the financial cycle closes,
      -- including when the next tuition has already been paid.
      or (
        credit.status = 'scheduled'
        and credit.regular_starts_at > now()
        and exists (
          select 1
          from public.monthly_tuition paid_tuition
          where paid_tuition.id = credit.tuition_id
            and (paid_tuition.payment_date is not null
              or coalesce(paid_tuition.is_exempt, false))
        )
      )
      or (credit.status = 'used' and slot.starts_at >= local_today::timestamp at time zone 'America/Sao_Paulo')
    )
  order by
    case when credit.status = 'available' then 1 else 0 end,
    coalesce(
      case when credit.status = 'used' then slot.starts_at else credit.regular_starts_at end,
      (credit.reference_month + interval '1 month')::timestamptz
    ) asc,
    credit.reference_month asc,
    credit.credit_number asc;
end;
$function$;


CREATE OR REPLACE FUNCTION public.get_my_lesson_forecast()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  caller_id uuid := auth.uid();
  local_today date := (now() at time zone 'America/Sao_Paulo')::date;
  active_tuition_id uuid;
  projection_start date := (now() at time zone 'America/Sao_Paulo')::date;
  preview_limit integer;
  prepaid_lessons jsonb := '[]'::jsonb;
  predicted_lessons jsonb := '[]'::jsonb;
  first_predicted_date date;
  next_payment_due_date date;
  last_paid_lesson_date date;
begin
  if caller_id is null then
    raise exception 'Faça login para visualizar suas aulas.' using errcode = '42501';
  end if;

  select least(settings.classes_per_month::integer, 8)
    into preview_limit
  from public.student_billing_settings settings
  where settings.student_id = caller_id
    and settings.active = true;

  if preview_limit is null or preview_limit < 1 then
    return jsonb_build_object(
      'prepaid_lessons', prepaid_lessons,
      'predicted_lessons', predicted_lessons,
      'next_payment_due_date', null
    );
  end if;

  -- Only real purchased dates anchor the preview; a paid invoice's coverage
  -- period must not hide unpaid dates between the fourth lesson and renewal.
  select max((credit.regular_starts_at at time zone 'America/Sao_Paulo')::date)
    into last_paid_lesson_date
  from private.lesson_credits credit
  join public.monthly_tuition tuition
    on tuition.id = credit.tuition_id
   and (tuition.payment_date is not null or coalesce(tuition.is_exempt, false))
  where credit.student_id = caller_id
    and credit.credit_origin = 'contract'
    and credit.revoked_at is null
    and credit.regular_starts_at is not null;

  active_tuition_id := private.get_active_settled_tuition_id(caller_id, local_today);
  if last_paid_lesson_date is not null then
    preview_limit := 2;
    projection_start := greatest(local_today, last_paid_lesson_date + 1);
  end if;

  -- A paid future cycle has real, non-revoked credits. These records are
  -- informational here; the canonical lesson RPC owns all student actions.
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'class_number', future.class_number,
        'class_name', future.class_name,
        'starts_at', future.starts_at,
        'status', 'confirmed'
      ) order by future.starts_at, future.class_number
    ),
    '[]'::jsonb
  )
  into prepaid_lessons
  from (
    select
      case when credit.status = 'used'
        then booking.class_number else credit.regular_class_number end as class_number,
      case when credit.status = 'used'
        then booking.class_name else credit.regular_class_name end as class_name,
      case when credit.status = 'used'
        then slot.starts_at else credit.regular_starts_at end as starts_at
    from private.lesson_credits credit
    join public.monthly_tuition tuition
      on tuition.id = credit.tuition_id
     and tuition.student_id = caller_id
     and (tuition.payment_date is not null or coalesce(tuition.is_exempt, false))
    left join public.makeup_class_bookings booking
      on booking.id = credit.makeup_booking_id
     and booking.status = 'confirmed'
    left join public.makeup_class_slots slot
      on slot.id = booking.slot_id
    where credit.student_id = caller_id
      and credit.tuition_id is distinct from active_tuition_id
      and credit.credit_origin = 'contract'
      and credit.revoked_at is null
      and credit.status in ('scheduled', 'used')
      and (case when credit.status = 'used'
        then slot.starts_at else credit.regular_starts_at end) > now()
      and (case when credit.status = 'used'
        then slot.starts_at else credit.regular_starts_at end)
        >= (projection_start::timestamp at time zone 'America/Sao_Paulo')
    order by starts_at, class_number
    limit 16
  ) as future;

  -- Generate two future dates beyond purchased lessons; these do not
  -- create contractual credits, meeting access or attendance rights.
  with class_occurrences as (
    select
      class.class_number,
      class.class_name,
      lesson_day::date as lesson_date,
      ((lesson_day::date + class.class_start_time) at time zone 'America/Sao_Paulo') as starts_at
    from public.class_students membership
    join public.teacher_classes class
      on class.class_number = membership.class_number
     and class.is_active = true
    cross join generate_series(
      projection_start::timestamp,
      (projection_start + 180)::timestamp,
      interval '1 day'
    ) lesson_day
    where membership.user_id = caller_id
      and class.class_weekday between 1 and 7
      and class.class_start_time is not null
      and extract(isodow from lesson_day)::integer = class.class_weekday
      and (class.first_lesson_date is null
        or lesson_day::date >= class.first_lesson_date)
      and (membership.first_lesson_date is null
        or lesson_day::date >= membership.first_lesson_date)
      and (
        membership.first_lesson_date is not null
        or ((lesson_day::date + class.class_start_time) at time zone 'America/Sao_Paulo')
          >= membership.created_at
      )
  ), uncovered_occurrences as (
    select occurrence.*
    from class_occurrences occurrence
    where occurrence.starts_at > now()
      -- A lesson already purchased in a prior cycle must not reappear
      -- as an unpaid forecast in the following financial period.
      and not exists (
        select 1
        from private.lesson_credits paid_credit
        join public.monthly_tuition paid_tuition
          on paid_tuition.id = paid_credit.tuition_id
        where paid_credit.student_id = caller_id
          and paid_credit.credit_origin = 'contract'
          and paid_credit.revoked_at is null
          and paid_credit.status in ('scheduled', 'used')
          and paid_credit.regular_class_number = occurrence.class_number
          and paid_credit.regular_starts_at = occurrence.starts_at
          and (paid_tuition.payment_date is not null
            or coalesce(paid_tuition.is_exempt, false))
      )
  ), next_occurrences as (
    select *
    from uncovered_occurrences
    order by starts_at, class_number
    limit preview_limit
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'class_number', candidate.class_number,
          'class_name', candidate.class_name,
          'starts_at', candidate.starts_at,
          'status', case
            when exists (
              select 1 from private.unpaid_lesson_cancellations cancellation
              where cancellation.student_id = caller_id
                and cancellation.class_number = candidate.class_number
                and cancellation.starts_at = candidate.starts_at
            ) then 'cancelled_pending'
            else 'predicted'
          end,
          'can_cancel', last_paid_lesson_date is not null
            and private.lesson_can_be_cancelled(candidate.starts_at, now())
            and not exists (
              select 1 from private.student_regular_lesson_cancellations existing
              where existing.student_id = caller_id
                and existing.class_number = candidate.class_number
                and existing.lesson_date = candidate.lesson_date
            ),
          'cancellation_deadline', candidate.starts_at - interval '12 hours'
        ) order by candidate.starts_at, candidate.class_number
      ),
      '[]'::jsonb
    ),
    min(candidate.lesson_date)
  into predicted_lessons, first_predicted_date
  from next_occurrences candidate;

  -- Prefer the invoice covering the first projected lesson. Never invent
  -- a financial due date when no matching tuition record exists.
  if first_predicted_date is not null then
    select tuition.due_date
      into next_payment_due_date
    from public.monthly_tuition tuition
    where tuition.student_id = caller_id
      and tuition.payment_date is null
      and coalesce(tuition.is_exempt, false) = false
      and tuition.due_date <= first_predicted_date
      and private.get_tuition_coverage_end(tuition.id) > first_predicted_date
    order by tuition.due_date desc
    limit 1;

    if next_payment_due_date is null then
      select min(tuition.due_date)
        into next_payment_due_date
      from public.monthly_tuition tuition
      where tuition.student_id = caller_id
        and tuition.payment_date is null
        and coalesce(tuition.is_exempt, false) = false
        and tuition.due_date >= local_today;
    end if;
  end if;

  return jsonb_build_object(
    'prepaid_lessons', prepaid_lessons,
    'predicted_lessons', predicted_lessons,
    'next_payment_due_date', next_payment_due_date
  );
end;
$function$;

-- A changed contractual cancellation policy requires renewed student acknowledgement.
-- Historical acceptance records remain intact under their previous policy version.

CREATE OR REPLACE FUNCTION public.accept_my_student_policy_notice(target_policy_version text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  caller_id uuid := auth.uid();
  current_policy_key constant text := 'lesson-cancellation-makeup';
  current_policy_version constant text := '2026-11-05-v2';
  profile_row public.profiles%rowtype;
  accepted_at_value timestamptz;
begin
  if caller_id is null then
    raise exception 'Faça login para aceitar o comunicado.' using errcode = '42501';
  end if;

  if nullif(btrim(target_policy_version), '') is null
     or target_policy_version is distinct from current_policy_version then
    raise exception 'O comunicado foi atualizado. Recarregue a página antes de continuar.';
  end if;

  select profile.*
  into profile_row
  from public.profiles profile
  where profile.id = caller_id
  for update;

  if profile_row.id is null
     or coalesce(profile_row.enrolled, false) = false
     or coalesce(profile_row.archived, false) = true then
    raise exception 'Apenas alunos ativos podem aceitar este comunicado.'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.teacher_admins admin
    where admin.user_id = caller_id
       or lower(admin.email) = lower(coalesce(profile_row.email, ''))
  ) then
    raise exception 'Este comunicado é destinado aos alunos.'
      using errcode = '42501';
  end if;

  insert into private.student_policy_acceptances (
    student_id,
    policy_key,
    policy_version,
    accepted_at
  )
  values (
    caller_id,
    current_policy_key,
    current_policy_version,
    now()
  )
  on conflict (student_id, policy_key, policy_version) do nothing;

  select acceptance.accepted_at
  into accepted_at_value
  from private.student_policy_acceptances acceptance
  where acceptance.student_id = caller_id
    and acceptance.policy_key = current_policy_key
    and acceptance.policy_version = current_policy_version;

  return jsonb_build_object(
    'ok', true,
    'policy_key', current_policy_key,
    'policy_version', current_policy_version,
    'accepted_at', accepted_at_value
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_required_student_policy_notice()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  caller_id uuid := auth.uid();
  current_policy_key constant text := 'lesson-cancellation-makeup';
  current_policy_version constant text := '2026-11-05-v2';
  profile_row public.profiles%rowtype;
  accepted_at_value timestamptz;
begin
  if caller_id is null then
    raise exception 'Faça login para verificar o comunicado.' using errcode = '42501';
  end if;

  select profile.*
  into profile_row
  from public.profiles profile
  where profile.id = caller_id;

  if profile_row.id is null
     or coalesce(profile_row.enrolled, false) = false
     or coalesce(profile_row.archived, false) = true then
    return jsonb_build_object(
      'required', false,
      'policy_key', current_policy_key,
      'policy_version', current_policy_version
    );
  end if;

  if exists (
    select 1
    from public.teacher_admins admin
    where admin.user_id = caller_id
       or lower(admin.email) = lower(coalesce(profile_row.email, ''))
  ) then
    return jsonb_build_object(
      'required', false,
      'policy_key', current_policy_key,
      'policy_version', current_policy_version
    );
  end if;

  select acceptance.accepted_at
  into accepted_at_value
  from private.student_policy_acceptances acceptance
  where acceptance.student_id = caller_id
    and acceptance.policy_key = current_policy_key
    and acceptance.policy_version = current_policy_version;

  return jsonb_build_object(
    'required', accepted_at_value is null,
    'policy_key', current_policy_key,
    'policy_version', current_policy_version,
    'accepted_at', accepted_at_value
  );
end;
$function$;
