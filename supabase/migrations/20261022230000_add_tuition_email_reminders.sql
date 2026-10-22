-- Student tuition emails: D-2, D0 and D+2. No historical backfill.
-- Private queue stores no recipient address or payment credentials.
create table if not exists private.tuition_email_reminders (
  id uuid primary key default gen_random_uuid(),
  tuition_id uuid not null references public.monthly_tuition(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  due_date date not null,
  reminder_kind text not null check (reminder_kind in ('before_due', 'due_today', 'after_due')),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'skipped')),
  attempts smallint not null default 0 check (attempts between 0 and 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  unique (tuition_id, due_date, reminder_kind)
);

create index if not exists tuition_email_reminders_due_idx
  on private.tuition_email_reminders (status, created_at, last_attempt_at)
  where status in ('pending', 'processing', 'failed');

alter table private.tuition_email_reminders enable row level security;
revoke all on table private.tuition_email_reminders from public, anon, authenticated;
grant select, insert, update on table private.tuition_email_reminders to service_role;

-- Called only by the daily 09:00 Sao Paulo job. Never catch up past calendar dates.
create or replace function private.enqueue_daily_tuition_email_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  local_day date := (now() at time zone 'America/Sao_Paulo')::date;
  inserted_count integer;
begin
  if local_day < date '2026-10-23'
    or (now() at time zone 'America/Sao_Paulo')::time < time '09:00'
    or (now() at time zone 'America/Sao_Paulo')::time >= time '09:30'
  then
    return 0;
  end if;

  insert into private.tuition_email_reminders (
    tuition_id, student_id, due_date, reminder_kind
  )
  select
    tuition.id, tuition.student_id, tuition.due_date,
    case
      when tuition.due_date = local_day + 2 then 'before_due'
      when tuition.due_date = local_day then 'due_today'
      else 'after_due'
    end
  from public.monthly_tuition tuition
  join public.profiles student on student.id = tuition.student_id
  where tuition.due_date in (local_day + 2, local_day, local_day - 2)
    and tuition.payment_date is null
    and coalesce(tuition.is_exempt, false) = false
    and tuition.amount_due > 0
    and student.enrolled = true
    and student.archived = false
  on conflict (tuition_id, due_date, reminder_kind) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$function$;
revoke all on function private.enqueue_daily_tuition_email_reminders()
  from public, anon, authenticated;

-- An atomic claim rechecks all billing rules before any student can be contacted.
create or replace function public.claim_tuition_email_reminders_internal(target_limit integer default 20)
returns table (
  reminder_id uuid,
  tuition_id uuid,
  student_id uuid,
  due_date date,
  reminder_kind text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  local_day date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if local_day < date '2026-10-23'
    or (now() at time zone 'America/Sao_Paulo')::time < time '09:00'
    or (now() at time zone 'America/Sao_Paulo')::time >= time '19:00'
  then
    return;
  end if;

  return query
  with candidates as (
    select notice.id
    from private.tuition_email_reminders notice
    join public.monthly_tuition tuition on tuition.id = notice.tuition_id
    join public.profiles student on student.id = notice.student_id
    where notice.status in ('pending', 'failed')
      and notice.attempts < 3
      and (notice.last_attempt_at is null
        or notice.last_attempt_at <= now() - interval '10 minutes')
      and (notice.created_at at time zone 'America/Sao_Paulo')::date = local_day
      and notice.due_date = tuition.due_date
      and notice.student_id = tuition.student_id
      and tuition.payment_date is null
      and coalesce(tuition.is_exempt, false) = false
      and tuition.amount_due > 0
      and student.enrolled = true
      and student.archived = false
      and (
        (notice.reminder_kind = 'before_due' and notice.due_date = local_day + 2)
        or (notice.reminder_kind = 'due_today' and notice.due_date = local_day)
        or (notice.reminder_kind = 'after_due' and notice.due_date = local_day - 2)
      )
    order by notice.created_at, notice.id
    limit least(greatest(coalesce(target_limit, 20), 1), 20)
    for update of notice skip locked
  ),
  claimed as (
    update private.tuition_email_reminders notice
    set status = 'processing', attempts = notice.attempts + 1,
        last_attempt_at = now(), updated_at = now(), last_error = null
    from candidates
    where notice.id = candidates.id
    returning notice.id, notice.tuition_id, notice.student_id,
      notice.due_date, notice.reminder_kind
  )
  select claimed.id, claimed.tuition_id, claimed.student_id,
    claimed.due_date, claimed.reminder_kind
  from claimed;
end;
$function$;

-- Eligibility is checked again immediately before the Resend API call.
create or replace function public.is_tuition_email_reminder_eligible_internal(target_reminder_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
select exists (
  select 1
  from private.tuition_email_reminders notice
  join public.monthly_tuition tuition on tuition.id = notice.tuition_id
  join public.profiles student on student.id = notice.student_id
  where notice.id = target_reminder_id
    and notice.status = 'processing'
    and tuition.student_id = notice.student_id
    and tuition.due_date = notice.due_date
    and tuition.payment_date is null
    and coalesce(tuition.is_exempt, false) = false
    and tuition.amount_due > 0
    and student.enrolled = true and student.archived = false
    and (notice.created_at at time zone 'America/Sao_Paulo')::date =
      (now() at time zone 'America/Sao_Paulo')::date
    and (
      (notice.reminder_kind = 'before_due' and notice.due_date = (now() at time zone 'America/Sao_Paulo')::date + 2)
      or (notice.reminder_kind = 'due_today' and notice.due_date = (now() at time zone 'America/Sao_Paulo')::date)
      or (notice.reminder_kind = 'after_due' and notice.due_date = (now() at time zone 'America/Sao_Paulo')::date - 2)
    )
);
$function$;

create or replace function public.finish_tuition_email_reminder_internal(
  target_reminder_id uuid,
  target_outcome text,
  target_provider_message_id text default null,
  target_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if target_outcome not in ('sent', 'failed', 'skipped') then
    raise exception 'Unsupported delivery outcome';
  end if;

  update private.tuition_email_reminders
  set status = target_outcome,
      sent_at = case when target_outcome = 'sent' then now() else null end,
      provider_message_id = case when target_outcome = 'sent'
        then left(coalesce(target_provider_message_id, ''), 120) else null end,
      last_error = case when target_outcome = 'sent' then null
        else left(coalesce(target_error, 'delivery_unavailable'), 180) end,
      updated_at = now()
  where id = target_reminder_id and status = 'processing';
  return found;
end;
$function$;

-- Service-only PostgREST RPCs; never grant these SECURITY DEFINER calls to students.
revoke all on function public.claim_tuition_email_reminders_internal(integer)
  from public, anon, authenticated;
revoke all on function public.is_tuition_email_reminder_eligible_internal(uuid)
  from public, anon, authenticated;
revoke all on function public.finish_tuition_email_reminder_internal(uuid,text,text,text)
  from public, anon, authenticated;
grant execute on function public.claim_tuition_email_reminders_internal(integer) to service_role;
grant execute on function public.is_tuition_email_reminder_eligible_internal(uuid) to service_role;
grant execute on function public.finish_tuition_email_reminder_internal(uuid,text,text,text) to service_role;

-- Dispatch from Cron through a Vault-held shared secret. No plaintext credentials in SQL.
create or replace function private.dispatch_tuition_email_reminders()
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  local_day date := (now() at time zone 'America/Sao_Paulo')::date;
  shared_secret text;
  request_id bigint;
begin
  if local_day < date '2026-10-23'
    or (now() at time zone 'America/Sao_Paulo')::time < time '09:00'
    or (now() at time zone 'America/Sao_Paulo')::time >= time '19:00'
  then
    return null;
  end if;

  -- Abandoned worker claims are safe to retry under the same Resend idempotency key.
  update private.tuition_email_reminders notice
  set status = 'failed', last_error = 'worker_timeout', updated_at = now()
  where notice.status = 'processing'
    and notice.attempts < 3
    and notice.last_attempt_at < now() - interval '10 minutes'
    and (notice.created_at at time zone 'America/Sao_Paulo')::date = local_day;

  -- Never send a reminder on a later day or after the underlying bill changes.
  update private.tuition_email_reminders notice
  set status = 'skipped', last_error = 'no_longer_eligible', updated_at = now()
  where notice.status in ('pending', 'failed')
    and (
      (notice.created_at at time zone 'America/Sao_Paulo')::date < local_day
      or not exists (
        select 1 from public.monthly_tuition tuition
        join public.profiles student on student.id = tuition.student_id
        where tuition.id = notice.tuition_id
          and tuition.student_id = notice.student_id
          and tuition.due_date = notice.due_date
          and tuition.payment_date is null
          and coalesce(tuition.is_exempt, false) = false
          and tuition.amount_due > 0
          and student.enrolled = true and student.archived = false
      )
    );

  if not exists (
    select 1 from private.tuition_email_reminders notice
    where notice.status in ('pending', 'failed') and notice.attempts < 3
      and (notice.created_at at time zone 'America/Sao_Paulo')::date = local_day
      and (notice.last_attempt_at is null
        or notice.last_attempt_at <= now() - interval '10 minutes')
  ) then
    return null;
  end if;

  select secret.decrypted_secret into shared_secret
  from vault.decrypted_secrets secret
  where secret.name = 'teacherflavius_notification_webhook_secret'
  limit 1;
  if nullif(shared_secret, '') is null then
    raise warning 'Tuition email dispatcher secret unavailable';
    return null;
  end if;

  select net.http_post(
    url := 'https://wnigzpvgsbpjdxvjzugt.supabase.co/functions/v1/notify-tuition-email-reminders',
    body := '{}'::jsonb,
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', shared_secret
    ),
    timeout_milliseconds := 10000
  ) into request_id;
  return request_id;
end;
$function$;
revoke all on function private.dispatch_tuition_email_reminders()
  from public, anon, authenticated;

-- The first invocation occurs at 09:00 in Sao Paulo, not during the deployment.
do $block$
begin
  perform cron.schedule(
    'tuition-email-enqueue-09h',
    '0 12 * * *',
    'select private.enqueue_daily_tuition_email_reminders();'
  );
  perform cron.schedule(
    'tuition-email-dispatch-5m',
    '*/5 * * * *',
    'select private.dispatch_tuition_email_reminders();'
  );
end;
$block$;
