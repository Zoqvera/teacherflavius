
-- Academic preparation, lesson execution, and spaced conversation review workflow.
-- Browser clients only use the public RPC surface below. Operational tables stay private.

create table if not exists private.academic_lesson_occurrences (
  id uuid primary key default gen_random_uuid(),
  occurrence_key text not null unique,
  student_id uuid not null references auth.users(id) on delete cascade,
  lesson_kind text not null check (lesson_kind in ('regular', 'makeup')),
  source_entry_id uuid not null,
  class_number integer not null,
  class_name text not null,
  starts_at timestamptz not null,
  attendance_status text not null default 'scheduled'
    check (attendance_status in ('scheduled', 'present', 'absent')),
  attendance_sequence integer check (attendance_sequence is null or attendance_sequence > 0),
  attendance_record_id uuid references public.student_frequency(id) on delete set null,
  presented_lesson_number integer check (
    presented_lesson_number is null or presented_lesson_number between 1 and 74
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists academic_lesson_occurrences_student_starts_idx
  on private.academic_lesson_occurrences (student_id, starts_at desc);

create index if not exists academic_lesson_occurrences_student_sequence_idx
  on private.academic_lesson_occurrences (student_id, attendance_sequence)
  where attendance_status = 'present' and attendance_sequence is not null;

create table if not exists private.student_lesson_preparations (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users(id) on delete cascade,
  lesson_number integer not null check (lesson_number between 1 and 74),
  prepared_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (student_id, lesson_number)
);

create index if not exists student_lesson_preparations_student_idx
  on private.student_lesson_preparations (student_id, lesson_number);

create table if not exists private.student_question_studies (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users(id) on delete cascade,
  question_id uuid not null references public.conversation_questions(id) on delete cascade,
  studied_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (student_id, question_id)
);

create index if not exists student_question_studies_student_idx
  on private.student_question_studies (student_id, studied_at, question_id);

create table if not exists private.conversation_question_practice_log (
  id uuid primary key default gen_random_uuid(),
  occurrence_id uuid not null references private.academic_lesson_occurrences(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  question_id uuid not null references public.conversation_questions(id) on delete cascade,
  rating text not null check (rating in ('good', 'medium', 'improve')),
  attendance_sequence integer not null check (attendance_sequence > 0),
  due_attendance_sequence integer not null check (due_attendance_sequence > attendance_sequence),
  practiced_at timestamptz not null default now(),
  evaluated_by uuid references auth.users(id) on delete set null,
  unique (occurrence_id, question_id)
);

create index if not exists conversation_question_practice_student_question_idx
  on private.conversation_question_practice_log
  (student_id, question_id, attendance_sequence desc, practiced_at desc);

create index if not exists conversation_question_practice_due_idx
  on private.conversation_question_practice_log
  (student_id, due_attendance_sequence);

revoke all on table
  private.academic_lesson_occurrences,
  private.student_lesson_preparations,
  private.student_question_studies,
  private.conversation_question_practice_log
from public, anon, authenticated;

grant select, insert, update, delete on table
  private.academic_lesson_occurrences,
  private.student_lesson_preparations,
  private.student_question_studies,
  private.conversation_question_practice_log
to service_role;

create or replace function private.academic_occurrence_key(
  target_lesson_kind text,
  target_entry_id uuid,
  target_date date
)
returns text
language sql
immutable
set search_path = ''
as $function$
  select lower(btrim(target_lesson_kind)) || ':' || target_entry_id::text || ':' || target_date::text;
$function$;

revoke execute on function private.academic_occurrence_key(text, uuid, date)
  from public, anon, authenticated;
grant execute on function private.academic_occurrence_key(text, uuid, date)
  to service_role;

create or replace function private.academic_next_lesson_number(target_student_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $function$
  with progress as (
    select max(substring(record.lesson_code from 2)::integer) as max_lesson
    from public.class_lesson_records record
    where record.user_id = target_student_id
      and record.lesson_code ~ '^L[0-9]+$'
  )
  select case
    when progress.max_lesson is null then 1
    when progress.max_lesson >= 74 then null
    else progress.max_lesson + 1
  end
  from progress;
$function$;

revoke execute on function private.academic_next_lesson_number(uuid)
  from public, anon, authenticated;
grant execute on function private.academic_next_lesson_number(uuid)
  to service_role;

create or replace function private.resolve_academic_lesson(
  target_lesson_kind text,
  target_entry_id uuid,
  target_date date
)
returns table (
  student_id uuid,
  class_number integer,
  class_name text,
  starts_at timestamptz,
  occurrence_key text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  normalized_kind text := lower(btrim(coalesce(target_lesson_kind, '')));
begin
  if target_date is null then
    raise exception 'Informe a data da aula.' using errcode = '22023';
  end if;

  if normalized_kind = 'regular' then
    return query
    select
      membership.user_id,
      class.class_number,
      class.class_name::text,
      ((target_date + class.class_start_time) at time zone 'America/Sao_Paulo'),
      private.academic_occurrence_key(normalized_kind, target_entry_id, target_date)
    from public.class_students membership
    join public.teacher_classes class
      on class.class_number = membership.class_number
     and class.is_active = true
    join public.profiles profile
      on profile.id = membership.user_id
    where membership.id = target_entry_id
      and membership.user_id is not null
      and class.class_weekday = extract(isodow from target_date)::smallint
      and class.class_start_time is not null
      and coalesce(profile.enrolled, false) = true
      and coalesce(profile.archived, false) = false
      and not exists (
        select 1
        from private.student_regular_lesson_cancellations cancellation
        where cancellation.student_id = membership.user_id
          and cancellation.class_number = class.class_number
          and cancellation.lesson_date = target_date
      );
    return;
  end if;

  if normalized_kind = 'makeup' then
    return query
    select
      booking.student_id,
      booking.class_number,
      booking.class_name::text,
      slot.starts_at,
      private.academic_occurrence_key(normalized_kind, target_entry_id, target_date)
    from public.makeup_class_bookings booking
    join public.makeup_class_slots slot
      on slot.id = booking.slot_id
    join public.profiles profile
      on profile.id = booking.student_id
    where booking.id = target_entry_id
      and booking.status = 'confirmed'
      and slot.is_active = true
      and coalesce(profile.enrolled, false) = true
      and coalesce(profile.archived, false) = false
      and (slot.starts_at at time zone 'America/Sao_Paulo')::date = target_date;
    return;
  end if;

  raise exception 'Tipo de aula inválido.' using errcode = '22023';
end;
$function$;

revoke execute on function private.resolve_academic_lesson(text, uuid, date)
  from public, anon, authenticated;
grant execute on function private.resolve_academic_lesson(text, uuid, date)
  to service_role;

create or replace function private.academic_planned_attendance_sequence(
  target_student_id uuid,
  target_date date
)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  tracked_max integer := 0;
  legacy_count integer := 0;
begin
  select coalesce(max(occurrence.attendance_sequence), 0)
  into tracked_max
  from private.academic_lesson_occurrences occurrence
  where occurrence.student_id = target_student_id
    and occurrence.attendance_status = 'present'
    and occurrence.attendance_sequence is not null;

  select count(distinct frequency.class_date)::integer
  into legacy_count
  from public.student_frequency frequency
  where frequency.user_id = target_student_id
    and frequency.attendance_status = 'Compareceu'
    and frequency.class_date < target_date;

  return greatest(tracked_max, legacy_count) + 1;
end;
$function$;

revoke execute on function private.academic_planned_attendance_sequence(uuid, date)
  from public, anon, authenticated;
grant execute on function private.academic_planned_attendance_sequence(uuid, date)
  to service_role;

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
  occurrence_id uuid;
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
  returning id into occurrence_id;

  select *
  into current_occurrence
  from private.academic_lesson_occurrences occurrence
  where occurrence.id = occurrence_id
  for update;

  if normalized_status = 'absent'
     and (
       current_occurrence.presented_lesson_number is not null
       or exists (
         select 1
         from private.conversation_question_practice_log practice
         where practice.occurrence_id = occurrence_id
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
    where occurrence.id = occurrence_id;

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
    where occurrence.id = occurrence_id;

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

  return occurrence_id;
end;
$function$;

revoke execute on function private.sync_academic_attendance(text, uuid, date, text)
  from public, anon, authenticated;
grant execute on function private.sync_academic_attendance(text, uuid, date, text)
  to service_role;

create or replace function public.get_my_action_plan()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  next_lesson integer;
  lesson_page_id uuid;
  prepared_at timestamptz;
  pending_questions jsonb := '[]'::jsonb;
  assigned_questions jsonb := '[]'::jsonb;
  pending_count integer := 0;
begin
  if caller_id is null then
    raise exception 'Faça login para visualizar o que fazer.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = caller_id
      and coalesce(profile.enrolled, false) = true
      and coalesce(profile.archived, false) = false
  ) then
    raise exception 'Esta página está disponível apenas para alunos ativos.' using errcode = '42501';
  end if;

  next_lesson := private.academic_next_lesson_number(caller_id);

  if next_lesson is not null then
    select page.id
    into lesson_page_id
    from public.study_lesson_pages page
    where page.roadmap_lesson_number = next_lesson
    limit 1;

    select preparation.prepared_at
    into prepared_at
    from private.student_lesson_preparations preparation
    where preparation.student_id = caller_id
      and preparation.lesson_number = next_lesson;
  end if;

  select count(*)::integer
  into pending_count
  from private.student_question_studies study
  where study.student_id = caller_id
    and not exists (
      select 1
      from private.conversation_question_practice_log practice
      where practice.student_id = caller_id
        and practice.question_id = study.question_id
    );

  if pending_count > 0 then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', question.id,
          'text', question.question_text,
          'display_order', question.display_order,
          'studied', true
        )
        order by question.display_order, question.id
      ),
      '[]'::jsonb
    )
    into pending_questions
    from private.student_question_studies study
    join public.conversation_questions question
      on question.id = study.question_id
    where study.student_id = caller_id
      and not exists (
        select 1
        from private.conversation_question_practice_log practice
        where practice.student_id = caller_id
          and practice.question_id = study.question_id
      );
  else
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', source.id,
          'text', source.question_text,
          'display_order', source.display_order,
          'studied', false
        )
        order by source.display_order, source.id
      ),
      '[]'::jsonb
    )
    into assigned_questions
    from (
      select question.id, question.question_text, question.display_order
      from public.conversation_questions question
      where not exists (
        select 1
        from private.student_question_studies study
        where study.student_id = caller_id
          and study.question_id = question.id
      )
        and not exists (
          select 1
          from public.conversation_question_completions completion
          where completion.student_id = caller_id
            and completion.question_id = question.id
        )
      order by question.display_order, question.id
      limit 10
    ) source;
  end if;

  return jsonb_build_object(
    'lesson',
    case
      when next_lesson is null then null
      else jsonb_build_object(
        'number', next_lesson,
        'page_id', lesson_page_id,
        'prepared', prepared_at is not null,
        'prepared_at', prepared_at,
        'has_material', lesson_page_id is not null or next_lesson between 1 and 20
      )
    end,
    'questions', case when pending_count > 0 then pending_questions else assigned_questions end,
    'questions_studied', pending_count > 0,
    'questions_complete',
      pending_count = 0
      and jsonb_array_length(assigned_questions) = 0
  );
end;
$function$;

revoke execute on function public.get_my_action_plan() from public, anon;
grant execute on function public.get_my_action_plan() to authenticated, service_role;

create or replace function public.mark_my_lesson_prepared(target_lesson_number integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  expected_lesson integer;
  saved_at timestamptz;
begin
  if caller_id is null then
    raise exception 'Faça login para registrar sua preparação.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = caller_id
      and coalesce(profile.enrolled, false) = true
      and coalesce(profile.archived, false) = false
  ) then
    raise exception 'Apenas alunos ativos podem registrar preparação.' using errcode = '42501';
  end if;

  expected_lesson := private.academic_next_lesson_number(caller_id);
  if expected_lesson is null then
    raise exception 'Todas as lições disponíveis já foram concluídas.';
  end if;

  if target_lesson_number is distinct from expected_lesson then
    raise exception 'Registre a preparação somente da sua próxima lição.';
  end if;

  insert into private.student_lesson_preparations (
    student_id,
    lesson_number
  )
  values (
    caller_id,
    target_lesson_number
  )
  on conflict (student_id, lesson_number) do update
  set prepared_at = private.student_lesson_preparations.prepared_at
  returning prepared_at into saved_at;

  return jsonb_build_object(
    'ok', true,
    'lesson_number', target_lesson_number,
    'prepared_at', saved_at
  );
end;
$function$;

revoke execute on function public.mark_my_lesson_prepared(integer) from public, anon;
grant execute on function public.mark_my_lesson_prepared(integer) to authenticated, service_role;

create or replace function public.mark_my_questions_studied(target_question_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  expected_ids uuid[];
  pending_count integer := 0;
  saved_count integer := 0;
begin
  if caller_id is null then
    raise exception 'Faça login para registrar as perguntas estudadas.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = caller_id
      and coalesce(profile.enrolled, false) = true
      and coalesce(profile.archived, false) = false
  ) then
    raise exception 'Apenas alunos ativos podem registrar estudo.' using errcode = '42501';
  end if;

  select count(*)::integer
  into pending_count
  from private.student_question_studies study
  where study.student_id = caller_id
    and not exists (
      select 1
      from private.conversation_question_practice_log practice
      where practice.student_id = caller_id
        and practice.question_id = study.question_id
    );

  if pending_count > 0 then
    raise exception 'Suas perguntas já foram registradas e aguardam prática com o professor.';
  end if;

  select coalesce(array_agg(source.id order by source.display_order, source.id), '{}'::uuid[])
  into expected_ids
  from (
    select question.id, question.display_order
    from public.conversation_questions question
    where not exists (
      select 1
      from private.student_question_studies study
      where study.student_id = caller_id
        and study.question_id = question.id
    )
      and not exists (
        select 1
        from public.conversation_question_completions completion
        where completion.student_id = caller_id
          and completion.question_id = question.id
      )
    order by question.display_order, question.id
    limit 10
  ) source;

  if cardinality(expected_ids) = 0 then
    return jsonb_build_object('ok', true, 'saved_count', 0, 'complete', true);
  end if;

  if target_question_ids is null
     or cardinality(target_question_ids) <> cardinality(expected_ids)
     or not (
       target_question_ids @> expected_ids
       and expected_ids @> target_question_ids
     ) then
    raise exception 'O conjunto de perguntas mudou. Atualize a página e tente novamente.';
  end if;

  insert into private.student_question_studies (student_id, question_id)
  select caller_id, question_id
  from unnest(expected_ids) as question_id
  on conflict (student_id, question_id) do nothing;

  get diagnostics saved_count = row_count;

  return jsonb_build_object(
    'ok', true,
    'saved_count', saved_count,
    'complete', false
  );
end;
$function$;

revoke execute on function public.mark_my_questions_studied(uuid[]) from public, anon;
grant execute on function public.mark_my_questions_studied(uuid[]) to authenticated, service_role;

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
  order by enriched.starts_at, enriched.student_name, enriched.lesson_kind;
end;
$function$;

revoke execute on function public.get_teacher_lesson_plan(date) from public, anon;
grant execute on function public.get_teacher_lesson_plan(date) to authenticated, service_role;

create or replace function public.set_teacher_lesson_attendance(
  target_lesson_kind text,
  target_entry_id uuid,
  target_date date,
  target_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  occurrence_id uuid;
begin
  if not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso administrativo do professor obrigatório.' using errcode = '42501';
  end if;

  occurrence_id := private.sync_academic_attendance(
    target_lesson_kind,
    target_entry_id,
    target_date,
    target_status
  );

  return jsonb_build_object(
    'ok', true,
    'occurrence_id', occurrence_id,
    'attendance_status', lower(btrim(target_status))
  );
end;
$function$;

revoke execute on function public.set_teacher_lesson_attendance(text, uuid, date, text)
  from public, anon;
grant execute on function public.set_teacher_lesson_attendance(text, uuid, date, text)
  to authenticated, service_role;

create or replace function public.mark_teacher_lesson_presented(
  target_lesson_kind text,
  target_entry_id uuid,
  target_date date,
  target_lesson_number integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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

  expected_lesson := private.academic_next_lesson_number(resolved.student_id);
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
$function$;

revoke execute on function public.mark_teacher_lesson_presented(text, uuid, date, integer)
  from public, anon;
grant execute on function public.mark_teacher_lesson_presented(text, uuid, date, integer)
  to authenticated, service_role;

create or replace function public.rate_teacher_conversation_question(
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
  occurrence private.academic_lesson_occurrences%rowtype;
  normalized_rating text := lower(btrim(coalesce(target_rating, '')));
  review_interval integer;
  is_new_question boolean := false;
  is_due_review boolean := false;
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

  if not is_new_question and not is_due_review then
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
$function$;

revoke execute on function public.rate_teacher_conversation_question(text, uuid, date, uuid, text)
  from public, anon;
grant execute on function public.rate_teacher_conversation_question(text, uuid, date, uuid, text)
  to authenticated, service_role;
