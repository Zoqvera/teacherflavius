-- Cancelamento administrativo auditável de apresentações no Roteiro da Aula v2.
-- A correção é permitida também depois do encerramento da turma.
create or replace function public.cancel_teacher_lesson_presentation_v2(
  target_lesson_kind text,
  target_entry_id uuid,
  target_date date,
  target_lesson_number integer,
  target_attendance_status text,
  target_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  resolved record;
  recorded_occurrence private.academic_lesson_occurrences%rowtype;
  presentation_recorded_at timestamptz;
  normalized_reason text := btrim(coalesce(target_reason, ''));
begin
  if auth.uid() is null or not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso administrativo do professor obrigatório.' using errcode = '42501';
  end if;
  if target_lesson_kind not in ('regular', 'makeup')
     or target_entry_id is null or target_date is null
     or target_lesson_number is null
     or target_lesson_number not between 1 and 74
     or target_attendance_status is null
     or target_attendance_status not in ('present', 'absent')
     or char_length(normalized_reason) not between 8 and 500 then
    raise exception 'Informe uma apresentação, frequência e justificativa válidas (8 a 500 caracteres).'
      using errcode = '22023';
  end if;

  -- Compatível com o worker de fechamento e os registros v2.
  perform pg_catalog.pg_advisory_xact_lock(20261022, 4);
  select * into resolved
  from private.resolve_academic_lesson(
    target_lesson_kind, target_entry_id, target_date
  );
  if resolved.student_id is null then
    raise exception 'Aula não encontrada ou cancelada.' using errcode = 'P0002';
  end if;

  select occurrence.* into recorded_occurrence
  from private.academic_lesson_occurrences occurrence
  where occurrence.occurrence_key = resolved.occurrence_key
  for update;

  if recorded_occurrence.id is null
     or recorded_occurrence.presented_lesson_number is distinct from target_lesson_number then
    raise exception 'O registro da apresentação mudou. Atualize o roteiro antes de cancelar.'
      using errcode = 'P0002';
  end if;

  if target_attendance_status = 'absent' and exists (
    select 1 from private.conversation_question_practice_log practice
    where practice.occurrence_id = recorded_occurrence.id
  ) then
    raise exception 'Há perguntas avaliadas nesta aula. Mantenha a presença ou corrija as avaliações antes de marcar ausência.';
  end if;

  select lesson.created_at into presentation_recorded_at
  from public.class_lesson_records lesson
  where lesson.class_number = resolved.class_number
    and lesson.user_id = resolved.student_id
    and lesson.class_date = target_date
    and lesson.lesson_code = 'L' || target_lesson_number::text
  order by lesson.created_at desc
  limit 1;

  update private.academic_lesson_occurrences occurrence
  set presented_lesson_number = null, updated_at = now()
  where occurrence.id = recorded_occurrence.id;

  -- A frequência é definida explicitamente pelo professor; nunca se infere
  -- ausência apenas pelo cancelamento de uma apresentação.
  if recorded_occurrence.attendance_status is distinct from target_attendance_status then
    perform private.sync_academic_attendance(
      target_lesson_kind, target_entry_id, target_date, target_attendance_status
    );
  end if;

  delete from public.class_lesson_records lesson
  where lesson.class_number = resolved.class_number
    and lesson.user_id = resolved.student_id
    and lesson.class_date = target_date
    and lesson.lesson_code = 'L' || target_lesson_number::text;

  -- Exclui apenas a conclusão criada pelo mesmo lançamento da apresentação.
  -- Uma conclusão independente do aluno ou de outra aula é preservada.
  if presentation_recorded_at is not null and not exists (
    select 1 from private.academic_lesson_occurrences other
    where other.student_id = resolved.student_id
      and other.presented_lesson_number = target_lesson_number
  ) then
    delete from public.study_roadmap_completion completion
    where completion.user_id = resolved.student_id
      and completion.lesson_id = 'lesson-' || target_lesson_number::text
      and abs(extract(epoch from (completion.created_at - presentation_recorded_at))) < 2
      and abs(extract(epoch from (completion.completed_at - presentation_recorded_at))) < 2;
  end if;

  insert into private.academic_v2_attendance_audit (
    lesson_kind, entry_id, student_id, class_number, starts_at,
    previous_status, new_status, change_reason, action, changed_by
  ) values (
    target_lesson_kind, target_entry_id, resolved.student_id,
    resolved.class_number, resolved.starts_at,
    recorded_occurrence.attendance_status, target_attendance_status,
    'Apresentação ' || target_lesson_number || ' cancelada: ' || normalized_reason,
    'admin_correction', auth.uid()
  );

  return jsonb_build_object(
    'ok', true,
    'occurrence_id', recorded_occurrence.id,
    'cancelled_lesson_number', target_lesson_number,
    'attendance_status', target_attendance_status
  );
end;
$function$;

revoke all on function public.cancel_teacher_lesson_presentation_v2(text,uuid,date,integer,text,text)
  from public, anon;
grant execute on function public.cancel_teacher_lesson_presentation_v2(text,uuid,date,integer,text,text)
  to authenticated;

-- O histórico de aulas encerradas reflete o progresso atual, inclusive
-- depois de uma correção administrativa posterior ao fechamento.
create or replace function public.get_teacher_v2_closed_sessions(target_date date)
returns table (
  class_number integer, class_name text, starts_at timestamptz,
  finalized_at timestamptz, students jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso administrativo do professor obrigatório.' using errcode = '42501';
  end if;
  if target_date is null then
    raise exception 'Data da aula obrigatória.' using errcode = '22023';
  end if;

  return query
  select
    closed.class_number, closed.class_name, closed.starts_at,
    closed.finalized_at,
    case when snapshot.students is not null then (
      select coalesce(jsonb_agg(
        student_row.details || jsonb_build_object(
          'attendance_status', case
            when student_row.details->>'attendance_status' = 'cancelled'
              then 'cancelled'
            else coalesce(occurrence.attendance_status,
              student_row.details->>'attendance_status')
          end,
          'lesson_status', case
            when occurrence.presented_lesson_number is not null then 'presented'
            else 'planned'
          end,
          'lesson_number', coalesce(
            occurrence.presented_lesson_number,
            occurrence.planned_lesson_number,
            private.academic_next_lesson_number(occurrence.student_id)
          )
        ) order by student_row.position
      ), '[]'::jsonb)
      from jsonb_array_elements(snapshot.students) with ordinality
        as student_row(details, position)
      left join private.academic_lesson_occurrences occurrence
        on occurrence.occurrence_key = private.academic_occurrence_key(
          student_row.details->>'lesson_kind',
          (student_row.details->>'entry_id')::uuid,
          closed.class_date
        )
    ) else (
      select coalesce(jsonb_agg(jsonb_build_object(
        'student_id', occurrence.student_id,
        'student_name', coalesce(profile.name, 'Aluno'),
        'entry_id', occurrence.source_entry_id,
        'lesson_kind', occurrence.lesson_kind,
        'attendance_status', occurrence.attendance_status,
        'lesson_status', case
          when occurrence.presented_lesson_number is not null then 'presented'
          else 'planned'
        end,
        'lesson_number', coalesce(
          occurrence.presented_lesson_number,
          occurrence.planned_lesson_number,
          private.academic_next_lesson_number(occurrence.student_id)
        )
      ) order by profile.name), '[]'::jsonb)
      from private.academic_lesson_occurrences occurrence
      left join public.profiles profile on profile.id = occurrence.student_id
      where occurrence.class_number = closed.class_number
        and occurrence.starts_at = closed.starts_at
    ) end as students
  from private.academic_class_session_finalizations closed
  left join private.academic_v2_closed_session_snapshots snapshot
    on snapshot.class_number = closed.class_number
   and snapshot.starts_at = closed.starts_at
  where closed.class_date = target_date
  order by closed.starts_at, closed.class_number;
end;
$function$;

revoke all on function public.get_teacher_v2_closed_sessions(date) from public, anon;
grant execute on function public.get_teacher_v2_closed_sessions(date) to authenticated;
