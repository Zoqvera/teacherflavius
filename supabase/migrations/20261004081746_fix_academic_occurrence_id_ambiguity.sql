create or replace function private.sync_academic_attendance(
  target_lesson_kind text,
  target_entry_id uuid,
  target_date date,
  target_status text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  resolved record;
  saved_occurrence_id uuid;
  current_occurrence private.academic_lesson_occurrences%rowtype;
  frequency_id uuid;
  sequence_number integer;
  normalized_status text := lower(btrim(coalesce(target_status, '')));
begin
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

revoke execute on function private.sync_academic_attendance(text, uuid, date, text)
  from public, anon, authenticated;
grant execute on function private.sync_academic_attendance(text, uuid, date, text)
  to service_role;
