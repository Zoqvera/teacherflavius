-- Replay the actual private retry RPC against a disposable Supabase database.
-- ALL mutation is confined to this transaction; ROLLBACK restores the original retry function.
-- The pg_net HTTP function is replaced BEFORE any fixture is queued.
\set ON_ERROR_STOP on
begin;

-- Never allow real outbound email or webhook requests from this test.
alter table public.enrollment_email_notifications disable trigger user;
alter table public.makeup_class_email_notifications disable trigger user;
alter table public.regular_lesson_cancellation_email_notifications disable trigger user;

create temporary table retry_http_calls (
  id bigserial primary key,
  destination text not null,
  payload jsonb not null,
  webhook_secret_matches boolean not null
) on commit drop;

create function pg_temp.capture_http_post(
  url text,
  body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type": "application/json"}'::jsonb,
  timeout_milliseconds integer default 5000
)
returns bigint
language plpgsql
as $test_http_post$
declare
  request_id bigint;
begin
  if timeout_milliseconds <> 10000 then
    raise exception 'Unexpected retry transport timeout: %', timeout_milliseconds;
  end if;
  insert into pg_temp.retry_http_calls (
    destination, payload, webhook_secret_matches
  ) values (
    url, body, headers->>'x-webhook-secret' = (select decrypted_secret from vault.decrypted_secrets where name='teacherflavius_notification_webhook_secret' limit 1)
  ) returning id into request_id;
  return request_id;
end
$test_http_post$;

-- pg_net is owned by Supabase infrastructure; never change its schema.
-- Redirect only the outbound CALLS in the real RPC body, in this transaction.
-- Every filter, database query, and webhook payload remains unchanged.
do $redirect_http_sink$
declare
  original_definition text;
  replacement_definition text;
begin
  original_definition := pg_get_functiondef(
    'private.retry_transactional_email_notifications()'::regprocedure
  );
  if (length(original_definition)
      - length(replace(original_definition, 'net.http_post(', '')))
       / length('net.http_post(') <> 3 then
    raise exception 'Retry function must contain exactly three HTTP sinks';
  end if;
  replacement_definition := replace(
    original_definition, 'net.http_post(', 'pg_temp.capture_http_post('
  );
  execute replacement_definition;
end
$redirect_http_sink$;

-- The canonical baseline may already have a disposable Vault fixture.
-- Never assume a local secret is absent and never expose its value in CI logs.
-- With no seed, provision a disposable secret entirely inside this transaction.
do $ensure_fixture_secret$
begin
  if not exists (
    select 1 from vault.secrets
    where name='teacherflavius_notification_webhook_secret'
  ) then
    perform vault.create_secret(
      'isolated-ci-webhook-fixture',
      'teacherflavius_notification_webhook_secret',
      'Ephemeral token for retry CI; not used for production'
    );
  end if;
  if not exists (
    select 1 from vault.decrypted_secrets
    where name='teacherflavius_notification_webhook_secret'
      and nullif(decrypted_secret,'') is not null
  ) then
    raise exception 'Local webhook fixture secret is missing or empty';
  end if;
end
$ensure_fixture_secret$;

insert into auth.users (
  id, instance_id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, created_at, updated_at
) values (
  '13000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'retry-fixture@example.test', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, now(), now()
);

insert into public.profiles (
  id, name, email, enrolled, class_type
) values (
  '13000000-0000-4000-8000-000000000001',
  'ALUNO FICTICIO - RETRY CI', 'retry-fixture@example.test',
  false, 'QUINTETO'
);

insert into public.makeup_class_slots (
  id, starts_at, ends_at, capacity, notes, is_active, class_name, meeting_url
) values (
  '13000000-0000-4000-8000-000000000002',
  now() + interval '8 days', now() + interval '8 days 1 hour',
  2, 'CI: NAO AGENDAR', true,
  'TURMA FICTICIA RETRY', 'https://meet.google.com/landing'
);

insert into public.makeup_class_bookings (
  id, slot_id, student_id, class_number, class_name,
  student_name, student_email, meeting_url, status
) values (
  '13000000-0000-4000-8000-000000000003',
  '13000000-0000-4000-8000-000000000002',
  '13000000-0000-4000-8000-000000000001',
  99001, 'TURMA FICTICIA RETRY', 'ALUNO FICTICIO',
  'retry-fixture@example.test', 'https://meet.google.com/landing', 'confirmed'
);

-- Simulate one transient provider failure already recorded in each outbox.
insert into public.enrollment_email_notifications (
  id, student_id, status, attempts, created_at, last_attempt_at
) values (
  '13000000-0000-4000-8000-000000000011',
  '13000000-0000-4000-8000-000000000001',
  'failed', 1, now() - interval '35 minutes', now() - interval '11 minutes'
);

insert into public.makeup_class_email_notifications (
  id, booking_id, notification_type, status, attempts, created_at, last_attempt_at
) values (
  '13000000-0000-4000-8000-000000000012',
  '13000000-0000-4000-8000-000000000003',
  'booking_confirmation', 'failed', 1,
  now() - interval '35 minutes', now() - interval '11 minutes'
);

-- Eligible failed/pending rows plus four disallowed retry windows.
insert into public.regular_lesson_cancellation_email_notifications (
  id, credit_id, student_id, student_name, class_name, starts_at,
  cancelled_at, credit_granted, recipient_type,
  status, attempts, created_at, last_attempt_at
) values
  ('13000000-0000-4000-8000-000000000021',
   '13000000-0000-4000-8000-000000000031',
   '13000000-0000-4000-8000-000000000001',
   'FICTICIO RETRY', 'TURMA TESTE', now() + interval '1 day',
   now() - interval '35 minutes', true, 'student',
   'failed', 1, now() - interval '35 minutes', now() - interval '11 minutes'),
  ('13000000-0000-4000-8000-000000000022',
   '13000000-0000-4000-8000-000000000032',
   '13000000-0000-4000-8000-000000000001',
   'FICTICIO RETRY', 'TURMA TESTE', now() + interval '1 day',
   now() - interval '35 minutes', true, 'teacher',
   'pending', 0, now() - interval '35 minutes', null),
  ('13000000-0000-4000-8000-000000000023',
   '13000000-0000-4000-8000-000000000033',
   '13000000-0000-4000-8000-000000000001',
   'FICTICIO RETRY', 'TURMA TESTE', now() + interval '1 day',
   now() - interval '2 minutes', true, 'student',
   'failed', 1, now() - interval '2 minutes', now() - interval '1 minute'),
  ('13000000-0000-4000-8000-000000000024',
   '13000000-0000-4000-8000-000000000034',
   '13000000-0000-4000-8000-000000000001',
   'FICTICIO RETRY', 'TURMA TESTE', now() + interval '1 day',
   now() - interval '40 minutes', true, 'student',
   'failed', 1, now() - interval '40 minutes', now() - interval '4 minutes'),
  ('13000000-0000-4000-8000-000000000025',
   '13000000-0000-4000-8000-000000000035',
   '13000000-0000-4000-8000-000000000001',
   'FICTICIO RETRY', 'TURMA TESTE', now() + interval '1 day',
   now() - interval '40 minutes', true, 'student',
   'failed', 3, now() - interval '40 minutes', now() - interval '20 minutes'),
  ('13000000-0000-4000-8000-000000000026',
   '13000000-0000-4000-8000-000000000036',
   '13000000-0000-4000-8000-000000000001',
   'FICTICIO RETRY', 'TURMA TESTE', now() + interval '1 day',
   now() - interval '19 hours', true, 'student',
   'failed', 1, now() - interval '19 hours', now() - interval '19 hours'),
  ('13000000-0000-4000-8000-000000000027',
   '13000000-0000-4000-8000-000000000037',
   '13000000-0000-4000-8000-000000000001',
   'FICTICIO RETRY', 'TURMA TESTE', now() + interval '1 day',
   now() - interval '35 minutes', true, 'student',
   'sent', 1, now() - interval '35 minutes', now() - interval '11 minutes');

do $verify_retry$
declare
  answer jsonb;
  second_run jsonb;
begin
  answer := private.retry_transactional_email_notifications();
  if answer <> '{"enrollment": 1, "makeup": 1, "regular_cancellation": 2}'::jsonb then
    raise exception 'Unexpected retry selection: %', answer;
  end if;

  if (select count(*) from pg_temp.retry_http_calls) <> 4 then
    raise exception 'Expected four retry webhooks in local fake transport';
  end if;

  if exists (
    select 1 from pg_temp.retry_http_calls where not webhook_secret_matches
  ) then
    raise exception 'Incorrect webhook authentication for queued retry';
  end if;

  if (select count(distinct payload->>'table') from pg_temp.retry_http_calls) <> 3 then
    raise exception 'Retry did not cover all three notification outboxes';
  end if;

  if not exists (
    select 1 from pg_temp.retry_http_calls
    where destination like '%/notify-new-enrollment'
      and payload->>'table'='enrollment_email_notifications'
      and payload#>>'{record,id}'='13000000-0000-4000-8000-000000000011'
  ) or not exists (
    select 1 from pg_temp.retry_http_calls
    where destination like '%/notify-makeup-booking'
      and payload->>'table'='makeup_class_email_notifications'
      and payload#>>'{record,id}'='13000000-0000-4000-8000-000000000012'
  ) or (
    select count(*) from pg_temp.retry_http_calls
    where destination like '%/notify-regular-lesson-cancellation'
      and payload->>'table'='regular_lesson_cancellation_email_notifications'
      and payload#>>'{record,id}' in (
        '13000000-0000-4000-8000-000000000021',
        '13000000-0000-4000-8000-000000000022'
      )
  ) <> 2 then
    raise exception 'Webhook address, table, or record identifiers are incorrect';
  end if;

  -- The worker's successful responses close out the outboxes.
  update public.enrollment_email_notifications
  set status='sent', attempts=2, sent_at=now()
  where id='13000000-0000-4000-8000-000000000011';

  update public.makeup_class_email_notifications
  set status='sent', attempts=2, sent_at=now()
  where id='13000000-0000-4000-8000-000000000012';

  update public.regular_lesson_cancellation_email_notifications
  set status='sent', attempts=case when status='failed' then 2 else 1 end,
      sent_at=now()
  where id in (
    '13000000-0000-4000-8000-000000000021',
    '13000000-0000-4000-8000-000000000022'
  );

  second_run := private.retry_transactional_email_notifications();
  if second_run <> '{"enrollment": 0, "makeup": 0, "regular_cancellation": 0}'::jsonb
    or (select count(*) from pg_temp.retry_http_calls) <> 4 then
    raise exception 'Sent notifications were replayed by retry: %', second_run;
  end if;

  if exists (
    select 1 from public.regular_lesson_cancellation_email_notifications
    where id in (
      '13000000-0000-4000-8000-000000000023',
      '13000000-0000-4000-8000-000000000024',
      '13000000-0000-4000-8000-000000000025',
      '13000000-0000-4000-8000-000000000026'
    ) and status <> 'failed'
  ) then
    raise exception 'Retry modified blocked rows';
  end if;
end
$verify_retry$;

rollback;
