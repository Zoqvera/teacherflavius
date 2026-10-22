-- Read-only audit history with exception-only Resend notification.
-- 02:00 GMT = 23:00 in America/Sao_Paulo (previous calendar day).
create table private.lesson_credit_integrity_runs (
 id uuid primary key default gen_random_uuid(),
 audit_date date not null unique,
 executed_at timestamptz not null default now(),
 issue_count integer not null check (issue_count >= 0),
 issues jsonb not null default '[]'::jsonb check (jsonb_typeof(issues) = 'array'),
 email_status text not null check (email_status in ('not_required','pending','sending','sent','failed')),
 attempts integer not null default 0 check(attempts between 0 and 3),
 dispatch_count integer not null default 0 check (dispatch_count >= 0),
 last_attempt_at timestamptz,
 last_dispatch_at timestamptz,
 sent_at timestamptz,
 provider_message_id text,
 last_error text,
 updated_at timestamptz not null default now(),
 constraint integrity_email_required_check check (
  (issue_count=0 and email_status='not_required')
  or (issue_count>0 and email_status<>'not_required')
 )
);
create index lesson_credit_integrity_runs_recent_idx
on private.lesson_credit_integrity_runs(executed_at desc);
alter table private.lesson_credit_integrity_runs enable row level security;
revoke all on table private.lesson_credit_integrity_runs from public,anon,authenticated;

create or replace function private.dispatch_lesson_credit_integrity_email(target_run_id uuid)
returns boolean language plpgsql security definer set search_path='' as $function$
declare webhook_secret text; run_id uuid;
begin
 select decrypted_secret into webhook_secret
 from vault.decrypted_secrets
 where name='teacherflavius_notification_webhook_secret' limit 1;
 if nullif(webhook_secret,'') is null then
  update private.lesson_credit_integrity_runs
  set email_status='failed',last_error='notification_webhook_secret_missing',updated_at=now()
  where id=target_run_id and issue_count>0 and email_status<>'sent';
  return false;
 end if;
 update private.lesson_credit_integrity_runs
 set dispatch_count=dispatch_count+1,last_dispatch_at=now(),updated_at=now()
 where id=target_run_id and issue_count>0
 and attempts<3 and dispatch_count<10
 and (email_status in ('pending','failed')
    or (email_status='sending' and last_attempt_at < now()-interval '15 minutes'))
 and (last_dispatch_at is null or last_dispatch_at < now()-interval '10 minutes')
 returning id into run_id;
 if run_id is null then return false; end if;
 perform net.http_post(
  url:='https://wnigzpvgsbpjdxvjzugt.supabase.co/functions/v1/notify-lesson-credit-integrity',
  body:=jsonb_build_object('type','lesson_credit_integrity_alert','run_id',run_id),
  params:='{}'::jsonb,
  headers:=jsonb_build_object('Content-Type','application/json','x-webhook-secret',webhook_secret),
  timeout_milliseconds:=10000
 );
 return true;
exception when others then
 update private.lesson_credit_integrity_runs
 set email_status='failed',last_error=left(sqlerrm,400),updated_at=now()
 where id=target_run_id and email_status<>'sent';
 return false;
end;
$function$;

create or replace function private.run_daily_lesson_credit_integrity()
returns jsonb language plpgsql security definer set search_path='' as $function$
declare
 local_date date:=(now() at time zone 'America/Sao_Paulo')::date;
 report jsonb;
 total integer;
 run_id uuid;
 current_run record;
begin
 perform pg_advisory_xact_lock(hashtextextended('daily_lesson_credit_integrity:'||local_date::text,0));
 select count(*)::integer,
   coalesce(jsonb_agg(jsonb_build_object(
      'issue_code',problem.issue_code,
      'student_id',problem.student_id,
      'student_name',coalesce(student.name,'Cadastro sem nome'),
      'tuition_id',problem.tuition_id,
      'credit_id',problem.credit_id,
      'starts_at',problem.starts_at
    ) order by student.name,problem.issue_code,problem.credit_id),'[]'::jsonb)
 into total,report
 from private.audit_paid_lesson_schedule_integrity() problem
 left join public.profiles student on student.id=problem.student_id;
 insert into private.lesson_credit_integrity_runs(audit_date,issue_count,issues,email_status)
 values(local_date,total,report,case when total=0 then 'not_required' else 'pending' end)
 on conflict(audit_date) do nothing returning id into run_id;
 if run_id is not null and total>0 then
   perform private.dispatch_lesson_credit_integrity_email(run_id);
 end if;
 select id,audit_date,issue_count,email_status,executed_at into current_run
 from private.lesson_credit_integrity_runs where audit_date=local_date;
 return jsonb_build_object(
   'run_id',current_run.id,'audit_date',current_run.audit_date,
   'issue_count',current_run.issue_count,'email_status',current_run.email_status,
   'executed_at',current_run.executed_at
 );
end;
$function$;

-- Restricted PostgREST wrappers: browser roles cannot claim alerts or see private data.
create or replace function public.claim_lesson_credit_integrity_email_internal(target_run_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare claimed record;
begin
 update private.lesson_credit_integrity_runs
 set email_status='sending',attempts=attempts+1,last_attempt_at=now(),
     last_error=null,updated_at=now()
 where id=target_run_id and issue_count>0 and attempts<3
 and (email_status in ('pending','failed') or
     (email_status='sending' and last_attempt_at<now()-interval '15 minutes'))
 and (last_attempt_at is null or last_attempt_at < now()-interval '10 minutes')
 returning * into claimed;
 if not found then return null; end if;
 return jsonb_build_object(
  'run_id',claimed.id,'audit_date',claimed.audit_date,
  'issue_count',claimed.issue_count,'issues',claimed.issues
 );
end;
$function$;

create or replace function public.finish_lesson_credit_integrity_email_internal(
 target_run_id uuid,target_status text,target_error text default null,
 target_provider_message_id text default null)
returns boolean language plpgsql security definer set search_path='' as $function$
begin
 if target_status not in ('sent','failed') then raise exception 'Invalid email status'; end if;
 update private.lesson_credit_integrity_runs
 set email_status=target_status,
  sent_at=case when target_status='sent' then now() else sent_at end,
  provider_message_id=case when target_status='sent' then left(target_provider_message_id,200)
    else provider_message_id end,
  last_error=case when target_status='failed'
    then left(coalesce(target_error,'unknown_delivery_error'),500) else null end,
  updated_at=now()
 where id=target_run_id and email_status='sending';
 return found;
end;
$function$;

create or replace function private.retry_lesson_credit_integrity_emails()
returns integer language plpgsql security definer set search_path='' as $function$
declare due_run record; queued integer:=0;
begin
 for due_run in
  select id from private.lesson_credit_integrity_runs
  where issue_count>0 and attempts<3 and dispatch_count<10
  and executed_at >= now()-interval '18 hours'
  and (email_status in ('pending','failed')
      or (email_status='sending' and last_attempt_at < now()-interval '15 minutes'))
  and (last_dispatch_at is null or last_dispatch_at < now()-interval '10 minutes')
  order by executed_at limit 10 for update skip locked
 loop
  if private.dispatch_lesson_credit_integrity_email(due_run.id) then
    queued:=queued+1;
  end if;
 end loop;
 return queued;
end;
$function$;

revoke all on function private.dispatch_lesson_credit_integrity_email(uuid) from public,anon,authenticated;
revoke all on function private.run_daily_lesson_credit_integrity() from public,anon,authenticated;
revoke all on function private.retry_lesson_credit_integrity_emails() from public,anon,authenticated;
revoke all on function public.claim_lesson_credit_integrity_email_internal(uuid) from public,anon,authenticated;
revoke all on function public.finish_lesson_credit_integrity_email_internal(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_lesson_credit_integrity_email_internal(uuid) to service_role;
grant execute on function public.finish_lesson_credit_integrity_email_internal(uuid,text,text,text) to service_role;

select cron.schedule(
 'daily-lesson-credit-integrity-23h','0 2 * * *',
 'select private.run_daily_lesson_credit_integrity();'
);
select cron.schedule(
 'retry-lesson-credit-integrity-email-15m','*/15 * * * *',
 'select private.retry_lesson_credit_integrity_emails();'
);
