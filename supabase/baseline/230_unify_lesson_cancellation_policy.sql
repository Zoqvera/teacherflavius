-- Centralize the student lesson cancellation policy.
-- Cancellation is allowed until the lesson starts.
-- The 12-hour threshold controls only whether a replacement credit is granted.

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
    and evaluated_at < target_starts_at;
$function$;

revoke execute on function private.lesson_can_be_cancelled(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function private.lesson_can_be_cancelled(timestamptz, timestamptz)
  to service_role;

create or replace function private.lesson_cancellation_grants_credit(
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
    and evaluated_at <= target_starts_at - interval '12 hours';
$function$;

revoke execute on function private.lesson_cancellation_grants_credit(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function private.lesson_cancellation_grants_credit(timestamptz, timestamptz)
  to service_role;

create or replace function public.cancel_my_regular_lesson(target_credit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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

revoke execute on function public.cancel_my_regular_lesson(uuid) from public, anon;
grant execute on function public.cancel_my_regular_lesson(uuid) to authenticated, service_role;

create or replace function public.cancel_my_lesson_replacement(target_credit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  credit_row private.lesson_credits%rowtype;
  booking_starts_at timestamptz;
  cancellation_time timestamptz := now();
  credit_granted boolean := false;
  next_status text;
begin
  if caller_id is null then
    raise exception 'Faça login para cancelar sua reposição.' using errcode = '42501';
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

  if credit_row.status <> 'used' or credit_row.makeup_booking_id is null then
    raise exception 'Este crédito não possui uma reposição confirmada.';
  end if;

  select slot.starts_at
  into booking_starts_at
  from public.makeup_class_bookings booking
  join public.makeup_class_slots slot
    on slot.id = booking.slot_id
  where booking.id = credit_row.makeup_booking_id
    and booking.student_id = caller_id
    and booking.status = 'confirmed'
  for update of booking;

  if not found then
    raise exception 'A reserva de reposição não está mais confirmada.';
  end if;

  if not private.lesson_can_be_cancelled(booking_starts_at, cancellation_time) then
    raise exception 'Esta reposição já começou e não pode mais ser cancelada.';
  end if;

  credit_granted := private.lesson_cancellation_grants_credit(
    booking_starts_at,
    cancellation_time
  );
  next_status := case when credit_granted then 'available' else 'forfeited' end;

  update public.makeup_class_bookings booking
  set
    status = 'cancelled',
    cancelled_at = cancellation_time
  where booking.id = credit_row.makeup_booking_id
    and booking.student_id = caller_id
    and booking.status = 'confirmed';

  update private.lesson_credits credit
  set
    status = next_status,
    used_at = null
  where credit.id = credit_row.id;

  insert into public.makeup_class_email_notifications (booking_id, notification_type)
  values (credit_row.makeup_booking_id, 'cancellation')
  on conflict (booking_id, notification_type) do nothing;

  return jsonb_build_object(
    'ok', true,
    'credit_id', credit_row.id,
    'status', next_status,
    'credit_granted', credit_granted
  );
end;
$function$;

revoke execute on function public.cancel_my_lesson_replacement(uuid) from public, anon;
grant execute on function public.cancel_my_lesson_replacement(uuid) to authenticated, service_role;

create or replace function public.get_my_lesson_credits()
returns table(
  credit_id uuid,
  reference_month date,
  credit_number smallint,
  status text,
  class_number integer,
  class_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  meeting_url text,
  original_class_number integer,
  original_class_name text,
  original_starts_at timestamptz,
  cancellation_deadline timestamptz,
  can_cancel boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
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
      when credit.status = 'used' then slot.starts_at - interval '12 hours'
      when credit.status = 'scheduled' then credit.regular_starts_at - interval '12 hours'
      else null
    end,
    case
      when credit.status = 'used' and booking.status = 'confirmed'
        then private.lesson_can_be_cancelled(slot.starts_at, now())
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
      or (
        credit.status = 'used'
        and slot.starts_at >= local_today::timestamp at time zone 'America/Sao_Paulo'
      )
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

revoke execute on function public.get_my_lesson_credits() from public, anon;
grant execute on function public.get_my_lesson_credits() to authenticated, service_role;

notify pgrst, 'reload schema';
