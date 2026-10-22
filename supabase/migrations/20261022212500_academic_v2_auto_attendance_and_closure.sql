-- Roteiro da Aula v2 — etapa 4 (preparacao sem ativacao).
-- Este worker nao toca a pagina legada e NAO executa fechamento enquanto enabled=false.
-- Ativacao explicitamente separada na etapa 5.

create table if not exists private.academic_v2_automation_control (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  enabled_from timestamptz,
  updated_at timestamptz not null default now(),
  constraint academic_v2_enabled_requires_start check (not enabled or enabled_from is not null)
);

insert into private.academic_v2_automation_control (singleton, enabled)
values (true, false)
on conflict (singleton) do nothing;

create table if not exists private.academic_v2_closed_session_snapshots (
  class_number integer not null,
  starts_at timestamptz not null,
  class_date date not null,
  class_name text not null,
  students jsonb not null check (jsonb_typeof(students) = 'array'),
  finalized_at timestamptz not null default now(),
  primary key (class_number, starts_at)
);

create index if not exists academic_v2_closed_sessions_date_idx
  on private.academic_v2_closed_session_snapshots (class_date, starts_at);

create table if not exists private.academic_v2_attendance_audit (
  id uuid primary key default gen_random_uuid(),
  lesson_kind text not null check (lesson_kind in ('regular', 'makeup')),
  entry_id uuid not null,
  student_id uuid not null,
  class_number integer not null,
  starts_at timestamptz not null,
  previous_status text,
  new_status text not null check (new_status in ('present', 'absent')),
  change_reason text not null,
  action text not null check (
    action in ('automatic_absence', 'manual_participation', 'admin_correction')
  ),
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);

create index if not exists academic_v2_attendance_audit_student_idx
  on private.academic_v2_attendance_audit (student_id, starts_at desc);

revoke all on table private.academic_v2_automation_control,
  private.academic_v2_closed_session_snapshots,
  private.academic_v2_attendance_audit from public, anon, authenticated;
grant select on table private.academic_v2_automation_control,
  private.academic_v2_closed_session_snapshots,
  private.academic_v2_attendance_audit to service_role;

-- Opcional: registra participacao mesmo quando nenhuma apresentacao/pergunta foi avaliada.
create or replace function public.mark_teacher_v2_participation(
  target_lesson_kind text, target_entry_id uuid, target_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  resolved record;
  previous_status text;
  saved_occurrence_id uuid;
begin
  if auth.uid() is null or not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso administrativo do professor obrigatório.' using errcode = '42501';
  end if;

  select * into resolved
  from private.resolve_academic_lesson(target_lesson_kind, target_entry_id, target_date);
  if resolved.student_id is null then
    raise exception 'Aula não encontrada ou cancelada.' using errcode = 'P0002';
  end if;
  if now() < resolved.starts_at - interval '30 minutes' then
    raise exception 'A aula ainda não começou.';
  end if;
  if exists (
    select 1 from private.academic_class_session_finalizations closed
    where closed.class_number = resolved.class_number
      and closed.starts_at = resolved.starts_at
  ) then
    raise exception 'Aula encerrada. Utilize a correção administrativa.';
  end if;

  select attendance_status into previous_status
  from private.academic_lesson_occurrences occurrence
  where occurrence.occurrence_key = resolved.occurrence_key;

  if previous_status = 'absent' then
    raise exception 'Ausência registrada. Utilize a correção administrativa.';
  end if;

  saved_occurrence_id := private.sync_academic_attendance(
    target_lesson_kind, target_entry_id, target_date, 'present'
  );

  if previous_status is distinct from 'present' then
    insert into private.academic_v2_attendance_audit (
      lesson_kind, entry_id, student_id, class_number, starts_at,
      previous_status, new_status, change_reason, action, changed_by
    ) values (
      target_lesson_kind, target_entry_id, resolved.student_id,
      resolved.class_number, resolved.starts_at,
      previous_status, 'present', 'Participação excepcional registrada pelo professor.',
      'manual_participation', auth.uid()
    );
  end if;

  return jsonb_build_object(
    'ok', true, 'occurrence_id', saved_occurrence_id,
    'attendance_status', 'present'
  );
end;
$function$;

revoke all on function public.mark_teacher_v2_participation(text, uuid, date)
  from public, anon;
grant execute on function public.mark_teacher_v2_participation(text, uuid, date)
  to authenticated, service_role;

-- Correção posterior exige justificativa auditável e respeita o bloqueio
-- existente contra marcar ausência quando houver apresentação/pergunta registrada.
create or replace function public.correct_teacher_v2_attendance(
  target_lesson_kind text, target_entry_id uuid, target_date date,
  target_status text, target_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  resolved record;
  previous_status text;
  saved_occurrence_id uuid;
  normalized_reason text := btrim(coalesce(target_reason, ''));
begin
  if auth.uid() is null or not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso administrativo do professor obrigatório.' using errcode = '42501';
  end if;
  if target_status not in ('present', 'absent') or
     char_length(normalized_reason) < 8 or char_length(normalized_reason) > 500 then
    raise exception 'Situação inválida ou justificativa com menos de 8 ou mais de 500 caracteres.'
      using errcode = '22023';
  end if;

  select * into resolved
  from private.resolve_academic_lesson(target_lesson_kind, target_entry_id, target_date);
  if resolved.student_id is null then
    raise exception 'Aula não encontrada ou cancelada.' using errcode = 'P0002';
  end if;
  if resolved.starts_at > now() then
    raise exception 'A aula ainda não ocorreu.';
  end if;

  select attendance_status into previous_status
  from private.academic_lesson_occurrences occurrence
  where occurrence.occurrence_key = resolved.occurrence_key;

  if previous_status is not distinct from target_status then
    return jsonb_build_object(
      'ok', true, 'unchanged', true, 'attendance_status', target_status
    );
  end if;

  saved_occurrence_id := private.sync_academic_attendance(
    target_lesson_kind, target_entry_id, target_date, target_status
  );

  insert into private.academic_v2_attendance_audit (
    lesson_kind, entry_id, student_id, class_number, starts_at,
    previous_status, new_status, change_reason, action, changed_by
  ) values (
    target_lesson_kind, target_entry_id, resolved.student_id,
    resolved.class_number, resolved.starts_at,
    previous_status, target_status, normalized_reason, 'admin_correction', auth.uid()
  );

  return jsonb_build_object(
    'ok', true, 'unchanged', false,
    'occurrence_id', saved_occurrence_id, 'attendance_status', target_status
  );
end;
$function$;

revoke all on function public.correct_teacher_v2_attendance(text, uuid, date, text, text)
  from public, anon;
grant execute on function public.correct_teacher_v2_attendance(text, uuid, date, text, text)
  to authenticated, service_role;

-- Histórico próprio da interface v2; nao altera get_teacher_lesson_plan,
-- que continua ocultando turmas encerradas na interface antiga.
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
          end
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
        'lesson_number', occurrence.presented_lesson_number
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

revoke all on function public.get_teacher_v2_closed_sessions(date)
  from public, anon;
grant execute on function public.get_teacher_v2_closed_sessions(date)
  to authenticated, service_role;

-- Worker cron e somente servidor: nao requer token de usuario e nao oferece
-- nenhuma RPC publica. O switch false protege todo o ambiente legado.
create or replace function private.run_teacher_v2_auto_finalizations()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  control record;
  lesson_date date;
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

  for lesson_date in
    select ((now() at time zone 'America/Sao_Paulo')::date - days.number)::date
    from generate_series(0, 2) as days(number)
  loop
    for due_class in
      with candidates as (
        select
          class.class_number,
          class.class_name::text as class_name,
          ((lesson_date + class.class_start_time) at time zone 'America/Sao_Paulo') as starts_at
        from public.teacher_classes class
        where class.is_active is true
          and class.class_start_time is not null
          and class.class_weekday = extract(isodow from lesson_date)::smallint
          and (class.first_lesson_date is null or lesson_date >= class.first_lesson_date)
          and exists (
            select 1
            from public.class_students membership
            join public.profiles profile on profile.id = membership.user_id
            where membership.class_number = class.class_number
              and profile.enrolled is true and profile.archived is false
              and (membership.first_lesson_date is null
                or lesson_date >= membership.first_lesson_date)
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
          and (slot.starts_at at time zone 'America/Sao_Paulo')::date = lesson_date
      )
      select distinct candidate.class_number, candidate.class_name, candidate.starts_at
      from candidates candidate
      where candidate.starts_at >= control.enabled_from
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
                and cancellation.lesson_date = lesson_date
            ) as is_cancelled
          from public.class_students membership
          join public.teacher_classes class
            on class.class_number = membership.class_number
          join public.profiles profile on profile.id = membership.user_id
          where class.class_number = due_class.class_number
            and ((lesson_date + class.class_start_time)
              at time zone 'America/Sao_Paulo') = due_class.starts_at
            and profile.enrolled is true and profile.archived is false
            and (class.first_lesson_date is null
              or lesson_date >= class.first_lesson_date)
            and (membership.first_lesson_date is null
              or lesson_date >= membership.first_lesson_date)

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
            student.lesson_kind, student.entry_id, lesson_date
          );

          if old_status = 'present' then
            new_status := 'present';
          elsif exists (
            select 1 from private.academic_lesson_occurrences occurrence
            where occurrence.occurrence_key = private.academic_occurrence_key(
              student.lesson_kind, student.entry_id, lesson_date
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
              student.lesson_kind, student.entry_id, lesson_date, new_status
            );
          else
            new_status := 'absent';
            if old_status is distinct from 'absent' then
              perform private.sync_academic_attendance(
                student.lesson_kind, student.entry_id, lesson_date, new_status
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
          due_class.starts_at, lesson_date, null
        ) on conflict (class_number, starts_at) do nothing;

        insert into private.academic_v2_closed_session_snapshots (
          class_number, class_name, starts_at, class_date, students
        ) values (
          due_class.class_number, due_class.class_name,
          due_class.starts_at, lesson_date, snapshot_students
        ) on conflict (class_number, starts_at) do nothing;

        processed := processed + 1;
      end if;
    end loop;
  end loop;
  return processed;
end;
$function$;

revoke all on function private.run_teacher_v2_auto_finalizations()
  from public, anon, authenticated;
grant execute on function private.run_teacher_v2_auto_finalizations()
  to service_role;

-- O agendamento roda a cada minuto, mas retorna 0 sem alterar dados
-- ate a liberacao expressa da v2. Nao modifica o job antigo.
do $schedule$
begin
  if not exists (
    select 1 from cron.job where jobname = 'teacher-v2-auto-finalize'
  ) then
    perform cron.schedule(
      'teacher-v2-auto-finalize',
      '* * * * *',
      'select private.run_teacher_v2_auto_finalizations();'
    );
  end if;
end;
$schedule$;

notify pgrst, 'reload schema';
