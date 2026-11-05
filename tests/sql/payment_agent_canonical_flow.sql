-- Disposable canonical fixture only. The transaction is always rolled back.
-- Tuition is deliberately detached: this verifies audit and payment triggers,
-- but does not verify lesson-credit generation for an enrolled student.
\set ON_ERROR_STOP on
begin;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '98000000-0000-4000-8000-000000000031',
        'authenticated', 'authenticated', 'payment-agent-teacher@invalid.test', '', now(), now(), now());
insert into public.teacher_admins (user_id, email)
values ('98000000-0000-4000-8000-000000000031', 'payment-agent-teacher@invalid.test');
insert into public.monthly_tuition (id, student_id, subject_ref, reference_month, due_date, amount_due)
values ('98000000-0000-4000-8000-000000000032', null,
        '98000000-0000-4000-8000-000000000033', '2026-11-01', '2026-11-04', 50);

set local role teacher_payment_agent;
select set_config('request.jwt.claims', '{"sub":"98000000-0000-4000-8000-000000000031","role":"teacher_payment_agent"}', true);
select set_config('request.jwt.claim.sub', '98000000-0000-4000-8000-000000000031', true);
select public.record_tuition_payment('98000000-0000-4000-8000-000000000032', '2026-11-04', 50, 'pix', null);
do $$
begin
  begin
    perform public.record_tuition_payment('98000000-0000-4000-8000-000000000032', '2026-11-04', 50, 'pix', null);
    raise exception 'Duplicate payment was accepted';
  exception when others then
    if sqlerrm not like '%já está paga%' then raise; end if;
  end;
end;
$$;
reset role;
do $$
begin
  if not exists (
    select 1 from public.monthly_tuition m join public.monthly_tuition_events e on e.tuition_id = m.id
    where m.id = '98000000-0000-4000-8000-000000000032' and m.payment_date = '2026-11-04'
      and m.amount_paid = 50 and m.payment_method = 'pix'
      and m.updated_by = '98000000-0000-4000-8000-000000000031'
      and e.actor_id = m.updated_by and e.action = 'payment_recorded'
  ) then raise exception 'Canonical payment or audit record did not match'; end if;
  if (select count(*) from public.monthly_tuition_events where tuition_id = '98000000-0000-4000-8000-000000000032' and action = 'payment_recorded') <> 1 then
    raise exception 'Expected one payment audit event';
  end if;
end;
$$;
rollback;
