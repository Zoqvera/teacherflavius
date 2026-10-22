-- Step 5 compatibility patch: additive migration only.
-- The v2 SQL write contracts share a transaction lock with the finalization
-- worker, and reject new pedagogical records after the 90-minute window.
-- No v2 release or automation gates are enabled in this migration.

create or replace function private.assert_teacher_v2_session_open(
  target_lesson_kind text, target_entry_id uuid, target_date date
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  lesson record;
begin
  if auth.uid() is null or not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso administrativo do professor obrigatório.' using errcode = '42501';
  end if;

  if target_lesson_kind not in ('regular','makeup')
     or target_entry_id is null or target_date is null then
    raise exception 'Aula inválida.' using errcode = '22023';
  end if;

  -- The worker uses pg_try_advisory_xact_lock(20261022, 4).  A writer
  -- acquiring this lock first causes that minute's worker pass to skip;
  -- the next pass observes the committed attendance.
  perform pg_catalog.pg_advisory_xact_lock(20261022, 4);

  select * into lesson from private.resolve_academic_lesson(
    target_lesson_kind, target_entry_id, target_date
  );
  if lesson.student_id is null then
    raise exception 'Aula não encontrada ou cancelada.' using errcode = 'P0002';
  end if;

  if now() < lesson.starts_at - interval '30 minutes'
     or now() >= lesson.starts_at + interval '90 minutes' then
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

revoke all on function private.assert_teacher_v2_session_open(text,uuid,date)
  from public, anon, authenticated;
grant execute on function private.assert_teacher_v2_session_open(text,uuid,date)
  to service_role;

-- A nova interface usa esta RPC, sem alterar a função de apresentações
-- utilizada pelo roteiro atual.
create or replace function public.mark_teacher_lesson_presented_v2(
  target_lesson_kind text, target_entry_id uuid,
  target_date date, target_lesson_number integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.assert_teacher_v2_session_open(
    target_lesson_kind, target_entry_id, target_date
  );

  return public.mark_teacher_lesson_presented(
    target_lesson_kind, target_entry_id, target_date, target_lesson_number
  );
end;
$function$;

revoke all on function public.mark_teacher_lesson_presented_v2(text,uuid,date,integer)
  from public, anon;
grant execute on function public.mark_teacher_lesson_presented_v2(text,uuid,date,integer)
  to authenticated, service_role;

-- Preserve the existing 5/3/1 review algorithm while serializing it with
-- the server closure. The old RPC remains unchanged.
create or replace function public.rate_teacher_conversation_question_v2(
  target_lesson_kind text,
  target_entry_id uuid,
  target_date date,
  target_question_id uuid,
  target_rating text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  resolved record;
  saved_occurrence_id uuid;
  previous_rating text;
  rating_result jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso administrativo do professor obrigatório.' using errcode = '42501';
  end if;

  if target_date is null or target_entry_id is null or target_question_id is null
     or target_lesson_kind not in ('regular', 'makeup')
     or lower(btrim(coalesce(target_rating, ''))) not in ('good', 'medium', 'improve') then
    raise exception 'Parâmetros de avaliação inválidos.' using errcode = '22023';
  end if;

  -- Shared lock with the automatic finalizer prevents late-write/absence races.
  perform private.assert_teacher_v2_session_open(
    target_lesson_kind, target_entry_id, target_date
  );

  select * into resolved
  from private.resolve_academic_lesson(target_lesson_kind, target_entry_id, target_date);

  if resolved.student_id is null then
    raise exception 'Aula não encontrada ou cancelada.' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from private.academic_class_session_finalizations session
    where session.class_number = resolved.class_number
      and session.starts_at = resolved.starts_at
  ) then
    raise exception 'Aula já finalizada. Utilize a correção administrativa.';
  end if;

  if exists (
    select 1
    from private.academic_lesson_occurrences occurrence
    where occurrence.occurrence_key = resolved.occurrence_key
      and occurrence.attendance_status = 'absent'
  ) then
    raise exception 'Aula registrada como ausência. Utilize a correção administrativa.';
  end if;

  -- Serializa múltiplos cliques/abas para a mesma pergunta da ocorrência.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(resolved.occurrence_key || ':' || target_question_id::text, 0)
  );

  -- A presença é confirmada antes da avaliação na mesma transação.
  -- Se a avaliação falhar, o Postgres também reverte a presença.
  saved_occurrence_id := private.sync_academic_attendance(
    target_lesson_kind, target_entry_id, target_date, 'present'
  );

  select practice.rating into previous_rating
  from private.conversation_question_practice_log practice
  where practice.occurrence_id = saved_occurrence_id
    and practice.question_id = target_question_id;

  if found then
    return jsonb_build_object(
      'ok', true,
      'already_rated', true,
      'rating', previous_rating,
      'occurrence_id', saved_occurrence_id,
      'attendance_status', 'present'
    );
  end if;

  -- Reutiliza a validação de elegibilidade e os intervalos 5/3/1 existentes.
  rating_result := public.rate_teacher_conversation_question(
    target_lesson_kind, target_entry_id, target_date, target_question_id, target_rating
  );

  return rating_result || jsonb_build_object(
    'already_rated', false,
    'occurrence_id', saved_occurrence_id,
    'attendance_status', 'present'
  );
end;
$function$;


notify pgrst, 'reload schema';
