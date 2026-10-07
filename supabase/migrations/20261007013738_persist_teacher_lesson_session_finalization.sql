-- Persist teacher lesson-session finalization so completed class sessions leave the lesson plan.

create table if not exists private.academic_class_session_finalizations (
  id uuid primary key default gen_random_uuid(),
  class_number integer not null,
  class_name text not null,
  starts_at timestamptz not null,
  class_date date not null,
  finalized_at timestamptz not null default now(),
  finalized_by uuid references auth.users(id) on delete set null,
  unique (class_number, starts_at)
);

create index if not exists academic_class_session_finalizations_date_idx
  on private.academic_class_session_finalizations (class_date desc, starts_at desc);

revoke all on table private.academic_class_session_finalizations
  from public, anon, authenticated;
grant select, insert, update, delete on table private.academic_class_session_finalizations
  to service_role;

create or replace function public.get_teacher_lesson_plan(target_date date default null)
returns table (
  entry_id uuid,
  lesson_kind text,
  student_id uuid,
  student_name text,
  class_number integer,
  class_name text,
  starts_at timestamptz,
  lesson_number integer,
  lesson_status text,
  attendance_status text,
  new_questions jsonb,
  review_questions jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
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
      ((effective_date + class.class_start_time) at time zone 'America/Sao_Paulo') as starts_at
    from public.teacher_classes class
    join public.class_students membership
      on membership.class_number = class.class_number
     and membership.user_id is not null
    join public.profiles profile
      on profile.id = membership.user_id
    where class.is_active = true
      and class.class_weekday = extract(isodow from effective_date)::smallint
      and class.class_start_time is not null
      and coalesce(profile.enrolled, false) = true
      and coalesce(profile.archived, false) = false
      and not exists (
        select 1
        from private.student_regular_lesson_cancellations cancellation
        where cancellation.student_id = profile.id
          and cancellation.class_number = class.class_number
          and cancellation.lesson_date = effective_date
      )

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
      slot.starts_at
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
    coalesce(enriched.presented_lesson_number, enriched.next_lesson_number) as lesson_number,
    case
      when enriched.presented_lesson_number is not null then 'presented'
      when exists (
        select 1
        from private.student_lesson_preparations preparation
        where preparation.student_id = enriched.student_id
          and preparation.lesson_number = enriched.next_lesson_number
      ) then 'prepared'
      else 'planned'
    end as lesson_status,
    coalesce(enriched.tracked_attendance_status, 'scheduled') as attendance_status,
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
  where not exists (
    select 1
    from private.academic_class_session_finalizations finalization
    where finalization.class_number = enriched.class_number
      and finalization.starts_at = enriched.starts_at
  )
  order by enriched.starts_at, enriched.student_name, enriched.lesson_kind;
end;
$function$;

revoke execute on function public.get_teacher_lesson_plan(date) from public, anon;
grant execute on function public.get_teacher_lesson_plan(date) to authenticated, service_role;

create or replace function public.finalize_teacher_lesson_session(
  target_class_number integer,
  target_starts_at timestamptz,
  target_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  session_class_name text;
  session_count integer := 0;
  unresolved_names text[];
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso administrativo do professor obrigatório.' using errcode = '42501';
  end if;

  if target_class_number is null or target_starts_at is null or target_date is null then
    raise exception 'Turma, horário e data da aula são obrigatórios.' using errcode = '22023';
  end if;

  if (target_starts_at at time zone 'America/Sao_Paulo')::date is distinct from target_date then
    raise exception 'O horário informado não pertence à data selecionada.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from private.academic_class_session_finalizations finalization
    where finalization.class_number = target_class_number
      and finalization.starts_at = target_starts_at
  ) then
    return jsonb_build_object(
      'ok', true,
      'already_finalized', true,
      'class_number', target_class_number,
      'starts_at', target_starts_at
    );
  end if;

  select
    count(*)::integer,
    min(plan.class_name),
    coalesce(
      array_agg(plan.student_name order by plan.student_name)
        filter (where plan.attendance_status not in ('present', 'absent')),
      '{}'::text[]
    )
  into session_count, session_class_name, unresolved_names
  from public.get_teacher_lesson_plan(target_date) plan
  where plan.class_number = target_class_number
    and plan.starts_at = target_starts_at;

  if session_count = 0 then
    raise exception 'Aula não encontrada ou já finalizada.' using errcode = 'P0002';
  end if;

  if cardinality(unresolved_names) > 0 then
    raise exception 'Falta definir presença ou ausência de: %.', array_to_string(unresolved_names, ', ');
  end if;

  insert into private.academic_class_session_finalizations (
    class_number,
    class_name,
    starts_at,
    class_date,
    finalized_by
  )
  values (
    target_class_number,
    coalesce(session_class_name, 'Turma ' || target_class_number::text),
    target_starts_at,
    target_date,
    auth.uid()
  )
  on conflict (class_number, starts_at) do nothing;

  return jsonb_build_object(
    'ok', true,
    'already_finalized', false,
    'class_number', target_class_number,
    'class_name', session_class_name,
    'starts_at', target_starts_at,
    'class_date', target_date
  );
end;
$function$;

revoke execute on function public.finalize_teacher_lesson_session(integer, timestamptz, date)
  from public, anon;
grant execute on function public.finalize_teacher_lesson_session(integer, timestamptz, date)
  to authenticated, service_role;

notify pgrst, 'reload schema';
