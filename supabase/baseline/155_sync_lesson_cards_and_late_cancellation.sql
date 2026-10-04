alter table private.lesson_credits
  drop constraint if exists lesson_credits_status_check;

alter table private.lesson_credits
  add constraint lesson_credits_status_check
  check (status = any (array['scheduled'::text, 'available'::text, 'used'::text, 'forfeited'::text]));

create or replace function private.sync_lesson_credits_after_plan_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  tuition_record record;
begin
  if new.classes_per_month is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.classes_per_month is not distinct from old.classes_per_month then
    return new;
  end if;

  for tuition_record in
    select tuition.id
    from public.monthly_tuition tuition
    where tuition.student_id = new.student_id
      and (
        tuition.payment_date is not null
        or coalesce(tuition.is_exempt, false) = true
      )
  loop
    perform private.sync_lesson_credits_for_tuition(tuition_record.id);
  end loop;

  return new;
end;
$$;

drop trigger if exists sync_lesson_credits_after_plan_change
  on public.student_billing_settings;

create trigger sync_lesson_credits_after_plan_change
after insert or update of classes_per_month
on public.student_billing_settings
for each row
execute function private.sync_lesson_credits_after_plan_change();

create or replace function public.cancel_my_regular_lesson(target_credit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  credit_row private.lesson_credits%rowtype;
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

  if now() >= credit_row.regular_starts_at then
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

  credit_granted := now() <= credit_row.regular_starts_at - interval '12 hours';
  next_status := case when credit_granted then 'available' else 'forfeited' end;

  update private.lesson_credits credit
  set
    status = next_status,
    cancelled_at = now()
  where credit.id = credit_row.id;

  return jsonb_build_object(
    'ok', true,
    'credit_id', credit_row.id,
    'status', next_status,
    'credit_granted', credit_granted
  );
end;
$$;

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
as $$
declare
  caller_id uuid := auth.uid();
  current_month date := date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date;
begin
  if caller_id is null then
    raise exception 'Faça login para visualizar suas aulas.' using errcode = '42501';
  end if;

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
        then now() <= slot.starts_at - interval '12 hours'
      when credit.status = 'scheduled'
        then now() < credit.regular_starts_at
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
      credit.reference_month = current_month
      or credit.status = 'available'
      or (credit.status = 'used' and slot.starts_at >= current_month::timestamptz)
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
$$;

revoke execute on function public.get_my_lesson_credits() from public, anon;
grant execute on function public.get_my_lesson_credits() to authenticated, service_role;

do $$
declare
  tuition_record record;
begin
  for tuition_record in
    select tuition.id
    from public.monthly_tuition tuition
    join public.student_billing_settings settings
      on settings.student_id = tuition.student_id
    where settings.classes_per_month is not null
      and (
        tuition.payment_date is not null
        or coalesce(tuition.is_exempt, false) = true
      )
  loop
    perform private.sync_lesson_credits_for_tuition(tuition_record.id);
  end loop;
end;
$$;
