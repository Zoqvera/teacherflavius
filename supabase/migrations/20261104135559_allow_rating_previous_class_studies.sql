-- Allow the teacher to rate last class's prepared questions in the current open class.
-- Preserve the existing rating log, attendance transaction and 5/3/1 revision intervals.
CREATE OR REPLACE FUNCTION public.rate_teacher_conversation_question(target_lesson_kind text, target_entry_id uuid, target_date date, target_question_id uuid, target_rating text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  resolved record;
  occurrence private.academic_lesson_occurrences%rowtype;
  normalized_rating text := lower(btrim(coalesce(target_rating, '')));
  review_interval integer;
  is_new_question boolean := false;
  is_due_review boolean := false;
  is_previous_class_question boolean := false;
  due_sequence integer;
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso administrativo do professor obrigatório.' using errcode = '42501';
  end if;

  if normalized_rating not in ('good', 'medium', 'improve') then
    raise exception 'Avaliação inválida.' using errcode = '22023';
  end if;

  select *
  into resolved
  from private.resolve_academic_lesson(target_lesson_kind, target_entry_id, target_date);

  if resolved.student_id is null then
    raise exception 'Aula não encontrada ou cancelada.' using errcode = 'P0002';
  end if;

  select occurrence_row.*
  into occurrence
  from private.academic_lesson_occurrences occurrence_row
  where occurrence_row.occurrence_key = resolved.occurrence_key
  for update;

  if occurrence.id is null
     or occurrence.attendance_status <> 'present'
     or occurrence.attendance_sequence is null then
    raise exception 'Registre a presença do aluno antes de avaliar perguntas.';
  end if;

  select exists (
    select 1
    from private.student_question_studies study
    where study.student_id = resolved.student_id
      and study.question_id = target_question_id
      and not exists (
        select 1
        from private.conversation_question_practice_log practice
        where practice.student_id = resolved.student_id
          and practice.question_id = target_question_id
      )
  )
  into is_new_question;

  select exists (
    select 1
    from (
      select practice.due_attendance_sequence
      from private.conversation_question_practice_log practice
      where practice.student_id = resolved.student_id
        and practice.question_id = target_question_id
      order by practice.attendance_sequence desc, practice.practiced_at desc
      limit 1
    ) latest
    where latest.due_attendance_sequence <= occurrence.attendance_sequence
  )
  into is_due_review;

  -- A pergunta preparada para a aula anterior também pode ser avaliada
  -- no encontro atual, sem alterar a avaliação histórica já registrada.
  if not is_new_question and not is_due_review then
    select exists (
      select 1
      from public.get_teacher_previous_class_studies(target_date) previous
      cross join lateral pg_catalog.jsonb_array_elements(previous.questions) question
      where previous.entry_id = target_entry_id
        and previous.student_id = resolved.student_id
        and previous.class_number = resolved.class_number
        and question.value ->> 'id' = target_question_id::text
    )
    into is_previous_class_question;
  end if;

  if not is_new_question and not is_due_review and not is_previous_class_question then
    raise exception 'Esta pergunta não está prevista para a aula atual.';
  end if;

  review_interval := case normalized_rating
    when 'good' then 5
    when 'medium' then 3
    else 1
  end;

  due_sequence := occurrence.attendance_sequence + review_interval;

  insert into private.conversation_question_practice_log (
    occurrence_id,
    student_id,
    question_id,
    rating,
    attendance_sequence,
    due_attendance_sequence,
    evaluated_by
  )
  values (
    occurrence.id,
    resolved.student_id,
    target_question_id,
    normalized_rating,
    occurrence.attendance_sequence,
    due_sequence,
    auth.uid()
  )
  on conflict (occurrence_id, question_id) do update
  set
    rating = excluded.rating,
    attendance_sequence = excluded.attendance_sequence,
    due_attendance_sequence = excluded.due_attendance_sequence,
    practiced_at = now(),
    evaluated_by = excluded.evaluated_by;

  if normalized_rating = 'good' then
    insert into public.conversation_question_completions (
      question_id,
      student_id,
      completed_at,
      marked_by
    )
    values (
      target_question_id,
      resolved.student_id,
      now(),
      auth.uid()
    )
    on conflict (question_id, student_id) do update
    set
      completed_at = excluded.completed_at,
      marked_by = excluded.marked_by;
  else
    delete from public.conversation_question_completions completion
    where completion.question_id = target_question_id
      and completion.student_id = resolved.student_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'rating', normalized_rating,
    'attendance_sequence', occurrence.attendance_sequence,
    'due_attendance_sequence', due_sequence
  );
end;
$function$
;