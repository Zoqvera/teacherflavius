-- Keep Supabase JWT verification enabled on the Push sender while retaining HMAC authentication.

create or replace function private.dispatch_web_push_notifications()
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  dispatch_secret text;
  request_timestamp text;
  request_signature text;
  request_id bigint;
begin
  select secret.decrypted_secret
    into dispatch_secret
  from vault.decrypted_secrets secret
  where secret.name = 'teacherflavius_web_push_cron_secret'
  limit 1;

  if nullif(dispatch_secret, '') is null then
    raise warning 'Web Push dispatch secret is unavailable';
    return null;
  end if;

  request_timestamp := floor(extract(epoch from pg_catalog.clock_timestamp()))::bigint::text;
  request_signature := pg_catalog.encode(
    extensions.hmac(request_timestamp, dispatch_secret, 'sha256'),
    'hex'
  );

  select net.http_post(
    url := 'https://wnigzpvgsbpjdxvjzugt.supabase.co/functions/v1/send-student-push-notifications',
    body := '{}'::jsonb,
    params := '{}'::jsonb,
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InduaWd6cHZnc2JwamR4dmp6dWd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxOTk1NzUsImV4cCI6MjA5Mjc3NTU3NX0.q2Mp8bPD4WvOjifSuQFfrAM4ig1ViEa6sMfUNcES-X0',
      'x-push-timestamp', request_timestamp,
      'x-push-signature', request_signature
    ),
    timeout_milliseconds := 30000
  )
  into request_id;

  return request_id;
end;
$function$;

revoke all on function private.dispatch_web_push_notifications()
  from public, anon, authenticated;
