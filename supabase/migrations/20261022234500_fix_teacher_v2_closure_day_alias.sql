-- Etapa 5C: remove ambiguous PL/pgSQL identifier in v2 worker.
-- Historical migration 20261022212500 is immutable; this replacement is
-- additive and cannot activate the worker (enabled stays false).
-- The column cancellation.lesson_date is deliberately unchanged.

create or replace function private.run_teacher_v2_auto_finalizations()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  control record;
  session_day date;
  due_class record;
  student record;
  old_status text;
  new_status text;
  snapshot_students jsonb;
  processed integer := 0;
begin
  select * into control
  from private.academic_v2_automation_control
  where singleton = true;

  if not coalesce(control.enabled, false) or control.enabled_from is null then
    return 0;
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(20261022, 4) then
    return 0;
  end if;

  for session_day in
    select ((now() at time zone 'America/Sao_Paulo')::date - days.number)::date
    from generate_series(0, 2) as days(number)
  loop
    for due_class in
      with candidates as (
        select
          class.class_number,
          class.class_name::text as class_name,
          ((session_day + class.class_start_time) at time zone 'America/Sao_Paulo') as starts_at
        from public.teacher_classes class
        where class.is_active is true
          and class.class_start_time is not null
          and class.class_weekday = extract(isodow from session_day)::smallint
          and (class.first_lesson_date is null or session_day >= class.first_lesson_date)
          and exists (
            select 1
            from public.class_students membership
            join public.profiles profile on profile.id = membership.user_id
            where membership.class_number = class.class_number
              and profile.enrolled is true and profile.archived is false
              and (membership.first_lesson_date is null
                or session_day >= membership.first_lesson_date)
          )

        union

        select
          booking.class_number, booking.class_name::text, slot.starts_at
        from public.makeup_class_bookings booking
        join public.makeup_class_slots slot on slot.id = booking.slot_id
        join public.profiles profile on profile.id = booking.student_id
        where booking.status = 'confirmed'
          and slot.is_active is true
          and profile.enrolled is true and profile.archived is false
          and (slot.starts_at at time zone 'America/Sao_Paulo')::date = session_day
      )
      select distinct candidate.class_number, candidate.class_name, candidate.starts_at
      from candidates candidate
      where candidate.starts_at >= control.enabled_from
        and candidate.starts_at + interval '90 minutes' <= now()
        and not exists (
          select 1 from private.academic_class_session_finalizations closed
          where closed.class_number = candidate.class_number
            and closed.starts_at = candidate.starts_at
        )
      order by candidate.starts_at, candidate.class_number
    loop
      snapshot_students := '[]'::jsonb;

      for student in
        with roster as (
          select
            'regular'::text as lesson_kind,
            membership.id as entry_id,
            profile.id as student_id,
            coalesce(nullif(btrim(profile.name), ''), 'Aluno') as student_name,
            exists (
              select 1 from private.student_regular_lesson_cancellations cancellation
              where cancellation.student_id = profile.id
                and cancellation.class_number = due_class.class_number
                and cancellation.lesson_date = session_day
            ) as is_cancelled
          from public.class_students membership
          join public.teacher_classes class
            on class.class_number = membership.class_number
          join public.profiles profile on profile.id = membership.user_id
          where class.class_number = due_class.class_number
            and class.is_active is true
            and class.class_weekday = extract(isodow from session_day)::smallint
            and ((session_day + class.class_start_time)
              at time zone 'America/Sao_Paulo') = due_class.starts_at
            and profile.enrolled is true and profile.archived is false
            and (class.first_lesson_date is null
              or session_day >= class.first_lesson_date)
            and (membership.first_lesson_date is null
              or session_day >= membership.first_lesson_date)

          union all

          select 'makeup'::text, booking.id, profile.id,
            coalesce(nullif(btrim(profile.name), ''), 'Aluno'), false
          from public.makeup_class_bookings booking
          join public.makeup_class_slots slot on slot.id = booking.slot_id
          join public.profiles profile on profile.id = booking.student_id
          where booking.class_number = due_class.class_number
            and slot.starts_at = due_class.starts_at
            and booking.status = 'confirmed'
            and slot.is_active is true
            and profile.enrolled is true and profile.archived is false
        )
        select * from roster order by student_name, student_id
      loop
        old_status := null;
        new_status := 'cancelled';

        if not student.is_cancelled then
          select occurrence.attendance_status into old_status
          from private.academic_lesson_occurrences occurrence
          where occurrence.occurrence_key = private.academic_occurrence_key(
            student.lesson_kind, student.entry_id, session_day
          );

          if old_status = 'present' then
            new_status := 'present';
          elsif exists (
            select 1 from private.academic_lesson_occurrences occurrence
            where occurrence.occurrence_key = private.academic_occurrence_key(
              student.lesson_kind, student.entry_id, session_day
            ) and (
              occurrence.presented_lesson_number is not null
              or exists (
                select 1 from private.conversation_question_practice_log practice
                where practice.occurrence_id = occurrence.id
              )
            )
          ) then
            new_status := 'present';
            perform private.sync_academic_attendance(
              student.lesson_kind, student.entry_id, session_day, new_status
            );
          else
            new_status := 'absent';
            if old_status is distinct from 'absent' then
              perform private.sync_academic_attendance(
                student.lesson_kind, student.entry_id, session_day, new_status
              );
              insert into private.academic_v2_attendance_audit (
                lesson_kind, entry_id, student_id, class_number, starts_at,
                previous_status, new_status, change_reason, action
              ) values (
                student.lesson_kind, student.entry_id, student.student_id,
                due_class.class_number, due_class.starts_at, old_status, new_status,
                'Sem apresentação, avaliação ou participação até 90 minutos após o início.',
                'automatic_absence'
              );
            end if;
          end if;
        end if;

        snapshot_students := snapshot_students || jsonb_build_array(
          jsonb_build_object(
            'entry_id', student.entry_id,
            'student_id', student.student_id,
            'student_name', student.student_name,
            'lesson_kind', student.lesson_kind,
            'attendance_status', new_status
          )
        );
      end loop;

      if jsonb_array_length(snapshot_students) > 0 then
        insert into private.academic_class_session_finalizations (
          class_number, class_name, starts_at, class_date, finalized_by
        ) values (
          due_class.class_number, due_class.class_name,
          due_class.starts_at, session_day, null
        ) on conflict (class_number, starts_at) do nothing;

        insert into private.academic_v2_closed_session_snapshots (
          class_number, class_name, starts_at, class_date, students
        ) values (
          due_class.class_number, due_class.class_name,
          due_class.starts_at, session_day, snapshot_students
        ) on conflict (class_number, starts_at) do nothing;

        processed := processed + 1;
      end if;
    end loop;
  end loop;
  return processed;
end;
$function$;


comment on function private.run_teacher_v2_auto_finalizations() is
  'Roteiro v2: fecha somente aulas elegíveis; variável session_day não conflita com colunas SQL. Desativado por padrão.';
