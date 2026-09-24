create or replace function public.get_teacher_students_of_day()
returns table (
  entry_id uuid,
  lesson_kind text,
  student_id uuid,
  student_name text,
  whatsapp text,
  class_number integer,
  class_name text,
  starts_at timestamptz,
  lesson_to_present text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  target_date date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not coalesce(public.is_teacher_admin_mfa(), false) then
    raise exception 'MFA do professor é obrigatório.' using errcode = '42501';
  end if;

  return query
  with lesson_progress as (
    select
      clr.user_id,
      max(substring(clr.lesson_code from 2)::integer)
        filter (where clr.lesson_code ~ '^L[0-9]+$') as max_lesson_number
    from public.class_lesson_records clr
    where clr.user_id is not null
      and clr.class_date < target_date
    group by clr.user_id
  ),
  regular_lessons as (
    select
      cs.id as entry_id,
      'regular'::text as lesson_kind,
      p.id as student_id,
      coalesce(nullif(btrim(p.name), ''), nullif(btrim(p.email), ''), 'Aluno')::text as student_name,
      nullif(btrim(p.whatsapp), '')::text as whatsapp,
      tc.class_number,
      tc.class_name::text as class_name,
      ((target_date + tc.class_start_time) at time zone 'America/Sao_Paulo') as starts_at,
      case
        when progress.max_lesson_number is null then 'L1'
        when progress.max_lesson_number >= 74 then 'Concluído'
        else 'L' || (progress.max_lesson_number + 1)::text
      end::text as lesson_to_present
    from public.teacher_classes tc
    join public.class_students cs
      on cs.class_number = tc.class_number
     and cs.user_id is not null
    join public.profiles p
      on p.id = cs.user_id
    left join lesson_progress progress
      on progress.user_id = p.id
    where tc.is_active = true
      and tc.class_weekday = extract(isodow from target_date)::smallint
      and tc.class_start_time is not null
      and coalesce(p.enrolled, false) = true
      and coalesce(p.archived, false) = false
      and not exists (
        select 1
        from private.student_regular_lesson_cancellations cancellation
        where cancellation.student_id = p.id
          and cancellation.class_number = tc.class_number
          and cancellation.lesson_date = target_date
      )
  ),
  makeup_lessons as (
    select
      booking.id as entry_id,
      'makeup'::text as lesson_kind,
      booking.student_id,
      coalesce(
        nullif(btrim(profile.name), ''),
        nullif(btrim(booking.student_name), ''),
        nullif(btrim(booking.student_email), ''),
        'Aluno'
      )::text as student_name,
      nullif(btrim(profile.whatsapp), '')::text as whatsapp,
      booking.class_number,
      booking.class_name::text as class_name,
      slot.starts_at,
      case
        when progress.max_lesson_number is null then 'L1'
        when progress.max_lesson_number >= 74 then 'Concluído'
        else 'L' || (progress.max_lesson_number + 1)::text
      end::text as lesson_to_present
    from public.makeup_class_bookings booking
    join public.makeup_class_slots slot
      on slot.id = booking.slot_id
    join public.profiles profile
      on profile.id = booking.student_id
    left join lesson_progress progress
      on progress.user_id = booking.student_id
    where booking.status = 'confirmed'
      and slot.is_active = true
      and coalesce(profile.enrolled, false) = true
      and coalesce(profile.archived, false) = false
      and (slot.starts_at at time zone 'America/Sao_Paulo')::date = target_date
  ),
  trial_lessons as (
    select
      appointment.id as entry_id,
      'trial'::text as lesson_kind,
      null::uuid as student_id,
      appointment.visitor_name::text as student_name,
      nullif(btrim(appointment.whatsapp), '')::text as whatsapp,
      appointment.class_number,
      coalesce(
        nullif(btrim(appointment.class_name_snapshot), ''),
        case when appointment.lesson_mode = 'individual'
          then 'Aula experimental individual'
          else 'Aula experimental'
        end
      )::text as class_name,
      appointment.starts_at,
      null::text as lesson_to_present
    from private.trial_lesson_appointments appointment
    where appointment.status = 'scheduled'
      and (appointment.starts_at at time zone 'America/Sao_Paulo')::date = target_date
  )
  select daily.entry_id,
         daily.lesson_kind,
         daily.student_id,
         daily.student_name,
         daily.whatsapp,
         daily.class_number,
         daily.class_name,
         daily.starts_at,
         daily.lesson_to_present
  from (
    select * from regular_lessons
    union all
    select * from makeup_lessons
    union all
    select * from trial_lessons
  ) daily
  order by daily.starts_at asc, daily.student_name asc, daily.lesson_kind asc;
end;
$function$;

revoke all on function public.get_teacher_students_of_day() from public, anon, authenticated;
grant execute on function public.get_teacher_students_of_day() to authenticated;
