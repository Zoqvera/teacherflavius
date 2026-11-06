-- TeacherFlavius.com — only federal Brazilian national holidays are non-instructional.
-- Nine fixed national holidays plus Good Friday, based on the federal 2026 calendar.
-- Excludes municipal/state holidays, Carnaval, Corpus Christi, and optional leave days.
-- Preserve contractual credit records; never grant makeup credits for national holidays.
-- Official sources: Portaria MGI 11.460/2025 and amendment 8.821/2026.

BEGIN;

-- 1. private.national_holiday_name(date)
CREATE OR REPLACE FUNCTION private.national_holiday_name(target_date date)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  y integer;
  a integer; b integer; c integer; d integer; e integer;
  f integer; g integer; h integer; i integer; k integer;
  l integer; m integer; n integer; day_num integer;
  good_friday date;
BEGIN
  IF target_date IS NULL THEN RETURN NULL; END IF;
  CASE to_char(target_date, 'MM-DD')
    WHEN '01-01' THEN RETURN 'Confraternização Universal';
    WHEN '04-21' THEN RETURN 'Tiradentes';
    WHEN '05-01' THEN RETURN 'Dia do Trabalho';
    WHEN '09-07' THEN RETURN 'Independência do Brasil';
    WHEN '10-12' THEN RETURN 'Nossa Senhora Aparecida';
    WHEN '11-02' THEN RETURN 'Finados';
    WHEN '11-15' THEN RETURN 'Proclamação da República';
    WHEN '11-20' THEN RETURN 'Dia Nacional de Zumbi e da Consciência Negra';
    WHEN '12-25' THEN RETURN 'Natal';
    ELSE NULL;
  END CASE;
  y := extract(year from target_date)::int;
  IF y < 1900 OR y > 2199 THEN RETURN NULL; END IF;
  a := y % 19;
  b := y / 100;
  c := y % 100;
  d := b / 4;
  e := b % 4;
  f := (b + 8) / 25;
  g := (b - f + 1) / 3;
  h := (19 * a + b - d - g + 15) % 30;
  i := c / 4;
  k := c % 4;
  l := (32 + 2 * e + 2 * i - h - k) % 7;
  m := (a + 11 * h + 22 * l) / 451;
  n := (h + l - 7 * m + 114) / 31;
  day_num := (h + l - 7 * m + 114) % 31 + 1;
  good_friday := make_date(y, n, day_num) - 2;
  IF target_date = good_friday THEN RETURN 'Paixão de Cristo (Sexta-feira Santa)'; END IF;
  RETURN NULL;
END
$function$;

-- 2. private.is_national_holiday(date)
CREATE OR REPLACE FUNCTION private.is_national_holiday(target_date date)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$ SELECT private.national_holiday_name(target_date) IS NOT NULL $function$;

-- 3. public.get_national_holidays(integer)
CREATE OR REPLACE FUNCTION public.get_national_holidays(target_year integer DEFAULT (EXTRACT(year FROM CURRENT_DATE))::integer)
 RETURNS TABLE(holiday_date date, holiday_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT d::date AS holiday_date, private.national_holiday_name(d::date) AS holiday_name
 FROM generate_series(make_date(target_year,1,1)::timestamp,make_date(target_year,12,31)::timestamp,interval '1 day') d
 WHERE private.is_national_holiday(d::date)
   AND target_year BETWEEN 1900 AND 2199
 ORDER BY 1
$function$;

-- 4. private.lesson_can_be_cancelled(timestamptz,timestamptz)
CREATE OR REPLACE FUNCTION private.lesson_can_be_cancelled(target_starts_at timestamp with time zone, evaluated_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select target_starts_at is not null
    and evaluated_at >= target_starts_at - interval '7 days'
    and evaluated_at < target_starts_at
    and not private.is_national_holiday((target_starts_at at time zone 'America/Sao_Paulo')::date);
$function$;

-- 5. private.lesson_cancellation_grants_credit(timestamptz,timestamptz)
CREATE OR REPLACE FUNCTION private.lesson_cancellation_grants_credit(target_starts_at timestamp with time zone, evaluated_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select target_starts_at is not null
    and evaluated_at <= target_starts_at - interval '12 hours'
    and not private.is_national_holiday((target_starts_at at time zone 'America/Sao_Paulo')::date);
$function$;

-- 6. private.is_replacement_credit_eligible(text,timestamptz,timestamptz)
CREATE OR REPLACE FUNCTION private.is_replacement_credit_eligible(credit_origin text, cancelled_at timestamp with time zone, regular_starts_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select
    credit_origin = 'manual_grant'
    or (
      credit_origin = 'contract'
      and cancelled_at is not null
      and regular_starts_at is not null
      and cancelled_at <= regular_starts_at - interval '12 hours'
      and not private.is_national_holiday((regular_starts_at at time zone 'America/Sao_Paulo')::date)
    );
$function$;

-- 7. private.sync_academic_attendance(text,uuid,date,text)
CREATE OR REPLACE FUNCTION private.sync_academic_attendance(target_lesson_kind text, target_entry_id uuid, target_date date, target_status text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  resolved record;
  saved_occurrence_id uuid;
  current_occurrence private.academic_lesson_occurrences%rowtype;
  frequency_id uuid;
  sequence_number integer;
  normalized_status text := lower(btrim(coalesce(target_status, '')));
begin
  if private.is_national_holiday(target_date) then
    raise exception 'Feriado nacional: não há presença nem falta nesta data.' using errcode = '22023';
  end if;
  if normalized_status not in ('present', 'absent') then
    raise exception 'Situação de frequência inválida.' using errcode = '22023';
  end if;

  select *
  into resolved
  from private.resolve_academic_lesson(target_lesson_kind, target_entry_id, target_date);

  if resolved.student_id is null then
    raise exception 'Aula não encontrada ou não disponível para registro.' using errcode = 'P0002';
  end if;

  insert into private.academic_lesson_occurrences (
    occurrence_key,
    student_id,
    lesson_kind,
    source_entry_id,
    class_number,
    class_name,
    starts_at
  )
  values (
    resolved.occurrence_key,
    resolved.student_id,
    lower(btrim(target_lesson_kind)),
    target_entry_id,
    resolved.class_number,
    resolved.class_name,
    resolved.starts_at
  )
  on conflict (occurrence_key) do update
  set
    class_number = excluded.class_number,
    class_name = excluded.class_name,
    starts_at = excluded.starts_at,
    updated_at = now()
  returning id into saved_occurrence_id;

  select occurrence.*
  into current_occurrence
  from private.academic_lesson_occurrences occurrence
  where occurrence.id = saved_occurrence_id
  for update;

  if normalized_status = 'absent'
     and (
       current_occurrence.presented_lesson_number is not null
       or exists (
         select 1
         from private.conversation_question_practice_log practice
         where practice.occurrence_id = saved_occurrence_id
       )
     ) then
    raise exception 'Esta aula já possui conteúdo registrado. Desfaça esses registros antes de marcar ausência.';
  end if;

  select frequency.id
  into frequency_id
  from public.student_frequency frequency
  where frequency.user_id = resolved.student_id
    and frequency.class_date = target_date
    and frequency.class_notes like ('[Turma ' || resolved.class_number || ']%')
  order by frequency.updated_at desc, frequency.created_at desc
  limit 1
  for update;

  if frequency_id is null then
    insert into public.student_frequency (
      user_id,
      class_date,
      attendance_status,
      class_notes
    )
    values (
      resolved.student_id,
      target_date,
      case when normalized_status = 'present' then 'Compareceu' else 'Faltou' end,
      case
        when normalized_status = 'present'
          then '[Turma ' || resolved.class_number || '] Presença registrada no Roteiro da Aula.'
        else '[Turma ' || resolved.class_number || '] Não compareceu na aula.'
      end
    )
    returning id into frequency_id;
  else
    update public.student_frequency frequency
    set
      attendance_status = case when normalized_status = 'present' then 'Compareceu' else 'Faltou' end,
      class_notes = case
        when normalized_status = 'present'
          then '[Turma ' || resolved.class_number || '] Presença registrada no Roteiro da Aula.'
        else '[Turma ' || resolved.class_number || '] Não compareceu na aula.'
      end,
      updated_at = now()
    where frequency.id = frequency_id;
  end if;

  if normalized_status = 'present' then
    sequence_number := current_occurrence.attendance_sequence;
    if sequence_number is null then
      sequence_number := private.academic_planned_attendance_sequence(
        resolved.student_id,
        target_date
      );
    end if;

    update private.academic_lesson_occurrences occurrence
    set
      attendance_status = 'present',
      attendance_sequence = sequence_number,
      attendance_record_id = frequency_id,
      updated_at = now()
    where occurrence.id = saved_occurrence_id;

    delete from public.class_lesson_records record
    where record.class_number = resolved.class_number
      and record.user_id = resolved.student_id
      and record.class_date = target_date
      and record.lesson_code = 'Não compareceu';
  else
    update private.academic_lesson_occurrences occurrence
    set
      attendance_status = 'absent',
      attendance_sequence = null,
      attendance_record_id = frequency_id,
      updated_at = now()
    where occurrence.id = saved_occurrence_id;

    insert into public.class_lesson_records (
      class_number,
      user_id,
      class_date,
      lesson_code
    )
    values (
      resolved.class_number,
      resolved.student_id,
      target_date,
      'Não compareceu'
    )
    on conflict do nothing;
  end if;

  return saved_occurrence_id;
end;
$function$;

-- 8. private.assert_teacher_v2_session_open(text,uuid,date)
CREATE OR REPLACE FUNCTION private.assert_teacher_v2_session_open(target_lesson_kind text, target_entry_id uuid, target_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  lesson record;
begin
  if auth.uid() is null or not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso administrativo do professor obrigatório.' using errcode = '42501';
  end if;

  if target_lesson_kind not in ('regular', 'makeup')
     or target_entry_id is null or target_date is null then
    raise exception 'Aula inválida.' using errcode = '22023';
  end if;

  if private.is_national_holiday(target_date) then
    raise exception 'Feriado nacional: não há aula nem registro de frequência nesta data.' using errcode = '22023';
  end if;

  -- Lock shared with the automatic finalizer prevents registration/closure races.
  perform pg_catalog.pg_advisory_xact_lock(20261022, 4);

  select * into lesson from private.resolve_academic_lesson(
    target_lesson_kind, target_entry_id, target_date
  );
  if lesson.student_id is null then
    raise exception 'Aula não encontrada ou cancelada.' using errcode = 'P0002';
  end if;

  if now() < lesson.starts_at - interval '30 minutes' then
    raise exception 'O registro ainda não foi liberado. A janela abre às % (horário de Brasília).',
      to_char(
        (lesson.starts_at - interval '30 minutes') at time zone 'America/Sao_Paulo',
        'HH24:MI'
      );
  end if;

  if now() >= lesson.starts_at + interval '90 minutes' then
    raise exception 'Janela de registro encerrada. Utilize a correção administrativa.';
  end if;

  if exists (
    select 1 from private.academic_class_session_finalizations closed
    where closed.class_number = lesson.class_number
      and closed.starts_at = lesson.starts_at
  ) then
    raise exception 'Aula já encerrada. Utilize a correção administrativa.';
  end if;
end;
$function$;

-- 9. private.run_teacher_v2_auto_finalizations()
CREATE OR REPLACE FUNCTION private.run_teacher_v2_auto_finalizations()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      where not private.is_national_holiday(session_day)
        and candidate.starts_at >= control.enabled_from
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

-- 10. public.get_teacher_lesson_plan(date)
CREATE OR REPLACE FUNCTION public.get_teacher_lesson_plan(target_date date DEFAULT NULL::date)
 RETURNS TABLE(entry_id uuid, lesson_kind text, student_id uuid, student_name text, class_number integer, class_name text, starts_at timestamp with time zone, lesson_number integer, lesson_status text, attendance_status text, new_questions jsonb, review_questions jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  effective_date date := coalesce(target_date, (now() at time zone 'America/Sao_Paulo')::date);
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso administrativo do professor obrigatório.' using errcode = '42501';
  end if;

  return query
  with scheduled as (
    select
      membership.id as entry_id,
      'regular'::text as lesson_kind,
      profile.id as student_id,
      coalesce(nullif(btrim(profile.name), ''), nullif(btrim(profile.email), ''), 'Aluno')::text as student_name,
      class.class_number,
      class.class_name::text as class_name,
      ((effective_date + class.class_start_time) at time zone 'America/Sao_Paulo') as starts_at,
      exists (
        select 1 from private.student_regular_lesson_cancellations cancellation
        where cancellation.student_id = profile.id
          and cancellation.class_number = class.class_number
          and cancellation.lesson_date = effective_date
      ) as is_cancelled
    from public.teacher_classes class
    join public.class_students membership
      on membership.class_number = class.class_number
     and membership.user_id is not null
    and (membership.first_lesson_date is null or effective_date >= membership.first_lesson_date)
    and (class.first_lesson_date is null or effective_date >= class.first_lesson_date)
    join public.profiles profile
      on profile.id = membership.user_id
    where class.is_active = true
      and class.class_weekday = extract(isodow from effective_date)::smallint
      and class.class_start_time is not null
      and coalesce(profile.enrolled, false) = true
      and coalesce(profile.archived, false) = false

    union all

    select
      booking.id,
      'makeup'::text,
      booking.student_id,
      coalesce(
        nullif(btrim(profile.name), ''),
        nullif(btrim(booking.student_name), ''),
        nullif(btrim(booking.student_email), ''),
        'Aluno'
      )::text,
      booking.class_number,
      booking.class_name::text,
      slot.starts_at,
      false as is_cancelled
    from public.makeup_class_bookings booking
    join public.makeup_class_slots slot
      on slot.id = booking.slot_id
    join public.profiles profile
      on profile.id = booking.student_id
    where booking.status = 'confirmed'
      and slot.is_active = true
      and coalesce(profile.enrolled, false) = true
      and coalesce(profile.archived, false) = false
      and (slot.starts_at at time zone 'America/Sao_Paulo')::date = effective_date
  ),
  enriched as (
    select
      scheduled.*,
      occurrence.id as occurrence_id,
      occurrence.attendance_status as tracked_attendance_status,
      occurrence.attendance_sequence,
      occurrence.presented_lesson_number,
      occurrence.planned_lesson_number,
      private.academic_next_lesson_number(scheduled.student_id) as next_lesson_number,
      private.academic_planned_attendance_sequence(
        scheduled.student_id,
        effective_date
      ) as planned_sequence
    from scheduled
    left join private.academic_lesson_occurrences occurrence
      on occurrence.occurrence_key = private.academic_occurrence_key(
        scheduled.lesson_kind,
        scheduled.entry_id,
        effective_date
      )
  )
  select
    enriched.entry_id,
    enriched.lesson_kind,
    enriched.student_id,
    enriched.student_name,
    enriched.class_number,
    enriched.class_name,
    enriched.starts_at,
    coalesce(enriched.presented_lesson_number, enriched.planned_lesson_number, enriched.next_lesson_number) as lesson_number,
    case
      when enriched.presented_lesson_number is not null then 'presented'
      when exists (
        select 1
        from private.student_lesson_preparations preparation
        where preparation.student_id = enriched.student_id
          and preparation.lesson_number = coalesce(enriched.planned_lesson_number, enriched.next_lesson_number)
      ) then 'prepared'
      else 'planned'
    end as lesson_status,
    case
      when enriched.is_cancelled and exists (
        select 1 from private.academic_class_session_finalizations finalization
        where finalization.class_number = enriched.class_number
          and finalization.starts_at = enriched.starts_at
      ) then 'cancelled_finalized'
      when enriched.is_cancelled then 'cancelled'
      else coalesce(enriched.tracked_attendance_status, 'scheduled')
    end as attendance_status,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', question.id,
          'text', question.question_text,
          'display_order', question.display_order,
          'source', 'new'
        )
        order by question.display_order, question.id
      )
      from private.student_question_studies study
      join public.conversation_questions question
        on question.id = study.question_id
      where study.student_id = enriched.student_id
        and not exists (
          select 1
          from private.conversation_question_practice_log practice
          where practice.student_id = enriched.student_id
            and practice.question_id = study.question_id
        )
    ), '[]'::jsonb) as new_questions,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', question.id,
          'text', question.question_text,
          'display_order', question.display_order,
          'source', 'review',
          'last_rating', latest.rating,
          'due_attendance_sequence', latest.due_attendance_sequence
        )
        order by latest.due_attendance_sequence, question.display_order, question.id
      )
      from (
        select distinct on (practice.question_id)
          practice.question_id,
          practice.rating,
          practice.due_attendance_sequence,
          practice.attendance_sequence,
          practice.practiced_at
        from private.conversation_question_practice_log practice
        where practice.student_id = enriched.student_id
        order by
          practice.question_id,
          practice.attendance_sequence desc,
          practice.practiced_at desc
      ) latest
      join public.conversation_questions question
        on question.id = latest.question_id
      where latest.due_attendance_sequence <= case
        when enriched.tracked_attendance_status = 'present'
             and enriched.attendance_sequence is not null
          then enriched.attendance_sequence
        else enriched.planned_sequence
      end
    ), '[]'::jsonb) as review_questions
  from enriched
  where not private.is_national_holiday(effective_date)
    and not exists (
    select 1
    from private.academic_class_session_finalizations finalization
    where finalization.class_number = enriched.class_number
      and finalization.starts_at = enriched.starts_at
  )
  order by enriched.starts_at, enriched.student_name, enriched.lesson_kind;
end;
$function$;

-- 11. public.sync_auto_makeup_slots_30_days()
CREATE OR REPLACE FUNCTION public.sync_auto_makeup_slots_30_days()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      case
        when sc.student_count between 2 and 4
          then (5 - sc.student_count) + 3
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
      and not private.is_national_holiday(d::date)
      and (tc.first_lesson_date is null or d::date >= tc.first_lesson_date)
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
$function$;

-- 12. public.get_available_makeup_slots()
CREATE OR REPLACE FUNCTION public.get_available_makeup_slots()
 RETURNS TABLE(id text, class_number integer, class_name text, starts_at timestamp with time zone, ends_at timestamp with time zone, remaining_spots integer, notes text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Faca login para visualizar os horarios.';
  end if;

  if not exists (
    select 1
    from public.class_students cs
    join public.teacher_classes tc
      on tc.class_number = cs.class_number
     and tc.is_active = true
    where cs.user_id = auth.uid()
  ) then
    raise exception 'Voce ainda nao foi inscrito em uma turma pelo professor.';
  end if;

  return query
  select
    s.id::text,
    s.class_number,
    s.class_name,
    s.starts_at,
    s.ends_at,
    (s.capacity - count(b.id))::integer as remaining_spots,
    coalesce(s.notes, '')::text
  from public.makeup_class_slots s
  left join public.makeup_class_bookings b
    on b.slot_id = s.id
   and b.status = 'confirmed'
  where s.is_active = true
    and not private.is_national_holiday((s.starts_at at time zone 'America/Sao_Paulo')::date)
    and s.starts_at > now()
    and s.class_number is not null
    and coalesce(trim(s.meeting_url), '') ~* '^https?://'
  group by
    s.id,
    s.class_number,
    s.class_name,
    s.starts_at,
    s.ends_at,
    s.capacity,
    s.notes
  having count(b.id) < s.capacity
  order by s.starts_at asc;
end;
$function$;

-- 13. public.get_my_lesson_credits()
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
    and not (credit.status = 'scheduled' and private.is_national_holiday((credit.regular_starts_at at time zone 'America/Sao_Paulo')::date))
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

-- 14. private.enforce_national_holiday_no_attendance()
CREATE OR REPLACE FUNCTION private.enforce_national_holiday_no_attendance()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
 IF private.is_national_holiday(NEW.class_date) THEN
   RAISE EXCEPTION 'Feriado nacional (%): não registrar presença ou ausência.', NEW.class_date USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $function$;

-- 15. private.enforce_national_holiday_no_class_record()
CREATE OR REPLACE FUNCTION private.enforce_national_holiday_no_class_record()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
 IF private.is_national_holiday(NEW.class_date) THEN
   RAISE EXCEPTION 'Feriado nacional (%): não existe aula a registrar.', NEW.class_date USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $function$;

-- 16. private.enforce_national_holiday_no_makeup_slot()
CREATE OR REPLACE FUNCTION private.enforce_national_holiday_no_makeup_slot()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
 IF NEW.is_active IS TRUE AND private.is_national_holiday((NEW.starts_at AT TIME ZONE 'America/Sao_Paulo')::date) THEN
   RAISE EXCEPTION 'Feriado nacional: não é possível publicar aula ou reposição nesta data.' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $function$;

-- 17. private.enforce_national_holiday_no_student_cancellation()
CREATE OR REPLACE FUNCTION private.enforce_national_holiday_no_student_cancellation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
 IF private.is_national_holiday(NEW.lesson_date) THEN
   RAISE EXCEPTION 'Feriado nacional: não há aula para cancelar nem crédito de reposição.' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $function$;

-- 18. private.enforce_national_holiday_no_available_contract_credit()
CREATE OR REPLACE FUNCTION private.enforce_national_holiday_no_available_contract_credit()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
 IF NEW.credit_origin = 'contract' AND NEW.status = 'available'
    AND NEW.regular_starts_at IS NOT NULL
    AND private.is_national_holiday((NEW.regular_starts_at AT TIME ZONE 'America/Sao_Paulo')::date) THEN
   RAISE EXCEPTION 'Feriado nacional: crédito de reposição não pode ser liberado por esta data.' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $function$;

-- 19. private.enforce_national_holiday_no_academic_occurrence()
CREATE OR REPLACE FUNCTION private.enforce_national_holiday_no_academic_occurrence()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
 IF private.is_national_holiday((NEW.starts_at AT TIME ZONE 'America/Sao_Paulo')::date) THEN
   RAISE EXCEPTION 'Feriado nacional: aula regular ou de reposição não ministrada.' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS block_attendance_on_national_holiday ON public.student_frequency;
CREATE TRIGGER block_attendance_on_national_holiday BEFORE INSERT OR UPDATE OF class_date, attendance_status ON public.student_frequency
FOR EACH ROW EXECUTE FUNCTION private.enforce_national_holiday_no_attendance();

DROP TRIGGER IF EXISTS block_class_record_on_national_holiday ON public.class_lesson_records;
CREATE TRIGGER block_class_record_on_national_holiday BEFORE INSERT OR UPDATE OF class_date, lesson_code ON public.class_lesson_records
FOR EACH ROW EXECUTE FUNCTION private.enforce_national_holiday_no_class_record();

DROP TRIGGER IF EXISTS block_makeup_slot_on_national_holiday ON public.makeup_class_slots;
CREATE TRIGGER block_makeup_slot_on_national_holiday BEFORE INSERT OR UPDATE OF starts_at, is_active ON public.makeup_class_slots
FOR EACH ROW EXECUTE FUNCTION private.enforce_national_holiday_no_makeup_slot();

DROP TRIGGER IF EXISTS block_student_cancellation_on_national_holiday ON private.student_regular_lesson_cancellations;
CREATE TRIGGER block_student_cancellation_on_national_holiday BEFORE INSERT OR UPDATE OF lesson_date ON private.student_regular_lesson_cancellations
FOR EACH ROW EXECUTE FUNCTION private.enforce_national_holiday_no_student_cancellation();

DROP TRIGGER IF EXISTS block_holiday_contract_credit_release ON private.lesson_credits;
CREATE TRIGGER block_holiday_contract_credit_release BEFORE INSERT OR UPDATE OF status, credit_origin, regular_starts_at ON private.lesson_credits
FOR EACH ROW EXECUTE FUNCTION private.enforce_national_holiday_no_available_contract_credit();

DROP TRIGGER IF EXISTS block_academic_occurrence_on_national_holiday ON private.academic_lesson_occurrences;
CREATE TRIGGER block_academic_occurrence_on_national_holiday BEFORE INSERT OR UPDATE OF starts_at, attendance_status ON private.academic_lesson_occurrences
FOR EACH ROW EXECUTE FUNCTION private.enforce_national_holiday_no_academic_occurrence();

COMMENT ON FUNCTION private.is_national_holiday(date) IS 'Feriados nacionais brasileiros: nove datas fixas e Paixão de Cristo. Não inclui pontos facultativos ou feriados estaduais e municipais; rever alterações legais anualmente.';
COMMENT ON FUNCTION public.get_national_holidays(integer) IS 'Lista exclusivamente feriados nacionais brasileiros para um ano, sem pontos facultativos.';

-- Calendar RPC is read-only but intentionally available only to signed-in users.
-- Keep the anonymous SECURITY DEFINER allow-list unchanged.
REVOKE EXECUTE ON FUNCTION public.get_national_holidays(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_national_holidays(integer) TO authenticated, service_role;

-- Keep private-schema functions inaccessible to anon and authenticated roles.
REVOKE EXECUTE ON FUNCTION private.national_holiday_name(date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION private.is_national_holiday(date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION private.enforce_national_holiday_no_attendance() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION private.enforce_national_holiday_no_class_record() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION private.enforce_national_holiday_no_makeup_slot() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION private.enforce_national_holiday_no_student_cancellation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION private.enforce_national_holiday_no_available_contract_credit() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION private.enforce_national_holiday_no_academic_occurrence() FROM PUBLIC, anon, authenticated;

COMMIT;
