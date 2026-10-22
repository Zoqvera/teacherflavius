-- Acompanhamento pedagogico: one private-to-service outbox per regular class session.
-- Only active students with a recorded prior session are eligible.
create table if not exists public.pedagogical_preparation_alerts (
  id uuid primary key default gen_random_uuid(),
  class_number integer not null,
  starts_at timestamptz not null,
  students jsonb not null check (jsonb_typeof(students) = 'array'),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'failed', 'sent', 'skipped')),
  attempts smallint not null default 0 check (attempts >= 0),
  created_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  last_error text,
  constraint pedagogical_preparation_alerts_unique_session
    unique (class_number, starts_at)
);

create index if not exists pedagogical_preparation_alerts_queue_idx
  on public.pedagogical_preparation_alerts (status, starts_at, created_at)
  where status in ('pending', 'processing', 'failed');

alter table public.pedagogical_preparation_alerts enable row level security;
revoke all on table public.pedagogical_preparation_alerts from public, anon, authenticated;
grant select, update on table public.pedagogical_preparation_alerts to service_role;

comment on table public.pedagogical_preparation_alerts is
  'Service-only pedagogical alert outbox. No lesson texts, question content, or student contact details are stored.';

create or replace function private.enqueue_pedagogical_preparation_alerts()
returns integer
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  inserted_rows integer := 0;
begin
  with upcoming as (
    select
      membership.user_id as student_id,
      classes.class_number,
      classes.class_name,
      (
        (day_to_check.lesson_date + classes.class_start_time)
        at time zone 'America/Sao_Paulo'
      ) as starts_at
    from public.class_students membership
    join public.profiles student on student.id = membership.user_id
    join public.teacher_classes classes
      on classes.class_number = membership.class_number
    cross join generate_series(0, 2) as offset_day(day_number)
    cross join lateral (
      select ((now() at time zone 'America/Sao_Paulo')::date
        + offset_day.day_number) as lesson_date
    ) day_to_check
    where classes.is_active is true
      and classes.class_weekday = extract(isodow from day_to_check.lesson_date)::smallint
      and classes.class_start_time is not null
      and student.enrolled is true
      and student.archived is false
      and membership.user_id is not null
      and (classes.first_lesson_date is null
        or day_to_check.lesson_date >= classes.first_lesson_date)
      and (membership.first_lesson_date is null
        or day_to_check.lesson_date >= membership.first_lesson_date)
      and not exists (
        select 1
        from private.student_regular_lesson_cancellations cancelled
        where cancelled.student_id = membership.user_id
          and cancelled.class_number = classes.class_number
          and cancelled.lesson_date = day_to_check.lesson_date
          and not exists (
            select 1
            from private.student_regular_lesson_restorations restored
            where restored.cancellation_id = cancelled.id
          )
      )
  ), in_window as (
    select *
    from upcoming
    where starts_at >= now() + interval '6 hours'
      and starts_at < now() + interval '6 hours 40 minutes'
  ), measured as (
    select
      session.student_id,
      session.class_number,
      session.starts_at,
      previous_lesson.starts_at as previous_lesson_at,
      private.academic_next_lesson_number(session.student_id) as lesson_number,
      not exists (
        select 1
        from private.student_question_studies studied
        where studied.student_id = session.student_id
          and studied.studied_at > previous_lesson.starts_at
          and studied.studied_at <= now()
      ) as no_questions_studied
    from in_window session
    cross join lateral (
      select max(lesson.starts_at) as starts_at
      from private.academic_lesson_occurrences lesson
      where lesson.student_id = session.student_id
        and lesson.starts_at < session.starts_at
        and lesson.attendance_status in ('present', 'absent')
    ) previous_lesson
    where previous_lesson.starts_at is not null
  ), pending as (
    select
      measure.*,
      (
        measure.lesson_number is not null
        and not exists (
          select 1
          from public.lesson_presentations presentation
          where presentation.student_id = measure.student_id
            and presentation.lesson_number = measure.lesson_number
            and nullif(btrim(presentation.body), '') is not null
        )
      ) as lesson_without_text
    from measured measure
  ), grouped as (
    select
      candidate.class_number,
      candidate.starts_at,
      jsonb_agg(
        jsonb_build_object(
          'student_id', candidate.student_id,
          'lesson_number', candidate.lesson_number,
          'previous_lesson_at', candidate.previous_lesson_at,
          'lesson_without_text', candidate.lesson_without_text,
          'no_questions_studied', candidate.no_questions_studied
        )
        order by candidate.student_id
      ) as students
    from pending candidate
    where candidate.lesson_without_text or candidate.no_questions_studied
    group by candidate.class_number, candidate.starts_at
  ), inserted as (
    insert into public.pedagogical_preparation_alerts (
      class_number, starts_at, students
    )
    select class_number, starts_at, students
    from grouped
    on conflict (class_number, starts_at) do nothing
    returning id
  )
  select count(*) into inserted_rows from inserted;

  return inserted_rows;
end;
$function$;

revoke all on function private.enqueue_pedagogical_preparation_alerts() from public, anon, authenticated;
grant execute on function private.enqueue_pedagogical_preparation_alerts() to service_role;

create or replace function private.dispatch_pedagogical_preparation_alerts()
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  shared_secret text;
begin
  perform private.enqueue_pedagogical_preparation_alerts();

  -- A stale worker is retried with the same Resend idempotency key.
  update public.pedagogical_preparation_alerts alert
  set status = 'failed', last_error = 'worker_timeout'
  where alert.status = 'processing'
    and alert.last_attempt_at < now() - interval '5 minutes'
    and alert.starts_at >= now() + interval '6 hours';

  if not exists (
    select 1
    from public.pedagogical_preparation_alerts alert
    where alert.status in ('pending', 'failed')
      and alert.attempts < 5
      and alert.starts_at >= now() + interval '6 hours'
  ) then
    return;
  end if;

  select secret.decrypted_secret into shared_secret
  from vault.decrypted_secrets secret
  where secret.name = 'teacherflavius_notification_webhook_secret'
  limit 1;

  if nullif(shared_secret, '') is null then
    raise warning 'Pedagogical alert webhook secret is unavailable';
    return;
  end if;

  perform net.http_post(
    url := 'https://wnigzpvgsbpjdxvjzugt.supabase.co/functions/v1/notify-pedagogical-preparation',
    body := '{"source":"pg_cron"}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', shared_secret
    ),
    timeout_milliseconds := 10000
  );
end;
$function$;

revoke all on function private.dispatch_pedagogical_preparation_alerts() from public, anon, authenticated;
grant execute on function private.dispatch_pedagogical_preparation_alerts() to service_role;

do $schedule$
begin
  if not exists (
    select 1 from cron.job
    where jobname = 'pedagogical-preparation-alerts'
  ) then
    perform cron.schedule(
      'pedagogical-preparation-alerts',
      '*/5 * * * *',
      'select private.dispatch_pedagogical_preparation_alerts();'
    );
  end if;
end;
$schedule$;

notify pgrst, 'reload schema';
