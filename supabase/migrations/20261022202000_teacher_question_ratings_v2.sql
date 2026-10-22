-- Roteiro da Aula v2, etapa 3.
-- Novas RPCs isoladas: nenhuma função existente é substituída.
-- Os controles da interface v2 permanecem bloqueados até a homologação.

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

revoke all on function public.rate_teacher_conversation_question_v2(
  text, uuid, date, uuid, text
) from public, anon;
grant execute on function public.rate_teacher_conversation_question_v2(
  text, uuid, date, uuid, text
) to authenticated, service_role;

-- Histórico por ocorrência: as avaliações antigas permanecem no log original
-- e não são sobrescritas por novas aulas nem expostas diretamente pela Data API.
create or replace function public.get_teacher_question_rating_history_v2(
  target_date date default null
)
returns table (
  student_id uuid,
  starts_at timestamptz,
  evaluations jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  effective_date date := coalesce(target_date, (now() at time zone 'America/Sao_Paulo')::date);
begin
  if auth.uid() is null or not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso administrativo do professor obrigatório.' using errcode = '42501';
  end if;

  return query
  with roster as (
    select distinct plan.student_id, plan.starts_at
    from public.get_teacher_lesson_plan(effective_date) plan
  )
  select
    roster.student_id,
    roster.starts_at,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'question_id', practice.question_id,
          'rating', practice.rating,
          'practiced_at', practice.practiced_at,
          'lesson_starts_at', occurrence.starts_at,
          'is_current', occurrence.starts_at = roster.starts_at
        )
        order by occurrence.starts_at desc, practice.practiced_at desc, practice.id
      )
      from private.conversation_question_practice_log practice
      join private.academic_lesson_occurrences occurrence
        on occurrence.id = practice.occurrence_id
      where practice.student_id = roster.student_id
        and occurrence.starts_at <= roster.starts_at
    ), '[]'::jsonb)
  from roster
  order by roster.starts_at, roster.student_id;
end;
$function$;

revoke all on function public.get_teacher_question_rating_history_v2(date)
  from public, anon;
grant execute on function public.get_teacher_question_rating_history_v2(date)
  to authenticated, service_role;

comment on function public.get_teacher_question_rating_history_v2(date) is
  'Somente professor: avaliações de perguntas por ocorrência para alunos no roteiro da data.';
notify pgrst, 'reload schema';
