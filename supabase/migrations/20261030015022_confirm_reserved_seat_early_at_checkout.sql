CREATE OR REPLACE FUNCTION public.start_my_reserved_seat_checkout()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare student uuid:=auth.uid(); w private.reserved_seat_payment_windows%rowtype;
begin
 if student is null then raise exception 'Faça login para pagar.' using errcode='42501'; end if;
 select * into w from private.reserved_seat_payment_windows
 where student_id=student order by created_at desc limit 1 for update;
 if not found then return jsonb_build_object('applicable',false); end if;
 -- A confirmed invoice must never retain a browser expiry banner.
 if exists(select 1 from public.monthly_tuition tuition
           where tuition.id=w.tuition_id and tuition.payment_date is not null) then
   declare
     settled_at timestamptz;
   begin
     select coalesce(min(attempt.applied_at),max(tuition.updated_at))
       into settled_at
     from public.monthly_tuition tuition
     left join public.tuition_payment_attempts attempt
       on attempt.tuition_id=tuition.id and attempt.applied_at is not null
          and attempt.reversed_at is null
     where tuition.id=w.tuition_id;
     if settled_at<=coalesce(w.expires_at,w.created_at+interval '15 minutes') then
       update private.reserved_seat_payment_windows
       set state='confirmed',confirmed_at=settled_at,updated_at=now()
       where hold_id=w.hold_id returning * into w;
     end if;
   end;
 end if;
 if w.state='awaiting_checkout' and now()<w.created_at+interval '15 minutes' then
  update private.reserved_seat_payment_windows
  set state='awaiting_payment',entered_at=now(),expires_at=now()+interval '10 minutes',updated_at=now()
  where hold_id=w.hold_id returning * into w;
 end if;
 return jsonb_build_object('applicable',true,'state',case
  when w.state='awaiting_checkout' or (w.state='awaiting_payment' and w.expires_at<=now()) then 'expired'
  else w.state end,'expires_at',w.expires_at,'tuition_id',w.tuition_id,'class_number',w.class_number);
end;
$function$;
