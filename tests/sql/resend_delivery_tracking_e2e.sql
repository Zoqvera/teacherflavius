-- This file runs ONLY inside a disposable CI PostgreSQL transaction.
-- The workflow provides BEGIN and ROLLBACK, and no transport is invoked.
\set ON_ERROR_STOP on

-- Disable the pre-existing HTTP dispatcher in this transaction.
alter table public.enrollment_email_notifications disable trigger user;

do $resend_cases$
declare
  fake_student constant uuid := '89000000-0000-4000-8000-000000000001';
  fake_notice constant uuid := '89000000-0000-4000-8000-000000000002';
  student_provider constant text := 'resend_fixture_student_01';
  teacher_provider constant text := 'resend_fixture_teacher_01';
  event_date constant timestamptz := '2026-10-15 19:20:00+00';
  blocked boolean;
begin
  if has_function_privilege('anon',
       'public.record_resend_message_acceptance(text,uuid,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated',
       'public.record_resend_message_acceptance(text,uuid,text,text)', 'EXECUTE')
     or has_function_privilege('anon',
       'public.record_resend_delivery_event(text,text,text,timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated',
       'public.record_resend_delivery_event(text,text,text,timestamptz)', 'EXECUTE')
  then
    raise exception 'Resend RPCs must remain unavailable to browser roles';
  end if;

  if has_table_privilege('anon', 'private.resend_delivery_messages', 'SELECT')
     or has_table_privilege('authenticated',
       'private.resend_delivery_messages', 'SELECT')
     or has_table_privilege('anon', 'private.resend_delivery_events', 'SELECT')
     or has_table_privilege('authenticated',
       'private.resend_delivery_events', 'SELECT')
  then
    raise exception 'Delivery evidence must remain private';
  end if;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at
  ) values (
    fake_student, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'resend-fixture@example.invalid',
    'not-a-password', now(), now(), now()
  );

  insert into public.profiles (id, name, enrolled, archived)
  values (fake_student, 'Fixture Resend', true, false);

  insert into public.enrollment_email_notifications (
    id, student_id, status, attempts, created_at, updated_at
  ) values (
    fake_notice, fake_student, 'pending', 0, now(), now()
  );

  -- Event before acceptance: timeline must reconcile when message is linked.
  if not public.record_resend_delivery_event(
     'msg_resend_fixture_01', student_provider,
     'email.delivered', event_date
  ) then
    raise exception 'Initial valid event must be stored';
  end if;

  if not public.record_resend_message_acceptance(
    'enrollment', fake_notice, 'student', student_provider
  ) then
    raise exception 'Student message acceptance failed';
  end if;

  if (select delivery_status from private.resend_delivery_messages
      where provider_email_id = student_provider) <> 'delivered' then
    raise exception 'Out-of-order acceptance did not reconcile delivery';
  end if;

  if not public.record_resend_message_acceptance(
    'enrollment', fake_notice, 'teacher', teacher_provider
  ) then
    raise exception 'Teacher message acceptance failed';
  end if;

  if (select count(*) from private.resend_delivery_messages
      where notification_id = fake_notice) <> 2 then
    raise exception 'Student and teacher must have independent identities';
  end if;

  -- Older delayed event arriving later must not erase delivered evidence.
  perform public.record_resend_delivery_event(
    'msg_resend_fixture_02', student_provider,
    'email.delivery_delayed', event_date - interval '10 minutes'
  );

  if (select delivery_status from private.resend_delivery_messages
      where provider_email_id = student_provider) <> 'delivered' then
    raise exception 'Delayed replay regressed delivery state';
  end if;

  if not public.record_resend_delivery_event(
    'msg_resend_fixture_03', student_provider,
    'email.bounced', event_date + interval '2 minutes'
  ) then
    raise exception 'Later bounce was not persisted';
  end if;

  if (select delivery_status from private.resend_delivery_messages
      where provider_email_id = student_provider) <> 'bounced' then
    raise exception 'Later bounce must supersede delivery';
  end if;

  if public.record_resend_delivery_event(
    'msg_resend_fixture_03', student_provider,
    'email.bounced', event_date + interval '2 minutes'
  ) then
    raise exception 'Replay must be idempotent';
  end if;

  blocked := false;
  begin
    perform public.record_resend_delivery_event(
      'msg_resend_fixture_03', teacher_provider,
      'email.delivered', event_date
    );
  exception when others then blocked := true;
  end;
  if not blocked then
    raise exception 'Conflicting event reuse must fail closed';
  end if;

  blocked := false;
  begin
    perform public.record_resend_message_acceptance(
      'enrollment', fake_notice, 'student', 'resend_incorrect_provider_02'
    );
  exception when others then blocked := true;
  end;
  if not blocked then
    raise exception 'Provider identity cannot be silently replaced';
  end if;

  blocked := false;
  begin
    perform public.record_resend_message_acceptance(
      'enrollment', '89000000-0000-4000-8000-000000000099',
      'student', 'resend_orphan_provider_01'
    );
  exception when others then blocked := true;
  end;
  if not blocked then
    raise exception 'Unrecognized notification cannot be linked';
  end if;
end;
$resend_cases$;
