-- Enforce a strict 12-hour cancellation deadline for student lesson cards.

create or replace function public.cancel_my_regular_lesson(target_credit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  credit_row private.lesson_credits%rowtype;
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

  if now() > credit_row.regular_starts_at - interval '12 hours' then
    raise exception 'O prazo para cancelamento terminou 12 horas antes da aula.';
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

  update private.lesson_credits credit
  set
    status = 'available',
    cancelled_at = now()
  where credit.id = credit_row.id;

  return jsonb_build_object(
    'ok', true,
    'credit_id', credit_row.id,
    'status', 'available',
    'credit_granted', true
  );
end;
$function$;

revoke execute on function public.cancel_my_regular_lesson(uuid) from public, anon;
grant execute on function public.cancel_my_regular_lesson(uuid) to authenticated, service_role;

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
    case when credit.status = 'used' then booking.meeting_url else regular_resource.video_lesson_url end,
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
        then now() <= slot.starts_at - interval '12 hours'
      when credit.status = 'scheduled'
        then now() <= credit.regular_starts_at - interval '12 hours'
      else false
    end
  from private.lesson_credits credit
  left join public.makeup_class_bookings booking on booking.id = credit.makeup_booking_id
  left join public.makeup_class_slots slot on slot.id = booking.slot_id
  left join public.class_resources regular_resource on regular_resource.class_number = credit.regular_class_number
  where credit.student_id = caller_id
    and credit.revoked_at is null
    and (
      (
        credit.status = 'scheduled'
        and credit.tuition_id = active_tuition_id
        and credit.regular_starts_at > now()
      )
      or (
        credit.status = 'used'
        and booking.status = 'confirmed'
        and slot.starts_at > now()
      )
    )
  order by
    case when credit.status = 'used' then slot.starts_at else credit.regular_starts_at end asc,
    credit.credit_number asc;
end;
$function$;

revoke execute on function public.get_my_lesson_credits() from public, anon;
grant execute on function public.get_my_lesson_credits() to authenticated, service_role;

notify pgrst, 'reload schema';
