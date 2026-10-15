-- Separate, idempotent cancellation messages after a committed regular-lesson cancellation.
-- Canonical credit and eligibility logic remains untouched.
create table if not exists public.regular_lesson_cancellation_email_notifications (
  id uuid primary key default gen_random_uuid(),
  credit_id uuid not null,
  student_id uuid not null,
  student_name text not null,
  class_name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  cancelled_at timestamptz not null,
  credit_granted boolean not null,
  recipient_type text not null check (recipient_type in ('student', 'teacher')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  last_error text,
  constraint regular_cancellation_notification_dedupe unique (credit_id, cancelled_at, recipient_type)
);

alter table public.regular_lesson_cancellation_email_notifications enable row level security;
revoke all on public.regular_lesson_cancellation_email_notifications from public, anon, authenticated;
grant select, insert, update on public.regular_lesson_cancellation_email_notifications to service_role;

comment on table public.regular_lesson_cancellation_email_notifications is
  'Private service-role outbox for student and teacher emails on confirmed regular lesson cancellations.';

create or replace function private.enqueue_regular_lesson_cancellation_emails()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  display_student_name text;
begin
  select coalesce(nullif(btrim(p.name), ''), 'Aluno')
    into display_student_name
  from public.profiles p
  where p.id = new.student_id;

  insert into public.regular_lesson_cancellation_email_notifications (
    credit_id, student_id, student_name, class_name,
    starts_at, ends_at, cancelled_at, credit_granted, recipient_type
  )
  select
    new.id,
    new.student_id,
    coalesce(display_student_name, 'Aluno'),
    coalesce(nullif(btrim(new.regular_class_name), ''), 'Turma'),
    new.regular_starts_at,
    new.regular_ends_at,
    new.cancelled_at,
    new.status = 'available',
    recipient.recipient_type
  from (values ('student'::text), ('teacher'::text)) as recipient(recipient_type)
  on conflict (credit_id, cancelled_at, recipient_type) do nothing;

  return new;
end;
$function$;

revoke all on function private.enqueue_regular_lesson_cancellation_emails()
  from public, anon, authenticated;

drop trigger if exists enqueue_regular_lesson_cancellation_emails on private.lesson_credits;

create trigger enqueue_regular_lesson_cancellation_emails
after update of status, cancelled_at on private.lesson_credits
for each row
when (
  old.status = 'scheduled'
  and new.status in ('available', 'forfeited')
  and new.cancelled_at is not null
  and old.cancelled_at is distinct from new.cancelled_at
  and new.regular_starts_at is not null
  and new.revoked_at is null
)
execute function private.enqueue_regular_lesson_cancellation_emails();

create or replace function private.dispatch_regular_lesson_cancellation_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  webhook_secret text;
begin
  select ds.decrypted_secret
    into webhook_secret
  from vault.decrypted_secrets ds
  where ds.name = 'teacherflavius_notification_webhook_secret'
  limit 1;

  if nullif(webhook_secret, '') is null then
    raise warning 'Regular lesson cancellation webhook secret is unavailable';
    return new;
  end if;

  perform net.http_post(
    url := 'https://wnigzpvgsbpjdxvjzugt.supabase.co/functions/v1/notify-regular-lesson-cancellation',
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', tg_table_name,
      'schema', tg_table_schema,
      'record', jsonb_build_object('id', new.id)
    ),
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', webhook_secret
    ),
    timeout_milliseconds := 10000
  );
  return new;
end;
$function$;

revoke all on function private.dispatch_regular_lesson_cancellation_email()
  from public, anon, authenticated;

drop trigger if exists dispatch_regular_lesson_cancellation_email
  on public.regular_lesson_cancellation_email_notifications;

create trigger dispatch_regular_lesson_cancellation_email
after insert on public.regular_lesson_cancellation_email_notifications
for each row
execute function private.dispatch_regular_lesson_cancellation_email();

-- Student cancellation emails already exist; queue a separate teacher email.
alter table public.makeup_class_email_notifications
  drop constraint if exists makeup_class_email_notifications_notification_type_check;

alter table public.makeup_class_email_notifications
  add constraint makeup_class_email_notifications_notification_type_check
  check (notification_type in ('booking_confirmation', 'cancellation', 'teacher_booking', 'teacher_cancellation'));

create or replace function private.enqueue_teacher_makeup_cancellation_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.makeup_class_email_notifications (booking_id, notification_type)
  values (new.booking_id, 'teacher_cancellation')
  on conflict (booking_id, notification_type) do nothing;

  return new;
end;
$function$;

revoke all on function private.enqueue_teacher_makeup_cancellation_email()
  from public, anon, authenticated;

drop trigger if exists enqueue_teacher_makeup_cancellation_email
  on public.makeup_class_email_notifications;

create trigger enqueue_teacher_makeup_cancellation_email
after insert on public.makeup_class_email_notifications
for each row
when (new.notification_type = 'cancellation')
execute function private.enqueue_teacher_makeup_cancellation_email();
