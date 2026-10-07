-- Retire the legacy student makeup flow without stranding future reservations.
-- Future confirmed legacy bookings are represented as already-used manual credits
-- so cancellation uses the canonical lesson policy:
-- cancel until lesson start; return credit only at least 12 hours beforehand.

do $migration$
declare
  bookings_without_active_tuition integer;
  tuitions_exceeding_credit_limit integer;
begin
  select count(*)::integer
  into bookings_without_active_tuition
  from public.makeup_class_bookings booking
  join public.makeup_class_slots slot
    on slot.id = booking.slot_id
  where booking.status = 'confirmed'
    and slot.starts_at > now()
    and not exists (
      select 1
      from private.lesson_credits credit
      where credit.makeup_booking_id = booking.id
        and credit.revoked_at is null
    )
    and private.get_active_settled_tuition_id(
      booking.student_id,
      (now() at time zone 'America/Sao_Paulo')::date
    ) is null;

  if bookings_without_active_tuition > 0 then
    raise exception
      'Cannot retire legacy makeup flow: % future booking(s) have no active settled tuition.',
      bookings_without_active_tuition;
  end if;

  with legacy_future as (
    select
      booking.id as booking_id,
      private.get_active_settled_tuition_id(
        booking.student_id,
        (now() at time zone 'America/Sao_Paulo')::date
      ) as tuition_id
    from public.makeup_class_bookings booking
    join public.makeup_class_slots slot
      on slot.id = booking.slot_id
    where booking.status = 'confirmed'
      and slot.starts_at > now()
      and not exists (
        select 1
        from private.lesson_credits credit
        where credit.makeup_booking_id = booking.id
          and credit.revoked_at is null
      )
  ),
  booking_counts as (
    select
      legacy.tuition_id,
      count(*)::integer as booking_count
    from legacy_future legacy
    group by legacy.tuition_id
  ),
  credit_maximums as (
    select
      credit.tuition_id,
      coalesce(max(credit.credit_number), 0)::integer as max_credit_number
    from private.lesson_credits credit
    group by credit.tuition_id
  )
  select count(*)::integer
  into tuitions_exceeding_credit_limit
  from booking_counts bookings
  left join credit_maximums maximums
    on maximums.tuition_id = bookings.tuition_id
  where coalesce(maximums.max_credit_number, 0) + bookings.booking_count > 31;

  if tuitions_exceeding_credit_limit > 0 then
    raise exception
      'Cannot retire legacy makeup flow: imported booking credits would exceed the per-tuition credit-number limit.';
  end if;
end;
$migration$;

with legacy_future as (
  select
    booking.id as booking_id,
    booking.student_id,
    booking.booked_at,
    slot.starts_at,
    private.get_active_settled_tuition_id(
      booking.student_id,
      (now() at time zone 'America/Sao_Paulo')::date
    ) as tuition_id
  from public.makeup_class_bookings booking
  join public.makeup_class_slots slot
    on slot.id = booking.slot_id
  where booking.status = 'confirmed'
    and slot.starts_at > now()
    and not exists (
      select 1
      from private.lesson_credits credit
      where credit.makeup_booking_id = booking.id
        and credit.revoked_at is null
    )
),
numbered_legacy_bookings as (
  select
    legacy.booking_id,
    legacy.student_id,
    legacy.booked_at,
    legacy.tuition_id,
    tuition.reference_month,
    (
      coalesce(
        (
          select max(existing.credit_number)::integer
          from private.lesson_credits existing
          where existing.tuition_id = legacy.tuition_id
        ),
        0
      )
      + row_number() over (
          partition by legacy.tuition_id
          order by legacy.starts_at asc, legacy.booking_id asc
        )
    )::smallint as credit_number
  from legacy_future legacy
  join public.monthly_tuition tuition
    on tuition.id = legacy.tuition_id
)
insert into private.lesson_credits (
  student_id,
  tuition_id,
  reference_month,
  credit_number,
  status,
  credit_origin,
  makeup_booking_id,
  used_at
)
select
  legacy.student_id,
  legacy.tuition_id,
  legacy.reference_month,
  legacy.credit_number,
  'used',
  'manual_grant',
  legacy.booking_id,
  coalesce(legacy.booked_at, now())
from numbered_legacy_bookings legacy;

revoke execute on function public.book_makeup_class(uuid)
  from public, anon, authenticated;
revoke execute on function public.cancel_my_makeup_class_booking(uuid)
  from public, anon, authenticated;
revoke execute on function public.get_available_makeup_slots()
  from public, anon, authenticated;
revoke execute on function public.get_my_makeup_bookings()
  from public, anon, authenticated;

notify pgrst, 'reload schema';
