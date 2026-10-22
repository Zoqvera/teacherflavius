-- Atribuição manual de lição por aula, independente de apresentação.
-- A progressão automática considera exclusivamente lições efetivamente apresentadas.
alter table private.academic_lesson_occurrences
  add column if not exists planned_lesson_number integer
  constraint academic_lesson_occurrences_planned_lesson_number_check
  check (planned_lesson_number between 1 and 74);

comment on column private.academic_lesson_occurrences.planned_lesson_number is
  'Lição programada para uma ocorrência específica, sem comprovação de apresentação.';

create or replace function public.set_teacher_planned_lesson(
  target_lesson_kind text, target_entry_id uuid,
  target_date date, target_lesson_number integer
)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  resolved record;
  saved_occurrence_id uuid;
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso administrativo do professor obrigatório.' using errcode = '42501';
  end if;
  if target_lesson_number is not null
     and target_lesson_number not between 1 and 74 then
    raise exception 'A lição deve estar entre 1 e 74.' using errcode = '22023';
  end if;

  select * into resolved
  from private.resolve_academic_lesson(target_lesson_kind, target_entry_id, target_date);
  if resolved.student_id is null then
    raise exception 'Aula não encontrada, cancelada ou indisponível.' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from private.academic_class_session_finalizations finalization
    where finalization.class_number = resolved.class_number
      and finalization.starts_at = resolved.starts_at
  ) then
    raise exception 'Não é possível alterar a lição de uma aula finalizada.';
  end if;

  if target_lesson_number is null then
    update private.academic_lesson_occurrences occurrence
    set planned_lesson_number = null, updated_at = now()
    where occurrence.occurrence_key = resolved.occurrence_key
      and occurrence.presented_lesson_number is null;
    if not found and exists (
      select 1 from private.academic_lesson_occurrences occurrence
      where occurrence.occurrence_key = resolved.occurrence_key
        and occurrence.presented_lesson_number is not null
    ) then
      raise exception 'A lição já foi apresentada e não pode ser reprogramada.';
    end if;
  else
    insert into private.academic_lesson_occurrences (
      occurrence_key, student_id, lesson_kind, source_entry_id,
      class_number, class_name, starts_at, planned_lesson_number
    )
    values (
      resolved.occurrence_key, resolved.student_id,
      lower(btrim(target_lesson_kind)), target_entry_id,
      resolved.class_number, resolved.class_name,
      resolved.starts_at, target_lesson_number
    )
    on conflict (occurrence_key) do update
    set planned_lesson_number = excluded.planned_lesson_number,
        updated_at = now()
    where private.academic_lesson_occurrences.presented_lesson_number is null
    returning id into saved_occurrence_id;
    if saved_occurrence_id is null then
      raise exception 'A lição já foi apresentada e não pode ser reprogramada.';
    end if;
  end if;

  return jsonb_build_object(
    'ok', true, 'student_id', resolved.student_id,
    'lesson_number', target_lesson_number,
    'class_date', target_date
  );
end;
$function$;

revoke execute on function public.set_teacher_planned_lesson(text, uuid, date, integer)
  from public, anon;
grant execute on function public.set_teacher_planned_lesson(text, uuid, date, integer)
  to authenticated, service_role;

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
  where not exists (
    select 1
    from private.academic_class_session_finalizations finalization
    where finalization.class_number = enriched.class_number
      and finalization.starts_at = enriched.starts_at
  )
  order by enriched.starts_at, enriched.student_name, enriched.lesson_kind;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.mark_teacher_lesson_presented(target_lesson_kind text, target_entry_id uuid, target_date date, target_lesson_number integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  resolved record;
  occurrence_id uuid;
  expected_lesson integer;
  lesson_title text;
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso administrativo do professor obrigatório.' using errcode = '42501';
  end if;

  select *
  into resolved
  from private.resolve_academic_lesson(target_lesson_kind, target_entry_id, target_date);

  if resolved.student_id is null then
    raise exception 'Aula não encontrada ou cancelada.' using errcode = 'P0002';
  end if;

  expected_lesson := coalesce(
    (select occurrence.planned_lesson_number
     from private.academic_lesson_occurrences occurrence
     where occurrence.occurrence_key = resolved.occurrence_key),
    private.academic_next_lesson_number(resolved.student_id)
  );
  if expected_lesson is null then
    raise exception 'O aluno já concluiu todas as lições disponíveis.';
  end if;

  if target_lesson_number is distinct from expected_lesson then
    raise exception 'A lição prevista mudou. Atualize o roteiro antes de registrar.';
  end if;

  occurrence_id := private.sync_academic_attendance(
    target_lesson_kind,
    target_entry_id,
    target_date,
    'present'
  );

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
    'L' || target_lesson_number::text
  )
  on conflict do nothing;

  select coalesce(nullif(btrim(page.title), ''), 'Lição ' || target_lesson_number::text)
  into lesson_title
  from public.study_lesson_pages page
  where page.roadmap_lesson_number = target_lesson_number
  limit 1;

  lesson_title := coalesce(lesson_title, 'Lição ' || target_lesson_number::text);

  insert into public.study_roadmap_completion (
    user_id,
    lesson_id,
    lesson_number,
    lesson_title,
    completed,
    completed_at
  )
  values (
    resolved.student_id,
    'lesson-' || target_lesson_number::text,
    target_lesson_number,
    lesson_title,
    true,
    now()
  )
  on conflict (user_id, lesson_id) do update
  set
    lesson_number = excluded.lesson_number,
    lesson_title = excluded.lesson_title,
    completed = true,
    completed_at = coalesce(public.study_roadmap_completion.completed_at, now()),
    updated_at = now();

  update private.academic_lesson_occurrences occurrence
  set
    presented_lesson_number = target_lesson_number,
    updated_at = now()
  where occurrence.id = occurrence_id;

  return jsonb_build_object(
    'ok', true,
    'occurrence_id', occurrence_id,
    'lesson_number', target_lesson_number
  );
end;
$function$
;
