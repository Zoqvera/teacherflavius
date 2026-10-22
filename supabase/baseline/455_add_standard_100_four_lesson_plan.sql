-- Add the four-lesson R$ 100 plan without changing the existing eight-lesson plan.
-- Commercial identity is the (monthly_fee, classes_per_month) pair, not the fee alone.
insert into private.billing_plans (
  code, name, monthly_fee, classes_per_month, active, legacy
)
values (
  'standard_100_4', 'R$ 100,00 - 4 aulas por mês', 100.00, 4, true, false
)
on conflict (monthly_fee, classes_per_month) do nothing;

do $verify_standard_100_plans$
begin
  if not exists (
    select 1 from private.billing_plans
    where monthly_fee = 100.00
      and classes_per_month = 4
      and active = true
      and legacy = false
  ) then
    raise exception 'R$ 100 / 4-aula plan must be active and non-legacy.';
  end if;

  if not exists (
    select 1 from private.billing_plans
    where monthly_fee = 100.00
      and classes_per_month = 8
      and active = true
      and legacy = false
  ) then
    raise exception 'Existing R$ 100 / 8-aula plan must remain active.';
  end if;
end;
$verify_standard_100_plans$;
