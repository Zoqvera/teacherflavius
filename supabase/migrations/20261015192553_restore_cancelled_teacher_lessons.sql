-- Retain cancelled regular lessons in the teacher's lesson plan with academic work.
-- Finalized classes retain a read-only view of cancelled students.
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
  where enriched.is_cancelled or not exists (
    select 1
    from private.academic_class_session_finalizations finalization
    where finalization.class_number = enriched.class_number
      and finalization.starts_at = enriched.starts_at
  )
  order by enriched.starts_at, enriched.student_name, enriched.lesson_kind;
end;
$function$;


-- Treat cancelled attendees as resolved when finalizing a class.
CREATE OR REPLACE FUNCTION public.finalize_teacher_lesson_session(target_class_number integer, target_starts_at timestamp with time zone, target_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        filter (where plan.attendance_status not in ('present', 'absent', 'cancelled', 'cancelled_finalized')),
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

-- Immutable record of administrative reversal.
create table if not exists private.student_regular_lesson_restorations (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users(id) on delete cascade,
  class_number integer not null,
  lesson_date date not null,
  cancellation_id uuid not null,
  credit_id uuid,
  restored_by uuid references auth.users(id) on delete set null,
  restored_at timestamptz not null default now()
);
revoke all on private.student_regular_lesson_restorations from public, anon, authenticated;

create or replace function public.restore_teacher_cancelled_regular_lesson(
  target_entry_id uuid, target_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  student_id uuid;
  class_id integer;
  scheduled_start timestamptz;
  cancellation_id uuid;
  matching_credits integer;
  matching_credit private.lesson_credits%rowtype;
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso administrativo do professor obrigatório.' using errcode = '42501';
  end if;
  if target_entry_id is null or target_date is null then
    raise exception 'Aluno e data são obrigatórios.' using errcode = '22023';
  end if;

  select membership.user_id, class.class_number,
         ((target_date + class.class_start_time) at time zone 'America/Sao_Paulo')
  into student_id, class_id, scheduled_start
  from public.class_students membership
  join public.teacher_classes class on class.class_number = membership.class_number
  join public.profiles profile on profile.id = membership.user_id
  where membership.id = target_entry_id
    and membership.user_id is not null
    and class.is_active = true
    and class.class_start_time is not null
    and class.class_weekday = extract(isodow from target_date)::smallint
    and coalesce(profile.enrolled, false) = true
    and coalesce(profile.archived, false) = false;
  if not found then
    raise exception 'Aluno não está matriculado nesta turma e data.' using errcode = 'P0002';
  end if;

  select cancellation.id into cancellation_id
  from private.student_regular_lesson_cancellations cancellation
  where cancellation.student_id = student_id
    and cancellation.class_number = class_id
    and cancellation.lesson_date = target_date
  for update;
  if not found then
    raise exception 'Esta aula não está cancelada.' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from private.academic_class_session_finalizations finalization
    where finalization.class_number = class_id and finalization.starts_at = scheduled_start
  ) then
    raise exception 'Esta aula já foi finalizada. Não é possível descancelar após a finalização.' using errcode = '22023';
  end if;

  select count(*) into matching_credits
  from private.lesson_credits credit
  where credit.student_id = student_id
    and credit.credit_origin = 'contract'
    and credit.regular_class_number = class_id
    and credit.regular_starts_at = scheduled_start
    and credit.revoked_at is null;
  if matching_credits > 1 then
    raise exception 'Há créditos conflitantes para esta aula. Regularize antes de descancelar.' using errcode = '23514';
  end if;

  if matching_credits = 1 then
    select credit.* into matching_credit
    from private.lesson_credits credit
    where credit.student_id = student_id
      and credit.credit_origin = 'contract'
      and credit.regular_class_number = class_id
      and credit.regular_starts_at = scheduled_start
      and credit.revoked_at is null
    for update;

    if matching_credit.makeup_booking_id is not null
       or matching_credit.status = 'used'
       or matching_credit.status not in ('available', 'forfeited', 'scheduled') then
      raise exception 'O crédito já está reservado ou foi utilizado. Regularize a reposição antes de descancelar.' using errcode = '22023';
    end if;
    if matching_credit.status in ('available', 'forfeited')
       and matching_credit.cancelled_at is null then
      raise exception 'O crédito não corresponde ao cancelamento desta aula.' using errcode = '22023';
    end if;
    if matching_credit.status in ('available', 'forfeited') then
      update private.lesson_credits credit
      set status = 'scheduled', cancelled_at = null
      where credit.id = matching_credit.id;
    end if;
  end if;

  delete from private.student_regular_lesson_cancellations cancellation
  where cancellation.id = cancellation_id;

  -- Preserve attendance history except automatic absence for teacher day-cancellation.
  delete from public.student_frequency frequency
  where frequency.user_id = student_id
    and frequency.class_date = target_date
    and frequency.attendance_status = 'Faltou'
    and frequency.class_notes = '[Turma ' || class_id || '] Não compareceu na aula.';

  insert into private.student_regular_lesson_restorations (
    student_id, class_number, lesson_date, cancellation_id, credit_id, restored_by
  ) values (
    student_id, class_id, target_date, cancellation_id, matching_credit.id, auth.uid()
  );

  return jsonb_build_object(
    'ok', true, 'student_id', student_id, 'class_number', class_id,
    'lesson_date', target_date, 'credit_reinstated', matching_credit.id is not null
  );
end;
$function$;

revoke execute on function public.restore_teacher_cancelled_regular_lesson(uuid, date)
from public, anon;
grant execute on function public.restore_teacher_cancelled_regular_lesson(uuid, date)
to authenticated;
