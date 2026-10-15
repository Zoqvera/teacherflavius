-- Executed only against the disposable Supabase/Postgres instance in GitHub Actions.
-- No production data, outbound webhook requests, or permanent fixtures are used.
\set ON_ERROR_STOP on
begin;

-- The test checks the real transactional outbox and RPC, not external delivery.
alter table public.regular_lesson_cancellation_email_notifications
  disable trigger dispatch_regular_lesson_cancellation_email;

insert into auth.users (
  id, instance_id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, created_at, updated_at
) values (
  '12000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'fixture-student@example.test', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, now(), now()
);

insert into public.profiles (id, name, email, enrolled, class_type)
values (
  '12000000-0000-4000-8000-000000000001',
  'HOMOLOGACAO REGULAR - ALUNO FICTICIO',
  'fixture-student@example.test', false, 'QUINTETO'
);

insert into public.teacher_classes (class_number, class_name, class_type)
values (909001, 'HOMOLOGACAO REGULAR - TURMA FICTICIA', 'QUINTETO');

-- Tuition exists only to satisfy the credit's foreign-key relationship.
-- It is unpaid, unattached to a real student profile, and rolled back.
insert into public.monthly_tuition (
  id, student_id, subject_ref, reference_month, due_date, amount_due
) values
  ('12000000-0000-4000-8000-000000000101', null,
   '12000000-0000-4000-8000-000000000001',
   '2026-11-01', '2026-11-10', 99.90),
  ('12000000-0000-4000-8000-000000000102', null,
   '12000000-0000-4000-8000-000000000001',
   '2026-12-01', '2026-12-10', 99.90),
  ('12000000-0000-4000-8000-000000000103', null,
   '12000000-0000-4000-8000-000000000001',
   '2027-01-01', '2027-01-10', 99.90);

insert into private.lesson_credits (
  id, student_id, tuition_id, reference_month, credit_number, status,
  regular_class_number, regular_class_name, regular_starts_at, regular_ends_at
) values
  ('12000000-0000-4000-8000-000000000201',
   '12000000-0000-4000-8000-000000000001',
   '12000000-0000-4000-8000-000000000101', '2026-11-01', 1, 'scheduled',
   909001, 'TURMA FICTICIA', now() + interval '24 hours',
   now() + interval '25 hours'),
  ('12000000-0000-4000-8000-000000000202',
   '12000000-0000-4000-8000-000000000001',
   '12000000-0000-4000-8000-000000000102', '2026-12-01', 1, 'scheduled',
   909001, 'TURMA FICTICIA', now() + interval '6 hours',
   now() + interval '7 hours'),
  ('12000000-0000-4000-8000-000000000203',
   '12000000-0000-4000-8000-000000000001',
   '12000000-0000-4000-8000-000000000103', '2027-01-01', 1, 'scheduled',
   909001, 'TURMA FICTICIA', now() - interval '1 hour',
   now() - interval '1 hour' + interval '1 minute');

-- Simulates an authenticated student session strictly inside this transaction.
select set_config('request.jwt.claim.sub',
  '12000000-0000-4000-8000-000000000001', true);

do $regular_homologation$
declare
  early_result jsonb;
  late_result jsonb;
  notice record;
begin
  early_result := public.cancel_my_regular_lesson(
    '12000000-0000-4000-8000-000000000201'
  );
  if early_result->>'status' <> 'available'
    or (early_result->>'credit_granted')::boolean is distinct from true then
    raise exception 'Early regular cancellation did not release a credit: %', early_result;
  end if;

  late_result := public.cancel_my_regular_lesson(
    '12000000-0000-4000-8000-000000000202'
  );
  if late_result->>'status' <> 'forfeited'
    or (late_result->>'credit_granted')::boolean is distinct from false then
    raise exception 'Late regular cancellation incorrectly granted credit: %', late_result;
  end if;

  begin
    perform public.cancel_my_regular_lesson(
      '12000000-0000-4000-8000-000000000203'
    );
    raise exception 'A lesson already started was incorrectly cancellable';
  exception
    when others then
      if sqlerrm = 'A lesson already started was incorrectly cancellable' then
        raise;
      end if;
      if sqlerrm not like '%já começou%' then
        raise exception 'Unexpected started-lesson error: %', sqlerrm;
      end if;
  end;

  if (select count(*) from private.student_regular_lesson_cancellations
      where student_id='12000000-0000-4000-8000-000000000001') <> 2 then
    raise exception 'Cancellation audit entries do not match two valid cancellations';
  end if;

  if (select count(*) from public.regular_lesson_cancellation_email_notifications
      where student_id='12000000-0000-4000-8000-000000000001') <> 4 then
    raise exception 'Expected exactly two notifications for each valid cancellation';
  end if;

  for notice in
    select credit_id, credit_granted, recipient_type, status
    from public.regular_lesson_cancellation_email_notifications
    where student_id='12000000-0000-4000-8000-000000000001'
  loop
    if notice.status <> 'pending'
      or notice.recipient_type not in ('student', 'teacher')
      or notice.credit_granted is distinct from
        (notice.credit_id='12000000-0000-4000-8000-000000000201'::uuid) then
      raise exception 'Outbox mismatches cancellation/credit outcome';
    end if;
  end loop;

  if (select count(distinct recipient_type)
      from public.regular_lesson_cancellation_email_notifications
      where credit_id='12000000-0000-4000-8000-000000000201') <> 2
    or (select count(distinct recipient_type)
      from public.regular_lesson_cancellation_email_notifications
      where credit_id='12000000-0000-4000-8000-000000000202') <> 2 then
    raise exception 'Student and teacher notifications are not both present';
  end if;

  if (select status from private.lesson_credits
      where id='12000000-0000-4000-8000-000000000203') <> 'scheduled' then
    raise exception 'Started lesson credit was changed';
  end if;
end
$regular_homologation$;

rollback;
