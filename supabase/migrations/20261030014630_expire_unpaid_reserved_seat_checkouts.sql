-- Reserved-seat checkout gate; never affects existing students or transfers.
create table private.reserved_seat_payment_windows (
 hold_id uuid primary key references private.class_seat_holds(id),
 student_id uuid not null references public.profiles(id),
 tuition_id uuid not null unique references public.monthly_tuition(id),
 class_number integer not null,
 created_at timestamptz not null default now(),
 entered_at timestamptz,
 expires_at timestamptz,
 state text not null default 'awaiting_checkout' check (state in ('awaiting_checkout','awaiting_payment','confirmed','expired','late_payment')),
 released_at timestamptz,
 confirmed_at timestamptz,
 updated_at timestamptz not null default now(),
 constraint reserved_seat_exact_ten_minutes check ((entered_at is null and expires_at is null) or (entered_at is not null and expires_at=entered_at+interval '10 minutes'))
);
create index reserved_seat_window_by_student on private.reserved_seat_payment_windows(student_id);
create index reserved_seat_window_by_expiry on private.reserved_seat_payment_windows(state,expires_at);
alter table private.reserved_seat_payment_windows enable row level security;
revoke all on private.reserved_seat_payment_windows from public,anon,authenticated;

create function private.track_reserved_seat_payment_window()
returns trigger language plpgsql security definer set search_path='' as $$
declare selected_hold uuid; first_tuition uuid;
begin
 if new.user_id is null then return new; end if;
 select h.id into selected_hold
 from private.student_enrollment_access access
 join private.class_seat_holds h on h.id=access.reserved_seat_hold_id
 where access.user_id=new.user_id and h.student_id=new.user_id
 and h.class_number=new.class_number and h.status='claimed' limit 1;
 if selected_hold is null then return new; end if;
 select t.id into first_tuition
 from public.student_billing_settings b
 join public.monthly_tuition t on t.student_id=b.student_id and t.reference_month=b.billing_start_month
 where b.student_id=new.user_id and t.payment_date is null and not t.is_exempt
 order by t.created_at limit 1;
 if first_tuition is null then raise exception 'Cobrança não encontrada. Matrícula revertida.'; end if;
 insert into private.reserved_seat_payment_windows (hold_id,student_id,tuition_id,class_number)
 values (selected_hold,new.user_id,first_tuition,new.class_number) on conflict (hold_id) do nothing;
 return new;
end;
$$;
create trigger zzz_track_reserved_seat_payment_window after insert on public.class_students
 for each row execute function private.track_reserved_seat_payment_window();
revoke all on function private.track_reserved_seat_payment_window() from public,anon,authenticated;

create function public.start_my_reserved_seat_checkout()
returns jsonb language plpgsql security definer set search_path='' as $$
declare student uuid:=auth.uid(); w private.reserved_seat_payment_windows%rowtype;
begin
 if student is null then raise exception 'Faça login para pagar.' using errcode='42501'; end if;
 select * into w from private.reserved_seat_payment_windows
 where student_id=student order by created_at desc limit 1 for update;
 if not found then return jsonb_build_object('applicable',false); end if;
 if w.state='awaiting_checkout' and now()<w.created_at+interval '15 minutes' then
  update private.reserved_seat_payment_windows
  set state='awaiting_payment',entered_at=now(),expires_at=now()+interval '10 minutes',updated_at=now()
  where hold_id=w.hold_id returning * into w;
 end if;
 return jsonb_build_object('applicable',true,'state',case
  when w.state='awaiting_checkout' or (w.state='awaiting_payment' and w.expires_at<=now()) then 'expired'
  else w.state end,'expires_at',w.expires_at,'tuition_id',w.tuition_id,'class_number',w.class_number);
end;
$$;
revoke all on function public.start_my_reserved_seat_checkout() from public,anon,authenticated;
grant execute on function public.start_my_reserved_seat_checkout() to authenticated;

-- NULL: conventional invoice, TRUE: active 10-minute checkout, FALSE: blocked.
create function public.is_reserved_seat_checkout_allowed(target_student_id uuid,target_tuition_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select case when exists (select 1 from private.reserved_seat_payment_windows w
 where w.student_id=target_student_id and w.tuition_id=target_tuition_id)
 then exists (select 1 from private.reserved_seat_payment_windows w
 where w.student_id=target_student_id and w.tuition_id=target_tuition_id
 and w.state='awaiting_payment' and w.expires_at>now())
 else null::boolean end;
$$;
revoke all on function public.is_reserved_seat_checkout_allowed(uuid,uuid) from public,anon,authenticated;
grant execute on function public.is_reserved_seat_checkout_allowed(uuid,uuid) to service_role;

-- Release within the next minute after deadline, even with the browser closed.
-- Paid after expiry never reacquires the seat; preserve the receipt for review.
create function private.expire_unpaid_reserved_seats()
returns integer language plpgsql security definer set search_path='' as $$
declare w record; paid_at timestamptz; released integer:=0;
begin
 for w in select a.*,t.payment_date,t.updated_at as tuition_updated_at
  from private.reserved_seat_payment_windows a join public.monthly_tuition t on t.id=a.tuition_id
  where (a.state='awaiting_checkout' and a.created_at+interval '15 minutes'<=now())
   or (a.state='awaiting_payment' and a.expires_at<=now())
   or (a.state='expired' and t.payment_date is not null)
  order by a.created_at limit 100 for update of a skip locked
 loop
  if w.state='expired' and w.payment_date is not null then
   update private.reserved_seat_payment_windows set state='late_payment',updated_at=now() where hold_id=w.hold_id;
   continue;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(73008,w.class_number);
  perform 1 from public.monthly_tuition where id=w.tuition_id for update;
  select t.payment_date,t.updated_at into w.payment_date,w.tuition_updated_at
  from public.monthly_tuition t where t.id=w.tuition_id;
  if w.payment_date is not null then
   select coalesce(min(a.applied_at),w.tuition_updated_at) into paid_at
   from public.tuition_payment_attempts a where a.tuition_id=w.tuition_id
    and a.applied_at is not null and a.reversed_at is null;
   if paid_at<=coalesce(w.expires_at,w.created_at+interval '15 minutes') then
    update private.reserved_seat_payment_windows set state='confirmed',confirmed_at=paid_at,updated_at=now()
    where hold_id=w.hold_id;
    continue;
   end if;
  end if;
  update public.profiles set archived=true,archived_at=coalesce(archived_at,now())
  where id=w.student_id and not archived;
  update private.reserved_seat_payment_windows
  set state=case when w.payment_date is not null then 'late_payment' else 'expired' end,
   released_at=now(),updated_at=now() where hold_id=w.hold_id;
  released:=released+1;
 end loop;
 return released;
end;
$$;
revoke all on function private.expire_unpaid_reserved_seats() from public,anon,authenticated;
select cron.schedule('reserved-seat-first-payment-expiration','* * * * *',
 'select private.expire_unpaid_reserved_seats();');
