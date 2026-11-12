\set ON_ERROR_STOP on
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create schema private;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create table public.profiles (id uuid primary key, enrolled_at timestamptz);
create table public.student_billing_settings (student_id uuid primary key, billing_start_month date);
create table public.monthly_tuition (
  id uuid primary key, student_id uuid, reference_month date,
  due_date date, created_at timestamptz, payment_date date
);

\ir ../../supabase/migrations/20261112145000_prepare_manual_first_tuition_policy.sql

insert into public.profiles values
  ('00000000-0000-4000-8000-000000000001', now() - interval '60 days'),
  ('00000000-0000-4000-8000-000000000002', now() - interval '11 days');
insert into public.student_billing_settings values
  ('00000000-0000-4000-8000-000000000001', '2026-09-01'),
  ('00000000-0000-4000-8000-000000000002', '2026-11-01');
insert into public.monthly_tuition values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '2026-09-01', '2026-09-12', now() - interval '60 days', current_date - 1),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', '2026-10-01', '2026-10-12', now() - interval '30 days', null),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002', '2026-11-01', '2026-11-12', now() - interval '11 days', null),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000002', '2026-12-01', '2026-12-12', now(), null);

do $$ begin
  if (public.get_enrollment_checkout_policy_context(array['10000000-0000-4000-8000-000000000003'::uuid])->>'enabled')::boolean then
    raise exception 'Policy must start disabled';
  end if;
  if has_function_privilege('authenticated', 'public.get_enrollment_checkout_policy_context(uuid[])', 'execute') then
    raise exception 'Context function must be service-only';
  end if;
end $$;

update private.enrollment_checkout_policy_settings set rollout_at = now() - interval '30 days';
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', false);
do $$
declare state jsonb; context jsonb; available date;
begin
  state := public.get_my_enrollment_checkout_policy();
  if not (state->>'applies')::boolean or (state->>'first_paid')::boolean then
    raise exception 'New student must be subject to policy and start unpaid';
  end if;
  select available_on into available from private.get_tuition_student_availability('10000000-0000-4000-8000-000000000004');
  if available is not null then raise exception 'Unpaid first tuition must block later invoice'; end if;
  context := public.get_enrollment_checkout_policy_context(array[
    '10000000-0000-4000-8000-000000000002'::uuid,
    '10000000-0000-4000-8000-000000000004'::uuid
  ]);
  if jsonb_array_length(context->'items') <> 2 then raise exception 'Combined quote must include both invoices'; end if;
end $$;

update public.monthly_tuition set payment_date = current_date
where id = '10000000-0000-4000-8000-000000000003';
do $$
declare state jsonb; available date;
begin
  state := public.get_my_enrollment_checkout_policy();
  if not (state->>'first_paid')::boolean then raise exception 'Manual payment was not detected'; end if;
  select available_on into available from private.get_tuition_student_availability('10000000-0000-4000-8000-000000000004');
  if available is distinct from current_date then raise exception 'Eligible invoice should be available after first payment'; end if;
  select available_on into available from private.get_tuition_student_availability('10000000-0000-4000-8000-000000000002');
  if available is distinct from current_date + 1 then raise exception 'Legacy two-day rule must remain unchanged'; end if;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false);
do $$ begin
  if (public.get_my_enrollment_checkout_policy()->>'applies')::boolean then
    raise exception 'Legacy enrollment must be excluded';
  end if;
end $$;
