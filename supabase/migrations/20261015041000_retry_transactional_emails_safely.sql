-- Bounded recovery for confirmed transactional notification outboxes.
-- No existing rows are modified, and no message is resent after the 18-hour safety window.
create or replace function private.retry_transactional_email_notifications()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  webhook_secret text;
  enrollment_row record;
  makeup_row record;
  regular_row record;
  enrollments integer := 0;
  makeups integer := 0;
  cancellations integer := 0;
begin
  select ds.decrypted_secret into webhook_secret
  from vault.decrypted_secrets ds
  where ds.name = 'teacherflavius_notification_webhook_secret'
  limit 1;

  if nullif(webhook_secret, '') is null then
    raise warning 'Transactional email retry secret is missing';
    return jsonb_build_object('queued', 0, 'reason', 'missing_secret');
  end if;

  for enrollment_row in
    select id, student_id
    from public.enrollment_email_notifications
    where status in ('pending', 'failed')
      and attempts < 3
      and created_at between now() - interval '18 hours' and now() - interval '5 minutes'
      and (last_attempt_at is null or last_attempt_at <= now() - interval '10 minutes')
    order by created_at, id
    limit 15
  loop
    perform net.http_post(
      url := 'https://wnigzpvgsbpjdxvjzugt.supabase.co/functions/v1/notify-new-enrollment',
      body := pg_catalog.jsonb_build_object(
        'type', 'INSERT', 'schema', 'public', 'table', 'enrollment_email_notifications',
        'record', pg_catalog.jsonb_build_object('id', enrollment_row.id, 'student_id', enrollment_row.student_id)
      ),
      params := '{}'::jsonb,
      headers := pg_catalog.jsonb_build_object(
        'Content-Type', 'application/json', 'x-webhook-secret', webhook_secret
      ),
      timeout_milliseconds := 10000
    );
    enrollments := enrollments + 1;
  end loop;

  for makeup_row in
    select id, booking_id
    from public.makeup_class_email_notifications
    where status in ('pending', 'failed')
      and attempts < 3
      and created_at between now() - interval '18 hours' and now() - interval '5 minutes'
      and (last_attempt_at is null or last_attempt_at <= now() - interval '10 minutes')
    order by created_at, id
    limit 15
  loop
    perform net.http_post(
      url := 'https://wnigzpvgsbpjdxvjzugt.supabase.co/functions/v1/notify-makeup-booking',
      body := pg_catalog.jsonb_build_object(
        'type', 'INSERT', 'schema', 'public', 'table', 'makeup_class_email_notifications',
        'record', pg_catalog.jsonb_build_object('id', makeup_row.id, 'booking_id', makeup_row.booking_id)
      ),
      params := '{}'::jsonb,
      headers := pg_catalog.jsonb_build_object(
        'Content-Type', 'application/json', 'x-webhook-secret', webhook_secret
      ),
      timeout_milliseconds := 10000
    );
    makeups := makeups + 1;
  end loop;

  for regular_row in
    select id
    from public.regular_lesson_cancellation_email_notifications
    where status in ('pending', 'failed')
      and attempts < 3
      and created_at between now() - interval '18 hours' and now() - interval '5 minutes'
      and (last_attempt_at is null or last_attempt_at <= now() - interval '10 minutes')
    order by created_at, id
    limit 15
  loop
    perform net.http_post(
      url := 'https://wnigzpvgsbpjdxvjzugt.supabase.co/functions/v1/notify-regular-lesson-cancellation',
      body := pg_catalog.jsonb_build_object(
        'type', 'INSERT', 'schema', 'public', 'table', 'regular_lesson_cancellation_email_notifications',
        'record', pg_catalog.jsonb_build_object('id', regular_row.id)
      ),
      params := '{}'::jsonb,
      headers := pg_catalog.jsonb_build_object(
        'Content-Type', 'application/json', 'x-webhook-secret', webhook_secret
      ),
      timeout_milliseconds := 10000
    );
    cancellations := cancellations + 1;
  end loop;

  return pg_catalog.jsonb_build_object(
    'enrollment', enrollments,
    'makeup', makeups,
    'regular_cancellation', cancellations
  );
end;
$function$;

revoke all on function private.retry_transactional_email_notifications()
  from public, anon, authenticated;

-- Existing pg_cron extension is installed and used by the application.
select cron.schedule(
  'transactional-email-retry-10m',
  '*/10 * * * *',
  'select private.retry_transactional_email_notifications();'
);
