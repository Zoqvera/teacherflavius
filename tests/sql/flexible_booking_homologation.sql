-- Run against a populated database inside a rollback-only transaction.
-- pg_net dispatches only on commit; this test never sends emails.
begin;
do $test$
declare fixture record; result jsonb; booking uuid; previous_used integer;
begin
  select c.id as credit_id,c.student_id,o.class_number,o.starts_at into fixture
  from private.lesson_credits c
  join public.profiles p on p.id=c.student_id and p.enrolled and not p.archived
  join public.monthly_tuition t on t.id=c.tuition_id
  cross join private.flexible_occurrences() o
  where c.credit_origin='contract' and c.revoked_at is null
    and c.status in ('scheduled','available') and c.makeup_booking_id is null
    and c.cancelled_at is null and (t.payment_date is not null or t.is_exempt)
    and private.get_tuition_coverage_start(t.id)<=(o.starts_at at time zone 'America/Sao_Paulo')::date
    and (o.starts_at at time zone 'America/Sao_Paulo')::date<private.get_tuition_coverage_end(t.id)
    and not exists(select 1 from public.class_students m where m.user_id=c.student_id and m.class_number=o.class_number)
  order by o.starts_at limit 1;
  if fixture.credit_id is null then raise exception 'No suitable paid fixture available'; end if;
  insert into private.flexible_students(student_id,enabled) values(fixture.student_id,true)
    on conflict(student_id) do update set enabled=true;
  update private.lesson_credits set status='available',regular_class_number=null,
    regular_class_name=null,regular_starts_at=null,regular_ends_at=null where id=fixture.credit_id;
  perform set_config('request.jwt.claim.sub',fixture.student_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',fixture.student_id,'role','authenticated')::text,true);
  if private.student_replacement_target_type(fixture.student_id) is not null then
    raise exception 'FLEXIVEL acquired replacement eligibility';
  end if;
  result:=public.get_my_flexible_lessons();
  if result->>'booking_mode'<>'FLEXIVEL' or jsonb_array_length(result->'options')=0 then
    raise exception 'Missing flexible availability';
  end if;
  result:=public.book_my_flexible_lesson(fixture.class_number,fixture.starts_at);
  booking:=(result->>'booking_id')::uuid;
  if not exists(select 1 from public.makeup_class_bookings where id=booking
    and booking_kind='flexible' and booking_week=date_trunc('week',fixture.starts_at at time zone 'America/Sao_Paulo')::date) then
    raise exception 'Missing confirmed weekly booking';
  end if;
  if not exists(select 1 from private.lesson_credits where student_id=fixture.student_id
    and makeup_booking_id=booking and status='used') then raise exception 'Credit not consumed'; end if;
  if not exists(select 1 from public.makeup_class_email_notifications where booking_id=booking
    and notification_type='booking_confirmation') then raise exception 'Email not queued'; end if;
  begin
    perform public.book_my_flexible_lesson(fixture.class_number,fixture.starts_at);
    raise exception 'Duplicate weekly booking was accepted';
  exception when raise_exception then
    if sqlerrm <> 'Você já reservou uma aula nesta semana.' then raise; end if;
  end;
  begin
    perform public.cancel_my_makeup_class_booking(booking);
    raise exception 'Legacy student cancellation was accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.set_teacher_student_booking_mode(fixture.student_id,'FIXO');
    raise exception 'Student changed own modality';
  exception when insufficient_privilege then null; end;
  begin
    perform public.cancel_my_regular_lesson(fixture.credit_id);
    raise exception 'Flexible student cancelled regular lesson';
  exception when insufficient_privilege then null; end;
  if not exists(select 1 from public.makeup_class_bookings where id=booking and status='confirmed') then
    raise exception 'Definitive booking was changed';
  end if;
  -- Only the professor may release a definitive reservation, then rebooking is allowed.
  perform set_config('request.jwt.claim.sub',(select user_id::text from public.teacher_admins limit 1),true);
  update public.makeup_class_bookings set status='cancelled',cancelled_at=now() where id=booking;
  if not exists(select 1 from private.lesson_credits where id=(result->>'credit_id')::uuid
    and status='available' and makeup_booking_id is null) then
    raise exception 'Teacher cancellation did not restore flexible credit';
  end if;
  perform set_config('request.jwt.claim.sub',fixture.student_id::text,true);
  result:=public.book_my_flexible_lesson(fixture.class_number,fixture.starts_at);
  if not coalesce((result->>'ok')::boolean,false) then raise exception 'Rebooking failed'; end if;
end;
$test$;
rollback;
