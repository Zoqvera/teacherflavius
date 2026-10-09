-- Keep the original Mercado Pago transaction immutable while allocating its settlement
-- to more than one tuition after an explicitly recorded commercial plan change.
create table private.mercado_pago_tuition_allocations (
  attempt_id uuid not null references public.tuition_payment_attempts(id) on delete restrict,
  tuition_id uuid not null references public.monthly_tuition(id) on delete restrict,
  allocated_amount numeric(10,2) not null check (allocated_amount > 0),
  created_at timestamptz not null default now(),
  reversed_at timestamptz,
  primary key (attempt_id, tuition_id),
  unique (tuition_id)
);

revoke all on table private.mercado_pago_tuition_allocations
  from public, anon, authenticated, service_role;

-- A split is valid only if all allocations reconcile with the immutable provider
-- amount, refer to the same student and match the current settled tuition rows.
-- Reversed splits remain traceable and can be safely rechecked by the provider.
create or replace function private.has_valid_mercado_pago_split(target_attempt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.tuition_payment_attempts attempt
    join private.mercado_pago_tuition_allocations allocation
      on allocation.attempt_id = attempt.id
    join public.monthly_tuition tuition on tuition.id = allocation.tuition_id
    where attempt.id = target_attempt_id
      and attempt.applied_at is not null
      and attempt.provider_payment_id is not null
      and attempt.status in ('approved', 'refunded', 'cancelled', 'charged_back')
    group by attempt.id, attempt.amount, attempt.tuition_id,
             attempt.provider_payment_id, attempt.student_id,
             attempt.status, attempt.reversed_at
    having count(*) >= 2
      and round(sum(allocation.allocated_amount), 2) = round(attempt.amount, 2)
      and count(*) filter (where allocation.tuition_id = attempt.tuition_id) = 1
      and bool_and(tuition.student_id = attempt.student_id)
      and bool_and(
        case
          when attempt.status = 'approved' and attempt.reversed_at is null
            then allocation.reversed_at is null
              and tuition.payment_date is not null
              and not tuition.is_exempt
              and round(tuition.amount_due, 2) = round(allocation.allocated_amount, 2)
              and round(tuition.amount_paid, 2) = round(allocation.allocated_amount, 2)
              and tuition.payment_method = attempt.payment_method
              and (
                (tuition.id = attempt.tuition_id
                 and tuition.payment_provider = 'mercado_pago'
                 and tuition.provider_payment_id = attempt.provider_payment_id)
                or (tuition.id <> attempt.tuition_id
                    and tuition.payment_provider is null
                    and tuition.provider_payment_id is null)
              )
          when attempt.status in ('refunded', 'cancelled', 'charged_back')
               and attempt.reversed_at is not null
            then allocation.reversed_at is not null
          else false
        end
      )
  );
$function$;

revoke all on function private.has_valid_mercado_pago_split(uuid)
  from public, anon, authenticated, service_role;

