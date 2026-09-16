-- Corrective baseline overlay for the automatic makeup-slot synchronizer.
-- Any booking row is historical data and therefore protects its referenced slot
-- from deletion, matching makeup_class_bookings_slot_id_fkey (ON DELETE RESTRICT).

create or replace function public.sync_auto_makeup_slots_30_days()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  deleted_count integer := 0;
  inserted_count integer := 0;
begin
  delete from public.makeup_class_slots s
  where s.is_auto_generated = true
    and s.starts_at > now()
    and not exists (
      select 1
      from public.makeup_class_bookings b
      where b.slot_id = s.id
    );
  get diagnostics deleted_count = row_count;

  with student_counts as (
    select
      tc.class_number,
      count(cs.id) filter (
        where cs.invite_id is not null
           or (
             cs.user_id is not null
             and coalesce(p.enrolled, false) = true
             and coalesce(p.archived, false) = false
           )
      )::integer as student_count
    from public.teacher_classes tc
    left join public.class_students cs on cs.class_number = tc.class_number
    left join public.profiles p on p.id = cs.user_id
    where tc.is_active = true
    group by tc.class_number
  ), desired as (
    select
      tc.class_number,
      coalesce(nullif(trim(tc.class_name), ''), 'Turma ' || tc.class_number)::text as class_name,
      nullif(trim(cr.video_lesson_url), '')::text as meeting_url,
      d::date as class_date,
      ((d::date + tc.class_start_time) at time zone 'America/Sao_Paulo') as starts_at,
      (((d::date + tc.class_start_time) + interval '1 hour') at time zone 'America/Sao_Paulo') as ends_at,
      case sc.student_count
        when 4 then 1
        when 3 then 2
        when 2 then 3
        else 0
      end::integer as capacity
    from public.teacher_classes tc
    join student_counts sc on sc.class_number = tc.class_number
    left join public.class_resources cr on cr.class_number = tc.class_number
    cross join generate_series(
      (now() at time zone 'America/Sao_Paulo')::date,
      (now() at time zone 'America/Sao_Paulo')::date + 29,
      interval '1 day'
    ) as d
    where tc.is_active = true
      and coalesce(tc.makeup_slots_enabled, true) = true
      and tc.class_weekday between 1 and 7
      and tc.class_start_time is not null
      and extract(isodow from d)::integer = tc.class_weekday
      and sc.student_count in (2, 3, 4)
      and nullif(trim(cr.video_lesson_url), '') ~* '^https?://'
  )
  insert into public.makeup_class_slots (
    class_number, class_name, meeting_url, starts_at, ends_at,
    capacity, notes, is_active, created_by, is_auto_generated
  )
  select
    d.class_number, d.class_name, d.meeting_url, d.starts_at, d.ends_at,
    d.capacity, null, true, null, true
  from desired d
  where d.starts_at > now()
    and not exists (
      select 1
      from public.makeup_class_slots existing
      where existing.class_number = d.class_number
        and existing.starts_at = d.starts_at
        and existing.is_active = true
    );
  get diagnostics inserted_count = row_count;

  return jsonb_build_object(
    'ok', true,
    'window_days', 30,
    'deleted_unbooked_auto_slots', deleted_count,
    'inserted_auto_slots', inserted_count,
    'generated_at', now()
  );
end;
$$;
