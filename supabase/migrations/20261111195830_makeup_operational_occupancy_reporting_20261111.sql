-- Reposicoes: disponibilidade real inclui alunos regulares, cancelamentos
-- confirmados e reservas ja efetuadas. O legado nao reflete a lotacao real.
create or replace function public.get_teacher_makeup_slot_occupancy()
returns table (
  slot_id text,
  class_number integer,
  operational_capacity integer,
  regular_students integer,
  seat_holds integer,
  cancelled_regular_students integer,
  confirmed_bookings integer,
  expected_participants integer,
  available_spots integer,
  over_capacity integer,
  is_regular_occurrence boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not public.is_teacher_admin() then
    raise exception 'Acesso administrativo do professor obrigatório.'
      using errcode = '42501';
  end if;

  return query
  with slot_context as (
    select
      slot.id,
      slot.class_number,
      slot.starts_at,
      slot.is_active,
      least(
        slot.capacity,
        coalesce(private.get_class_operational_capacity(slot.class_number), slot.capacity)
      )::integer as capacity_limit,
      (
        extract(isodow from slot.starts_at at time zone 'America/Sao_Paulo')::integer
          = class.class_weekday
        and (slot.starts_at at time zone 'America/Sao_Paulo')::time
          = class.class_start_time
        and (class.first_lesson_date is null or
             (slot.starts_at at time zone 'America/Sao_Paulo')::date >= class.first_lesson_date)
      ) as is_regular
    from public.makeup_class_slots slot
    join public.teacher_classes class
      on class.class_number = slot.class_number
  ), attendee_counts as (
    select
      context.*,
      (case when context.is_regular then
        private.count_class_seat_members(context.class_number)
      else 0 end)::integer as regular_count,
      (case when context.is_regular then
        private.count_class_seat_holds(context.class_number)
      else 0 end)::integer as hold_count,
      (case when context.is_regular then (
        select count(distinct cancellation.student_id)::integer
        from private.student_regular_lesson_cancellations cancellation
        join public.class_students membership
          on membership.class_number = cancellation.class_number
         and membership.user_id = cancellation.student_id
        join public.profiles profile
          on profile.id = membership.user_id
        where cancellation.class_number = context.class_number
          and cancellation.lesson_date =
            (context.starts_at at time zone 'America/Sao_Paulo')::date
          and coalesce(profile.enrolled, false)
          and not coalesce(profile.archived, false)
      ) else 0 end)::integer as cancelled_count,
      (
        select count(*)::integer
        from public.makeup_class_bookings booking
        join public.makeup_class_slots booked_slot
          on booked_slot.id = booking.slot_id
        where booking.class_number = context.class_number
          and booked_slot.starts_at = context.starts_at
          and booked_slot.is_active
          and booking.status = 'confirmed'
      ) as booking_count
    from slot_context context
  ), totals as (
    select
      counts.*,
      (counts.regular_count + counts.hold_count
       - counts.cancelled_count + counts.booking_count)::integer as participants
    from attendee_counts counts
  )
  select
    totals.id::text,
    totals.class_number,
    totals.capacity_limit,
    totals.regular_count,
    totals.hold_count,
    totals.cancelled_count,
    totals.booking_count,
    totals.participants,
    case when totals.is_active
      then greatest(0, totals.capacity_limit - totals.participants)::integer
      else 0 end,
    greatest(0, totals.participants - totals.capacity_limit)::integer,
    totals.is_regular
  from totals;
end;
$function$;

revoke execute on function public.get_teacher_makeup_slot_occupancy()
  from public, anon, authenticated;
grant execute on function public.get_teacher_makeup_slot_occupancy()
  to authenticated, service_role;

comment on function public.get_teacher_makeup_slot_occupancy() is
  'Teacher-only estimated attendance for makeup slots; regular students and live seat holds consume capacity, confirmed cancellations free seats. Existing bookings remain unchanged.';

-- Existing manual slot capacities may exceed the class operational limit.
-- Never delete or cancel existing bookings while adjusting these settings.
update public.makeup_class_slots as slot
set capacity = private.get_class_operational_capacity(slot.class_number),
    updated_at = now()
where slot.is_active
  and slot.starts_at > now()
  and slot.capacity > private.get_class_operational_capacity(slot.class_number)
  and private.get_class_operational_capacity(slot.class_number) is not null;
