-- Preserve the reviewed R$ 300 / 4-lesson legacy plan in disaster recovery.
-- Student-specific historical data is restored separately and is intentionally
-- not embedded in this public schema baseline.

insert into private.billing_plans (
  code,
  name,
  monthly_fee,
  classes_per_month,
  active,
  legacy
)
values (
  'legacy_300_4',
  'R$ 300,00 - 4 aulas por mês',
  300.00,
  4,
  false,
  true
)
on conflict (code) do update
set
  name = excluded.name,
  monthly_fee = excluded.monthly_fee,
  classes_per_month = excluded.classes_per_month,
  active = excluded.active,
  legacy = excluded.legacy,
  updated_at = now();
