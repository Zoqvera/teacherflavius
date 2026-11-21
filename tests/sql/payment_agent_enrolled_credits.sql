-- Disposable Supabase fixture only. Every synthetic record is rolled back.
\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '98000000-0000-4000-8000-000000000041', 'authenticated', 'authenticated', 'payment-credit-teacher@invalid.test', '', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '98000000-0000-4000-8000-000000000042', 'authenticated', 'authenticated', 'payment-credit-student@invalid.test', '', now(), now(), now());
insert into public.teacher_admins (user_id, email)
values ('98000000-0000-4000-8000-000000000041', 'payment-credit-teacher@invalid.test');
insert into public.profiles (id, name, email, enrolled, archived, class_type, tuition_first_due_date)
values ('98000000-0000-4000-8000-000000000042', 'Aluno fictício', 'payment-credit-student@invalid.test',
        true, false, 'QUINTETO', (now() at time zone 'America/Sao_Paulo')::date);

insert into public.student_billing_settings (student_id, monthly_fee, due_day, billing_start_month, active, classes_per_month, billing_plan_id)
select '98000000-0000-4000-8000-000000000042', 50,
       extract(day from (now() at time zone 'America/Sao_Paulo'))::smallint,
       date_trunc('month', now() at time zone 'America/Sao_Paulo')::date,
       true, 4, id from private.billing_plans where code = 'standard_50_4'
on conflict (student_id) do update set monthly_fee=excluded.monthly_fee, due_day=excluded.due_day,
  billing_start_month=excluded.billing_start_month, active=true, classes_per_month=4, billing_plan_id=excluded.billing_plan_id;

select set_config('payment_fixture.tuition_id',
  private.ensure_first_tuition_for_student('98000000-0000-4000-8000-000000000042', (now() at time zone 'America/Sao_Paulo')::date)::text, true);
set local role teacher_payment_agent;
select set_config('request.jwt.claims', '{"sub":"98000000-0000-4000-8000-000000000041","role":"teacher_payment_agent"}', true);
select set_config('request.jwt.claim.sub', '98000000-0000-4000-8000-000000000041', true);
select public.record_tuition_payment(current_setting('payment_fixture.tuition_id')::uuid,
  (now() at time zone 'America/Sao_Paulo')::date, 50, 'pix', null);
reset role;

do $$
declare tuition uuid := current_setting('payment_fixture.tuition_id')::uuid;
begin
  if (select count(*) from private.lesson_credits where tuition_id=tuition and student_id='98000000-0000-4000-8000-000000000042' and credit_origin='contract' and revoked_at is null) <> 4 then
    raise exception 'Expected four active contracted lesson credits for the enrolled student';
  end if;
  if not exists (select 1 from public.monthly_tuition_events where tuition_id=tuition and action='payment_recorded' and actor_id='98000000-0000-4000-8000-000000000041') then
    raise exception 'Expected a payment audit event identifying the teacher';
  end if;
end;
$$;
rollback;
