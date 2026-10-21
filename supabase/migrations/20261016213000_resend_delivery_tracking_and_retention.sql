-- ETAPA 7.3.2: isolated, opt-in Resend delivery evidence.
-- Deploy only after isolated PostgreSQL tests, LGPD retention approval and
-- Edge Function secret provisioning. Never backfill an assumed "delivered".
create table private.resend_delivery_messages (
  provider_email_id text primary key
    check (length(provider_email_id) between 8 and 128),
  queue_name text not null
    check (queue_name in ('enrollment', 'makeup', 'regular_cancellation')),
  notification_id uuid not null,
  recipient_role text not null
    check (recipient_role in ('student', 'teacher')),
  accepted_at timestamptz not null default now(),
  delivery_status text not null default 'accepted'
    check (delivery_status in (
      'accepted', 'sent', 'delayed', 'delivered',
      'failed', 'bounced', 'complained', 'suppressed'
    )),
  last_event_at timestamptz,
  unique (queue_name, notification_id, recipient_role)
);

create table private.resend_delivery_events (
  provider_event_id text primary key
    check (length(provider_event_id) between 8 and 128),
  provider_email_id text not null
    check (length(provider_email_id) between 8 and 128),
  event_type text not null
    check (event_type in (
      'email.sent', 'email.delivery_delayed', 'email.delivered',
      'email.failed', 'email.bounced', 'email.complained', 'email.suppressed'
    )),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now()
);

-- Defense in depth even though these tables are in an unexposed schema.
alter table private.resend_delivery_messages enable row level security;
alter table private.resend_delivery_events enable row level security;

create index resend_delivery_events_email_timeline_idx
  on private.resend_delivery_events (provider_email_id, occurred_at desc);

create index resend_delivery_messages_notification_idx
  on private.resend_delivery_messages (queue_name, notification_id);

-- All access is confined to privileged server-side functions; no browser role.
revoke all on private.resend_delivery_messages from public, anon, authenticated;
revoke all on private.resend_delivery_events from public, anon, authenticated;
grant select, insert, update on private.resend_delivery_messages to service_role;
grant select, insert on private.resend_delivery_events to service_role;

create or replace function private.refresh_resend_delivery_status(
  target_provider_email_id text
)
returns void
language plpgsql
set search_path = ''
as $body$
declare
  recent record;
begin
  select e.event_type, e.occurred_at
    into recent
  from private.resend_delivery_events e
  where e.provider_email_id = target_provider_email_id
  order by e.occurred_at desc,
    case e.event_type
      when 'email.complained' then 7
      when 'email.bounced' then 6
      when 'email.suppressed' then 5
      when 'email.failed' then 4
      when 'email.delivered' then 3
      when 'email.delivery_delayed' then 2
      else 1
    end desc, e.provider_event_id desc
  limit 1;

  if found then
    update private.resend_delivery_messages m
       set delivery_status = case recent.event_type
           when 'email.sent' then 'sent'
           when 'email.delivery_delayed' then 'delayed'
           when 'email.delivered' then 'delivered'
           when 'email.failed' then 'failed'
           when 'email.bounced' then 'bounced'
           when 'email.complained' then 'complained'
           when 'email.suppressed' then 'suppressed'
         end,
         last_event_at = recent.occurred_at
     where m.provider_email_id = target_provider_email_id;
  end if;
end;
$body$;

revoke all on function private.refresh_resend_delivery_status(text)
  from public, anon, authenticated;
grant execute on function private.refresh_resend_delivery_status(text)
  to service_role;

-- Exposed RPC names are service_role-only, and never accept names or addresses.
create or replace function public.record_resend_message_acceptance(
  p_queue_name text,
  p_notification_id uuid,
  p_recipient_role text,
  p_provider_email_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $body$
declare
  existing_provider_id text;
  notice_exists boolean;
begin
  if p_notification_id is null
     or p_queue_name not in ('enrollment', 'makeup', 'regular_cancellation')
     or p_recipient_role not in ('student', 'teacher')
     or p_provider_email_id is null
     or p_provider_email_id !~ '^[a-zA-Z0-9_-]{8,128}$'
  then
    raise exception 'Invalid Resend acceptance parameters';
  end if;

  case p_queue_name
    when 'enrollment' then
      select exists(
        select 1 from public.enrollment_email_notifications
        where id = p_notification_id
      ) into notice_exists;
    when 'makeup' then
      select exists(
        select 1 from public.makeup_class_email_notifications
        where id = p_notification_id
      ) into notice_exists;
    when 'regular_cancellation' then
      select exists(
        select 1 from public.regular_lesson_cancellation_email_notifications
        where id = p_notification_id and recipient_type = p_recipient_role
      ) into notice_exists;
  end case;

  if not coalesce(notice_exists, false) then
    raise exception 'Notification unavailable for delivery tracking';
  end if;

  insert into private.resend_delivery_messages (
    provider_email_id, queue_name, notification_id, recipient_role
  )
  values (
    p_provider_email_id, p_queue_name, p_notification_id, p_recipient_role
  )
  on conflict (queue_name, notification_id, recipient_role) do nothing;

  select m.provider_email_id into existing_provider_id
  from private.resend_delivery_messages m
  where m.queue_name = p_queue_name and m.notification_id = p_notification_id
    and m.recipient_role = p_recipient_role;

  if existing_provider_id is distinct from p_provider_email_id then
    raise exception 'Conflicting Resend provider identity';
  end if;

  perform private.refresh_resend_delivery_status(p_provider_email_id);
  return true;
end;
$body$;

revoke all on function public.record_resend_message_acceptance(
  text, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.record_resend_message_acceptance(
  text, uuid, text, text
) to service_role;

create or replace function public.record_resend_delivery_event(
  p_provider_event_id text,
  p_provider_email_id text,
  p_event_type text,
  p_occurred_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $body$
declare
  inserted_events integer;
begin
  if p_provider_event_id is null
     or p_provider_event_id !~ '^[a-zA-Z0-9_-]{8,128}$'
     or p_provider_email_id is null
     or p_provider_email_id !~ '^[a-zA-Z0-9_-]{8,128}$'
     or p_event_type not in (
       'email.sent', 'email.delivery_delayed', 'email.delivered',
       'email.failed', 'email.bounced', 'email.complained', 'email.suppressed'
     )
     or p_occurred_at is null
     or p_occurred_at > now() + interval '5 minutes'
     or p_occurred_at < timestamp with time zone '2025-01-01 00:00:00+00'
  then
    raise exception 'Invalid Resend event parameters';
  end if;

  insert into private.resend_delivery_events (
    provider_event_id, provider_email_id, event_type, occurred_at
  )
  values (p_provider_event_id, p_provider_email_id, p_event_type, p_occurred_at)
  on conflict (provider_event_id) do nothing;

  get diagnostics inserted_events = row_count;
  if inserted_events = 0 and exists (
    select 1 from private.resend_delivery_events e
    where e.provider_event_id = p_provider_event_id
      and (e.provider_email_id <> p_provider_email_id
        or e.event_type <> p_event_type
        or e.occurred_at <> p_occurred_at)
  ) then
    raise exception 'Conflicting Resend event replay';
  end if;

  perform private.refresh_resend_delivery_status(p_provider_email_id);
  return inserted_events = 1;
end;
$body$;

revoke all on function public.record_resend_delivery_event(
  text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.record_resend_delivery_event(
  text, text, text, timestamptz
) to service_role;

-- Evidence retention policy approved 16/10/2026. See routine below.

-- ETAPA 7.3.3: retention approved 16/10/2026.
-- Events: 90 days since receipt. Message identity: 180 days since acceptance.
-- No cron is registered by this migration. Activate retention ONLY in a
-- separately controlled release after external integration is approved.
grant delete on private.resend_delivery_events to service_role;
grant delete on private.resend_delivery_messages to service_role;

create index resend_delivery_events_retention_idx
  on private.resend_delivery_events (received_at, provider_event_id);
create index resend_delivery_messages_retention_idx
  on private.resend_delivery_messages (accepted_at, provider_email_id);

-- SECURITY INVOKER: requires the caller's own privileges.
-- Exposes no event contents, recipients or personal information.
create or replace function public.prune_resend_delivery_evidence(
  p_batch_limit integer default 500
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $retention$
declare
  cutoff_time timestamptz := statement_timestamp();
  removed_events integer := 0;
  removed_messages integer := 0;
begin
  if p_batch_limit is null or p_batch_limit < 1 or p_batch_limit > 1000 then
    raise exception 'Invalid Resend retention batch size';
  end if;

  with eligible as (
    select event.provider_event_id
      from private.resend_delivery_events event
     where event.received_at < cutoff_time - interval '90 days'
     order by event.received_at, event.provider_event_id
     limit p_batch_limit
     for update skip locked
  ), deleted as (
    delete from private.resend_delivery_events event
     where event.provider_event_id in (
       select eligible.provider_event_id from eligible
     )
    returning event.provider_event_id
  )
  select count(*)::integer into removed_events from deleted;

  with eligible as (
    select message.provider_email_id
      from private.resend_delivery_messages message
     where message.accepted_at < cutoff_time - interval '180 days'
     order by message.accepted_at, message.provider_email_id
     limit p_batch_limit
     for update skip locked
  ), deleted as (
    delete from private.resend_delivery_messages message
     where message.provider_email_id in (
       select eligible.provider_email_id from eligible
     )
    returning message.provider_email_id
  )
  select count(*)::integer into removed_messages from deleted;

  return jsonb_build_object(
    'events_deleted', removed_events,
    'messages_deleted', removed_messages
  );
end;
$retention$;

revoke all on function public.prune_resend_delivery_evidence(integer)
  from public, anon, authenticated;
grant execute on function public.prune_resend_delivery_evidence(integer)
  to service_role;

-- An active schedule and production data deletion require separate release.
