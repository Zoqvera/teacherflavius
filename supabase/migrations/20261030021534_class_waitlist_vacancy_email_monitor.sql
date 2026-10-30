-- A waitlist never reserves seats. Monitor increasing free capacity and notify the teacher.
create table private.class_waitlist_availability_states (
 class_number integer primary key references public.teacher_classes(class_number) on delete cascade,
 available_spots integer not null default 0 check (available_spots>=0),
 event_number bigint not null default 0 check (event_number>=0),
 updated_at timestamptz not null default now()
);
create table private.class_waitlist_vacancy_emails (
 id uuid primary key default gen_random_uuid(),
 class_number integer not null references public.teacher_classes(class_number),
 event_number bigint not null,
 available_spots integer not null check (available_spots>0),
 applicants jsonb not null check (jsonb_typeof(applicants)='array'),
 status text not null default 'pending'
   check (status in ('pending','processing','failed','sent')),
 attempts integer not null default 0 check (attempts>=0),
 claimed_at timestamptz,
 sent_at timestamptz,
 provider_message_id text,
 last_error text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(class_number,event_number)
);
create index class_waitlist_vacancy_emails_delivery_idx
 on private.class_waitlist_vacancy_emails(status,attempts,created_at);
alter table private.class_waitlist_availability_states enable row level security;
alter table private.class_waitlist_vacancy_emails enable row level security;
revoke all on private.class_waitlist_availability_states from public,anon,authenticated;
revoke all on private.class_waitlist_vacancy_emails from public,anon,authenticated;

create function private.scan_class_waitlist_vacancies()
returns integer language plpgsql security definer set search_path='' as $$
declare
 slot record;
 previous private.class_waitlist_availability_states%rowtype;
 names_and_phones jsonb;
 enqueued integer:=0;
 waiting_exists boolean;
begin
 for slot in select class_number,available_spots
             from public.get_public_class_seat_availability()
 loop
  waiting_exists:=exists(
    select 1 from private.class_seat_waitlist w
    where w.class_number=slot.class_number and w.status='waiting'
      and private.normalize_trial_phone(w.whatsapp) is not null
  );
  insert into private.class_waitlist_availability_states(class_number,available_spots)
  values (slot.class_number,case when waiting_exists then 0 else slot.available_spots end)
  on conflict(class_number) do nothing;
  select * into previous from private.class_waitlist_availability_states
  where class_number=slot.class_number for update;
  if waiting_exists and slot.available_spots>previous.available_spots then
    select coalesce(jsonb_agg(jsonb_build_object(
        'name',left(btrim(w.applicant_name),120),
        'whatsapp',private.normalize_trial_phone(w.whatsapp)
      ) order by w.created_at),'[]'::jsonb)
    into names_and_phones
    from private.class_seat_waitlist w
    where w.class_number=slot.class_number and w.status='waiting'
      and private.normalize_trial_phone(w.whatsapp) is not null;
    if jsonb_array_length(names_and_phones)>0 then
      insert into private.class_waitlist_vacancy_emails
        (class_number,event_number,available_spots,applicants)
      values (slot.class_number,previous.event_number+1,slot.available_spots,names_and_phones)
      on conflict(class_number,event_number) do nothing;
      enqueued:=enqueued+1;
      previous.event_number:=previous.event_number+1;
    end if;
  end if;
  update private.class_waitlist_availability_states
  set available_spots=slot.available_spots,
      event_number=previous.event_number,updated_at=now()
  where class_number=slot.class_number;
 end loop;
 return enqueued;
end;
$$;
revoke all on function private.scan_class_waitlist_vacancies()
 from public,anon,authenticated;

create function public.claim_class_waitlist_vacancy_emails_internal(target_limit integer default 10)
returns table(notification_id uuid,class_number integer,class_weekday smallint,
 class_start_time time without time zone,available_spots integer,applicants jsonb)
language plpgsql security definer set search_path='' as $$
begin
 return query
 with claimable as (
   select n.id from private.class_waitlist_vacancy_emails n
   where n.attempts<5
     and ((n.status in ('pending','failed')
            and (n.claimed_at is null or n.claimed_at<now()-interval '2 minutes'))
       or (n.status='processing' and n.claimed_at<now()-interval '10 minutes'))
   order by n.created_at
   for update skip locked
   limit least(greatest(coalesce(target_limit,10),1),20)
 ), updated as (
   update private.class_waitlist_vacancy_emails n
   set status='processing',attempts=n.attempts+1,claimed_at=now(),updated_at=now()
   from claimable c where n.id=c.id
   returning n.id,n.class_number,n.available_spots,n.applicants
 )
 select u.id,u.class_number,tc.class_weekday,tc.class_start_time,
        u.available_spots,u.applicants
 from updated u
 join public.teacher_classes tc on tc.class_number=u.class_number;
end;
$$;
revoke all on function public.claim_class_waitlist_vacancy_emails_internal(integer)
 from public,anon,authenticated;
grant execute on function public.claim_class_waitlist_vacancy_emails_internal(integer)
 to service_role;

create function public.finish_class_waitlist_vacancy_email_internal(
 target_notification_id uuid,target_outcome text,
 target_provider_message_id text default null,target_error text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
 if target_outcome not in ('sent','failed') then
   raise exception 'Invalid notification outcome' using errcode='22023';
 end if;
 update private.class_waitlist_vacancy_emails n
 set status=target_outcome,updated_at=now(),
     sent_at=case when target_outcome='sent' then now() else null end,
     provider_message_id=case when target_outcome='sent'
         then nullif(left(target_provider_message_id,160),'') else null end,
     last_error=case when target_outcome='failed' then left(coalesce(target_error,'unknown'),160) else null end
 where n.id=target_notification_id and n.status='processing';
 get diagnostics affected=row_count;
 return affected=1;
end;
$$;
revoke all on function public.finish_class_waitlist_vacancy_email_internal(uuid,text,text,text)
 from public,anon,authenticated;
grant execute on function public.finish_class_waitlist_vacancy_email_internal(uuid,text,text,text)
 to service_role;

create function private.dispatch_class_waitlist_vacancy_emails()
returns bigint language plpgsql security definer set search_path='' as $$
declare shared_secret text; request_id bigint;
begin
 if not exists(
   select 1 from private.class_waitlist_vacancy_emails n
   where n.attempts<5
     and ((n.status in ('pending','failed')
            and (n.claimed_at is null or n.claimed_at<now()-interval '2 minutes'))
       or (n.status='processing' and n.claimed_at<now()-interval '10 minutes'))
 ) then return null; end if;
 select secret.decrypted_secret into shared_secret
 from vault.decrypted_secrets secret
 where secret.name='teacherflavius_notification_webhook_secret' limit 1;
 if nullif(shared_secret,'') is null then
   raise warning 'Waitlist notification secret missing';
   return null;
 end if;
 select net.http_post(
  url:='https://wnigzpvgsbpjdxvjzugt.supabase.co/functions/v1/notify-class-waitlist-vacancies',
  body:='{}'::jsonb,headers:=jsonb_build_object(
   'Content-Type','application/json','x-webhook-secret',shared_secret),
  timeout_milliseconds:=10000
 ) into request_id;
 return request_id;
end;
$$;
revoke all on function private.dispatch_class_waitlist_vacancy_emails()
 from public,anon,authenticated;

create function private.run_class_waitlist_vacancy_monitor()
returns bigint language plpgsql security definer set search_path='' as $$
begin
 perform private.scan_class_waitlist_vacancies();
 return private.dispatch_class_waitlist_vacancy_emails();
end;
$$;
revoke all on function private.run_class_waitlist_vacancy_monitor()
 from public,anon,authenticated;
