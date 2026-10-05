-- PWA Web Push subscriptions, delivery queue, and signed scheduler.
-- Private subscription credentials never become directly accessible to browser roles.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_secret text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint web_push_subscriptions_endpoint_length
    check (char_length(endpoint) between 1 and 2048),
  constraint web_push_subscriptions_p256dh_length
    check (char_length(p256dh) between 1 and 256),
  constraint web_push_subscriptions_auth_length
    check (char_length(auth_secret) between 1 and 128),
  constraint web_push_subscriptions_user_agent_length
    check (user_agent is null or char_length(user_agent) <= 512)
);

create index if not exists web_push_subscriptions_user_active_idx
  on private.web_push_subscriptions (user_id, revoked_at);

create table if not exists private.web_push_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references private.web_push_subscriptions(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  notification_type text not null
    check (notification_type in ('lesson_13h', 'tuition_2d', 'tuition_due')),
  subject_key text not null,
  scheduled_for timestamptz not null,
  title text not null,
  body text not null,
  target_url text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'expired')),
  attempts smallint not null default 0 check (attempts between 0 and 10),
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint web_push_delivery_subject_key_length
    check (char_length(subject_key) between 1 and 180),
  constraint web_push_delivery_title_length
    check (char_length(title) between 1 and 120),
  constraint web_push_delivery_body_length
    check (char_length(body) between 1 and 500),
  constraint web_push_delivery_target_url_length
    check (char_length(target_url) between 1 and 500),
  constraint web_push_delivery_unique
    unique (subscription_id, notification_type, subject_key)
);

create index if not exists web_push_delivery_due_idx
  on private.web_push_notification_deliveries (
    status,
    next_attempt_at,
    scheduled_for
  );

revoke all on table private.web_push_subscriptions from public, anon, authenticated;
revoke all on table private.web_push_notification_deliveries from public, anon, authenticated;
grant select, insert, update, delete on table private.web_push_subscriptions to service_role;
grant select, insert, update, delete on table private.web_push_notification_deliveries to service_role;

create or replace function private.touch_web_push_subscription_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

revoke all on function private.touch_web_push_subscription_updated_at()
  from public, anon, authenticated;

drop trigger if exists web_push_subscriptions_set_updated_at
  on private.web_push_subscriptions;
create trigger web_push_subscriptions_set_updated_at
before update on private.web_push_subscriptions
for each row
execute function private.touch_web_push_subscription_updated_at();

create or replace function private.touch_web_push_delivery_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

revoke all on function private.touch_web_push_delivery_updated_at()
  from public, anon, authenticated;

drop trigger if exists web_push_delivery_set_updated_at
  on private.web_push_notification_deliveries;
create trigger web_push_delivery_set_updated_at
before update on private.web_push_notification_deliveries
for each row
execute function private.touch_web_push_delivery_updated_at();

create or replace function public.upsert_my_web_push_subscription(
  target_endpoint text,
  target_p256dh text,
  target_auth text,
  target_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
  subscription_id uuid;
begin
  if caller_id is null then
    raise exception 'Faça login para ativar notificações.' using errcode = '42501';
  end if;

  target_endpoint := btrim(coalesce(target_endpoint, ''));
  target_p256dh := btrim(coalesce(target_p256dh, ''));
  target_auth := btrim(coalesce(target_auth, ''));
  target_user_agent := nullif(left(btrim(coalesce(target_user_agent, '')), 512), '');

  if target_endpoint !~ '^https://'
     or char_length(target_endpoint) > 2048 then
    raise exception 'Assinatura de notificação inválida.';
  end if;

  if target_p256dh = '' or char_length(target_p256dh) > 256
     or target_auth = '' or char_length(target_auth) > 128 then
    raise exception 'Chaves de notificação inválidas.';
  end if;

  insert into private.web_push_subscriptions (
    user_id,
    endpoint,
    p256dh,
    auth_secret,
    user_agent,
    last_seen_at,
    revoked_at
  )
  values (
    caller_id,
    target_endpoint,
    target_p256dh,
    target_auth,
    target_user_agent,
    now(),
    null
  )
  on conflict (endpoint) do update
  set
    p256dh = excluded.p256dh,
    auth_secret = excluded.auth_secret,
    user_agent = excluded.user_agent,
    last_seen_at = now(),
    revoked_at = null
  where private.web_push_subscriptions.user_id = caller_id
  returning id into subscription_id;

  if subscription_id is null then
    raise exception 'Esta assinatura de notificação já pertence a outra conta.'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'ok', true,
    'subscription_id', subscription_id
  );
end;
$function$;

revoke all on function public.upsert_my_web_push_subscription(text, text, text, text)
  from public, anon;
grant execute on function public.upsert_my_web_push_subscription(text, text, text, text)
  to authenticated, service_role;

create or replace function public.delete_my_web_push_subscription(
  target_endpoint text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'Faça login para desativar notificações.' using errcode = '42501';
  end if;

  update private.web_push_subscriptions subscription
  set
    revoked_at = coalesce(subscription.revoked_at, now()),
    last_seen_at = now()
  where subscription.user_id = caller_id
    and subscription.endpoint = btrim(coalesce(target_endpoint, ''))
    and subscription.revoked_at is null;

  return found;
end;
$function$;

revoke all on function public.delete_my_web_push_subscription(text)
  from public, anon;
grant execute on function public.delete_my_web_push_subscription(text)
  to authenticated, service_role;

create or replace function public.validate_web_push_dispatch_signature(
  candidate_timestamp text,
  candidate_signature text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  dispatch_secret text;
  expected_signature text;
begin
  if candidate_timestamp !~ '^[0-9]{10,13}$'
     or candidate_signature !~ '^[a-fA-F0-9]{64}$' then
    return false;
  end if;

  select secret.decrypted_secret
    into dispatch_secret
  from vault.decrypted_secrets secret
  where secret.name = 'teacherflavius_web_push_cron_secret'
  limit 1;

  if nullif(dispatch_secret, '') is null then
    return false;
  end if;

  expected_signature := pg_catalog.encode(
    extensions.hmac(candidate_timestamp, dispatch_secret, 'sha256'),
    'hex'
  );

  return expected_signature = lower(candidate_signature);
end;
$function$;

revoke all on function public.validate_web_push_dispatch_signature(text, text)
  from public, anon, authenticated;
grant execute on function public.validate_web_push_dispatch_signature(text, text)
  to service_role;

create or replace function public.get_web_push_vapid_private_key()
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select secret.decrypted_secret
  from vault.decrypted_secrets secret
  where secret.name = 'teacherflavius_web_push_vapid_private_key'
  limit 1;
$function$;

revoke all on function public.get_web_push_vapid_private_key()
  from public, anon, authenticated;
grant execute on function public.get_web_push_vapid_private_key()
  to service_role;

create or replace function private.enqueue_due_web_push_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  inserted_count integer := 0;
  current_local_date date := timezone('America/Sao_Paulo', now())::date;
begin
  with lesson_occurrences as (
    select
      credit.student_id,
      credit.id as credit_id,
      case
        when credit.status = 'used' then slot.starts_at
        else credit.regular_starts_at
      end as starts_at
    from private.lesson_credits credit
    left join public.makeup_class_bookings booking
      on booking.id = credit.makeup_booking_id
    left join public.makeup_class_slots slot
      on slot.id = booking.slot_id
    where credit.revoked_at is null
      and (
        (
          credit.status = 'scheduled'
          and credit.cancelled_at is null
          and credit.regular_starts_at > now()
        )
        or
        (
          credit.status = 'used'
          and booking.status = 'confirmed'
          and slot.starts_at > now()
        )
      )
  ),
  ranked_lessons as (
    select
      occurrence.*,
      row_number() over (
        partition by occurrence.student_id
        order by occurrence.starts_at asc, occurrence.credit_id asc
      ) as lesson_rank
    from lesson_occurrences occurrence
    where occurrence.starts_at is not null
  )
  insert into private.web_push_notification_deliveries (
    subscription_id,
    student_id,
    notification_type,
    subject_key,
    scheduled_for,
    title,
    body,
    target_url
  )
  select
    subscription.id,
    lesson.student_id,
    'lesson_13h',
    'lesson:' || lesson.credit_id::text || ':' ||
      floor(extract(epoch from lesson.starts_at))::bigint::text,
    lesson.starts_at - interval '13 hours',
    'Teacher Flávio',
    'Sua aula está próxima. Se você não puder participar, ainda dá tempo de cancelar e marcar uma reposição.',
    '/area-do-estudante/minhas-aulas/'
  from ranked_lessons lesson
  join private.web_push_subscriptions subscription
    on subscription.user_id = lesson.student_id
   and subscription.revoked_at is null
  where lesson.lesson_rank = 1
    and lesson.starts_at - interval '13 hours' <= now()
    and lesson.starts_at - interval '12 hours 50 minutes' > now()
  on conflict (subscription_id, notification_type, subject_key) do nothing;

  get diagnostics inserted_count = row_count;

  with due_tuitions as (
    select
      tuition.id,
      tuition.student_id,
      tuition.due_date
    from public.monthly_tuition tuition
    join public.profiles profile
      on profile.id = tuition.student_id
    where tuition.payment_date is null
      and coalesce(tuition.is_exempt, false) = false
      and coalesce(profile.enrolled, false) = true
      and coalesce(profile.archived, false) = false
      and tuition.due_date in (
        current_local_date,
        current_local_date + 2
      )
  ),
  tuition_candidates as (
    select
      tuition.id,
      tuition.student_id,
      tuition.due_date,
      case
        when tuition.due_date = current_local_date + 2
          then 'tuition_2d'
        else 'tuition_due'
      end as notification_type,
      case
        when tuition.due_date = current_local_date + 2
          then ((tuition.due_date - 2) + time '09:00') at time zone 'America/Sao_Paulo'
        else (tuition.due_date + time '09:00') at time zone 'America/Sao_Paulo'
      end as scheduled_for,
      case
        when tuition.due_date = current_local_date + 2
          then 'Sua mensalidade vence em dois dias, acesse o app e realize o pagamento para garantir sua permanência no curso.'
        else 'Sua mensalidade vence hoje, acesse o app e realize o pagamento para garantir sua permanência no curso.'
      end as notification_body
    from due_tuitions tuition
  )
  insert into private.web_push_notification_deliveries (
    subscription_id,
    student_id,
    notification_type,
    subject_key,
    scheduled_for,
    title,
    body,
    target_url
  )
  select
    subscription.id,
    tuition.student_id,
    tuition.notification_type,
    'tuition:' || tuition.id::text,
    tuition.scheduled_for,
    'Teacher Flávio',
    tuition.notification_body,
    '/pagamento/'
  from tuition_candidates tuition
  join private.web_push_subscriptions subscription
    on subscription.user_id = tuition.student_id
   and subscription.revoked_at is null
  where tuition.scheduled_for <= now()
  on conflict (subscription_id, notification_type, subject_key) do nothing;

  get diagnostics inserted_count = inserted_count + row_count;
  return inserted_count;
end;
$function$;

revoke all on function private.enqueue_due_web_push_notifications()
  from public, anon, authenticated;

create or replace function public.claim_due_web_push_notifications(
  target_limit integer default 100
)
returns table (
  delivery_id uuid,
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth_secret text,
  notification_title text,
  notification_body text,
  target_url text,
  notification_tag text
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Acesso restrito ao serviço de notificações.' using errcode = '42501';
  end if;

  perform private.enqueue_due_web_push_notifications();

  return query
  with candidates as (
    select delivery.id
    from private.web_push_notification_deliveries delivery
    join private.web_push_subscriptions subscription
      on subscription.id = delivery.subscription_id
     and subscription.revoked_at is null
    where delivery.attempts < 3
      and delivery.scheduled_for <= now()
      and delivery.next_attempt_at <= now()
      and (
        delivery.status in ('pending', 'failed')
        or (
          delivery.status = 'sending'
          and delivery.last_attempt_at < now() - interval '10 minutes'
        )
      )
    order by delivery.scheduled_for asc, delivery.created_at asc
    for update of delivery skip locked
    limit greatest(1, least(coalesce(target_limit, 100), 200))
  ),
  claimed as (
    update private.web_push_notification_deliveries delivery
    set
      status = 'sending',
      attempts = delivery.attempts + 1,
      last_attempt_at = now(),
      last_error = null
    from candidates
    where delivery.id = candidates.id
    returning delivery.*
  )
  select
    claimed.id,
    subscription.id,
    subscription.endpoint,
    subscription.p256dh,
    subscription.auth_secret,
    claimed.title,
    claimed.body,
    claimed.target_url,
    claimed.notification_type || ':' || claimed.subject_key
  from claimed
  join private.web_push_subscriptions subscription
    on subscription.id = claimed.subscription_id;
end;
$function$;

revoke all on function public.claim_due_web_push_notifications(integer)
  from public, anon, authenticated;
grant execute on function public.claim_due_web_push_notifications(integer)
  to service_role;

create or replace function public.record_web_push_delivery_result(
  target_delivery_id uuid,
  target_outcome text,
  target_status_code integer default null,
  target_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  delivery_row private.web_push_notification_deliveries%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Acesso restrito ao serviço de notificações.' using errcode = '42501';
  end if;

  if target_outcome not in ('sent', 'failed', 'expired') then
    raise exception 'Resultado de entrega inválido.';
  end if;

  select delivery.*
  into delivery_row
  from private.web_push_notification_deliveries delivery
  where delivery.id = target_delivery_id
  for update;

  if not found then
    return false;
  end if;

  if target_outcome = 'sent' then
    update private.web_push_notification_deliveries
    set
      status = 'sent',
      sent_at = now(),
      last_error = null
    where id = target_delivery_id;
  elsif target_outcome = 'expired' or target_status_code in (404, 410) then
    update private.web_push_notification_deliveries
    set
      status = 'expired',
      last_error = left(coalesce(target_error, 'Push subscription expired'), 1000)
    where id = target_delivery_id;

    update private.web_push_subscriptions
    set revoked_at = coalesce(revoked_at, now())
    where id = delivery_row.subscription_id;
  else
    update private.web_push_notification_deliveries
    set
      status = 'failed',
      next_attempt_at = now() + interval '5 minutes',
      last_error = left(coalesce(target_error, 'Push delivery failed'), 1000)
    where id = target_delivery_id;
  end if;

  return true;
end;
$function$;

revoke all on function public.record_web_push_delivery_result(uuid, text, integer, text)
  from public, anon, authenticated;
grant execute on function public.record_web_push_delivery_result(uuid, text, integer, text)
  to service_role;

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

do $block$
declare
  existing_job_id bigint;
begin
  select jobid
  into existing_job_id
  from cron.job
  where jobname = 'web-push-notifications'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'web-push-notifications',
    '* * * * *',
    'select private.dispatch_web_push_notifications();'
  );
end;
$block$;
