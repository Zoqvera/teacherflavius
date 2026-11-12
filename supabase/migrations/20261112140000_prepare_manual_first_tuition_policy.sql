-- The policy remains disabled until a coordinated activation after all clients
-- and payment functions have been deployed and verified.
create table private.enrollment_checkout_policy_settings (
  singleton boolean primary key default true check (singleton),
  rollout_at timestamptz
);
insert into private.enrollment_checkout_policy_settings (singleton) values (true);
alter table private.enrollment_checkout_policy_settings enable row level security;
revoke all on private.enrollment_checkout_policy_settings from public, anon, authenticated;

-- Service-only inputs for the payment gateway. One row is required for every
-- invoice in the server-generated quote, including covered beneficiaries.
create function public.get_enrollment_checkout_policy_context(target_tuition_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  rollout timestamptz;
  items jsonb;
begin
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role'
     and session_user <> 'postgres' then
    raise exception 'Acesso exclusivo do servidor.' using errcode = '42501';
  end if;
  select rollout_at into rollout from private.enrollment_checkout_policy_settings where singleton;
  if rollout is null then
    return jsonb_build_object('enabled', false, 'items', '[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'tuitionId', tuition.id,
    'enrolledAt', profile.enrolled_at,
    'rolloutAt', rollout,
    'billingStartMonth', billing.billing_start_month,
    'invoiceMonth', tuition.reference_month,
    'firstPaymentDate', first_tuition.payment_date
  )), '[]'::jsonb) into items
  from public.monthly_tuition tuition
  join public.profiles profile on profile.id = tuition.student_id
  join public.student_billing_settings billing on billing.student_id = profile.id
  left join public.monthly_tuition first_tuition
    on first_tuition.student_id = profile.id
   and first_tuition.reference_month = billing.billing_start_month
  where tuition.id = any(target_tuition_ids);
  return jsonb_build_object('enabled', true, 'items', items);
end;
$$;
revoke all on function public.get_enrollment_checkout_policy_context(uuid[]) from public, anon, authenticated;
grant execute on function public.get_enrollment_checkout_policy_context(uuid[]) to service_role;

create function public.get_enrollment_subscription_policy_context(target_student_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  rollout timestamptz;
  item jsonb;
begin
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role'
     and session_user <> 'postgres' then
    raise exception 'Acesso exclusivo do servidor.' using errcode = '42501';
  end if;
  select rollout_at into rollout from private.enrollment_checkout_policy_settings where singleton;
  if rollout is null then return jsonb_build_object('enabled', false); end if;
  select jsonb_build_object(
    'enrolledAt', profile.enrolled_at,
    'rolloutAt', rollout,
    'billingStartMonth', billing.billing_start_month,
    'invoiceMonth', (billing.billing_start_month + interval '1 month')::date,
    'firstPaymentDate', first_tuition.payment_date
  ) into item
  from public.profiles profile
  join public.student_billing_settings billing on billing.student_id = profile.id
  left join public.monthly_tuition first_tuition
    on first_tuition.student_id = profile.id
   and first_tuition.reference_month = billing.billing_start_month
  where profile.id = target_student_id;
  return jsonb_build_object('enabled', true, 'item', item);
end;
$$;
revoke all on function public.get_enrollment_subscription_policy_context(uuid) from public, anon, authenticated;
grant execute on function public.get_enrollment_subscription_policy_context(uuid) to service_role;

-- Expose only the signed-in student's status; the activation timestamp itself
-- and other students' billing records remain private.
create function public.get_my_enrollment_checkout_policy()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  requester uuid := auth.uid();
  rollout timestamptz;
  enrolled_at timestamptz;
  first_paid boolean;
  first_month date;
begin
  if requester is null then
    raise exception 'Faça login para consultar a matrícula.' using errcode = '42501';
  end if;
  select rollout_at into rollout from private.enrollment_checkout_policy_settings where singleton;
  select profile.enrolled_at, (first_tuition.payment_date is not null), billing.billing_start_month
  into enrolled_at, first_paid, first_month
  from public.profiles profile
  left join public.student_billing_settings billing on billing.student_id = profile.id
  left join public.monthly_tuition first_tuition
    on first_tuition.student_id = profile.id
   and first_tuition.reference_month = billing.billing_start_month
  where profile.id = requester;
  return jsonb_build_object(
    'enabled_for_new_enrollments', rollout is not null,
    'applies', rollout is not null and enrolled_at is not null and enrolled_at >= rollout,
    'first_paid', coalesce(first_paid, false),
    'billing_start_month', first_month,
    'checkout_available_at', case when rollout is not null and enrolled_at >= rollout
      then enrolled_at + interval '10 days' else null end
  );
end;
$$;
revoke all on function public.get_my_enrollment_checkout_policy() from public, anon;
grant execute on function public.get_my_enrollment_checkout_policy() to authenticated;

-- Preserve historical availability for legacy students. For the new cohort,
-- later invoices are available once the first payment and ten-day condition
-- are met; the gateway enforces the exact time of day independently.
create or replace function private.get_tuition_student_availability(target_tuition_id uuid)
returns table(available_on date, effective_due_date date)
language sql stable security definer set search_path = '' as $$
  with target as (
    select t.student_id, t.reference_month, t.due_date, t.created_at,
      b.billing_start_month, p.enrolled_at, settings.rollout_at,
      first_tuition.payment_date as first_payment_date
    from public.monthly_tuition t
    left join public.student_billing_settings b on b.student_id = t.student_id
    left join public.profiles p on p.id = t.student_id
    left join private.enrollment_checkout_policy_settings settings on settings.singleton
    left join public.monthly_tuition first_tuition
      on first_tuition.student_id = t.student_id
     and first_tuition.reference_month = b.billing_start_month
    where t.id = target_tuition_id
  ), timing as (
    select target.*, case
      when target.reference_month = target.billing_start_month
        then timezone('America/Sao_Paulo', target.created_at)::date
      when target.rollout_at is not null and target.enrolled_at >= target.rollout_at
        then case when target.first_payment_date is not null
          then greatest(timezone('America/Sao_Paulo', target.enrolled_at + interval '10 days')::date,
            target.first_payment_date) else null end
      else (select previous_tuition.payment_date + 2
        from public.monthly_tuition previous_tuition
        where previous_tuition.student_id = target.student_id
          and previous_tuition.reference_month =
            (date_trunc('month', target.reference_month::timestamp) - interval '1 month')::date
          and previous_tuition.payment_date is not null limit 1)
    end as available_on from target
  )
  select timing.available_on, case when timing.available_on is null then null
    else greatest(timing.due_date, timing.available_on) end from timing;
$$;
