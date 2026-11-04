-- Reminders for students who still need to prepare for the next regular lesson.
-- Read-only access to restoration receipts is needed for sender revalidation.
grant select on private.student_regular_lesson_restorations to service_role;
-- Independent from the existing professor-only pedagogical alerts.
create table if not exists public.student_preparation_email_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.student_preparation_email_settings (id, enabled)
values (true, false) on conflict (id) do nothing;
alter table public.student_preparation_email_settings enable row level security;
revoke all on public.student_preparation_email_settings from public, anon, authenticated;
grant select, update on public.student_preparation_email_settings to service_role;

create table if not exists public.student_preparation_email_reminders (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id),
  class_number integer not null,
  starts_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending','processing','sent','failed','skipped')),
  attempts smallint not null default 0 check (attempts between 0 and 5),
  created_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  last_error text,
  constraint unique_student_preparation_lesson
    unique (student_id, class_number, starts_at)
);
create index if not exists student_preparation_reminders_outbox_idx
  on public.student_preparation_email_reminders(status, starts_at)
  where status in ('pending','processing','failed');
alter table public.student_preparation_email_reminders enable row level security;
revoke all on public.student_preparation_email_reminders from public, anon, authenticated;
grant select, insert, update on public.student_preparation_email_reminders to service_role;
comment on table public.student_preparation_email_reminders is
  'Service-only student reminder outbox; no email address or lesson text stored.';

-- Caller must be service_role. This is also re-evaluated by the sender
-- immediately before calling the email provider, avoiding obsolete reminders.
create or replace function public.student_preparation_email_context_internal(
  target_student_id uuid,
  target_class_number integer,
  target_starts_at timestamptz
)
returns table (
  student_id uuid,
  student_email text,
  student_name text,
  class_name text,
  lesson_number integer,
  studied_questions integer,
  missing_presentation boolean,
  missing_questions boolean
)
language sql stable security invoker
set search_path = ''
as $function$
  with eligible as (
    select
      membership.user_id,
      membership.created_at as joined_at,
      student.email,
      student.name,
      classes.class_name
    from public.class_students membership
    join public.profiles student on student.id = membership.user_id
    join public.teacher_classes classes on classes.class_number = membership.class_number
    where membership.user_id = target_student_id
      and membership.class_number = target_class_number
      and classes.is_active is true
      and classes.class_start_time is not null
      and classes.class_weekday = extract(
        isodow from (target_starts_at at time zone 'America/Sao_Paulo')::date
      )::smallint
      and (
        (
          (target_starts_at at time zone 'America/Sao_Paulo')::date
          + classes.class_start_time
        ) at time zone 'America/Sao_Paulo'
      ) = target_starts_at
      and (classes.first_lesson_date is null
        or (target_starts_at at time zone 'America/Sao_Paulo')::date >= classes.first_lesson_date)
      and (membership.first_lesson_date is null
        or (target_starts_at at time zone 'America/Sao_Paulo')::date >= membership.first_lesson_date)
      and student.enrolled is true
      and student.archived is false
      and student.email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      and not exists (
        select 1 from private.student_regular_lesson_cancellations cancelled
        where cancelled.student_id = membership.user_id
          and cancelled.class_number = membership.class_number
          and cancelled.lesson_date =
            (target_starts_at at time zone 'America/Sao_Paulo')::date
          and not exists (
            select 1 from private.student_regular_lesson_restorations restored
            where restored.cancellation_id = cancelled.id
          )
      )
  ),
  progress as (
    select
      eligible.*,
      private.academic_next_lesson_number(eligible.user_id) as next_lesson,
      (
        select count(distinct studies.question_id)::integer
        from private.student_question_studies studies
        where studies.student_id = eligible.user_id
          and studies.studied_at > coalesce(
            (select max(occurrence.starts_at)
             from private.academic_lesson_occurrences occurrence
             where occurrence.student_id = eligible.user_id
               and occurrence.starts_at < target_starts_at
               and occurrence.attendance_status in ('present','absent')),
            eligible.joined_at
          )
          and studies.studied_at <= now()
      ) as studied_count
    from eligible
  )
  select
    progress.user_id,
    btrim(progress.email),
    coalesce(nullif(btrim(progress.name), ''), 'Aluno'),
    coalesce(nullif(btrim(progress.class_name), ''), 'Sua turma'),
    progress.next_lesson,
    progress.studied_count,
    progress.next_lesson is not null and not exists (
      select 1 from public.lesson_presentations presentation
      where presentation.student_id = progress.user_id
        and presentation.lesson_number = progress.next_lesson
        and nullif(btrim(presentation.body), '') is not null
    ),
    progress.studied_count < 5
  from progress;
$function$;
revoke all on function public.student_preparation_email_context_internal(uuid,integer,timestamptz)
  from public, anon, authenticated;
grant execute on function public.student_preparation_email_context_internal(uuid,integer,timestamptz)
  to service_role;

create or replace function private.enqueue_student_preparation_emails()
returns integer
language plpgsql security invoker set search_path = ''
as $function$
declare
  inserted_rows integer := 0;
  local_now timestamp := now() at time zone 'America/Sao_Paulo';
begin
  -- Only the day before, after 18:00 in Sao Paulo. Repeated runs
  -- also catch students enrolled later in the evening.
  if local_now::time < time '18:00' then
    return 0;
  end if;

  with upcoming as (
    select distinct
      membership.user_id as student_id,
      classes.class_number,
      (((local_now::date + 1) + classes.class_start_time)
        at time zone 'America/Sao_Paulo') as starts_at
    from public.class_students membership
    join public.teacher_classes classes on classes.class_number = membership.class_number
    where classes.is_active is true
      and classes.class_start_time is not null
      and classes.class_weekday = extract(isodow from local_now::date + 1)::smallint
  ), eligible as (
    select upcoming.*
    from upcoming
    cross join lateral public.student_preparation_email_context_internal(
      upcoming.student_id, upcoming.class_number, upcoming.starts_at
    ) context
    where context.missing_presentation or context.missing_questions
  ), inserted as (
    insert into public.student_preparation_email_reminders(student_id,class_number,starts_at)
    select student_id,class_number,starts_at from eligible
    on conflict (student_id,class_number,starts_at) do nothing
    returning id
  )
  select count(*) into inserted_rows from inserted;

  return inserted_rows;
end;
$function$;
revoke all on function private.enqueue_student_preparation_emails()
  from public,anon,authenticated;
grant execute on function private.enqueue_student_preparation_emails() to service_role;

create or replace function private.dispatch_student_preparation_emails()
returns void
language plpgsql security invoker set search_path = ''
as $function$
declare
  secret_value text;
begin
  if not coalesce((
    select enabled from public.student_preparation_email_settings where id is true
  ),false) then
    return;
  end if;

  -- Never start a new student mailing on the day of class.
  if (now() at time zone 'America/Sao_Paulo')::time < time '18:00' then
    return;
  end if;

  perform private.enqueue_student_preparation_emails();

  update public.student_preparation_email_reminders reminder
  set status='failed', last_error='worker_timeout'
  where reminder.status='processing'
    and reminder.last_attempt_at < now() - interval '10 minutes'
    and reminder.starts_at > now();

  if not exists (
    select 1 from public.student_preparation_email_reminders reminder
    where reminder.status in ('pending','failed')
      and reminder.attempts < 5
      and (reminder.starts_at at time zone 'America/Sao_Paulo')::date =
        (now() at time zone 'America/Sao_Paulo')::date + 1
  ) then
    return;
  end if;

  select decrypted_secret into secret_value
  from vault.decrypted_secrets
  where name='teacherflavius_notification_webhook_secret'
  limit 1;
  if nullif(secret_value,'') is null then
    raise warning 'Student preparation email webhook secret unavailable';
    return;
  end if;

  perform net.http_post(
    url := 'https://wnigzpvgsbpjdxvjzugt.supabase.co/functions/v1/notify-student-preparation',
    body := '{"source":"pg_cron"}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-webhook-secret',secret_value
    ),
    timeout_milliseconds := 10000
  );
end;
$function$;
revoke all on function private.dispatch_student_preparation_emails()
  from public,anon,authenticated;
grant execute on function private.dispatch_student_preparation_emails() to service_role;

do $schedule$
begin
  if not exists (select 1 from cron.job where jobname='student-preparation-email-reminders') then
    perform cron.schedule(
      'student-preparation-email-reminders',
      '*/5 * * * *',
      'select private.dispatch_student_preparation_emails();'
    );
  end if;
end;
$schedule$;

notify pgrst, 'reload schema';
