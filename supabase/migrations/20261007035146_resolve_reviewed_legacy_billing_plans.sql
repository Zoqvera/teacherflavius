-- Resolve reviewed archived billing exceptions without publishing student identifiers.
-- The production review established that the remaining R$ 80 and R$ 300 legacy
-- contracts both represent four lessons per month.

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

alter table public.student_billing_settings
  disable trigger sync_lesson_credits_after_plan_change;

update public.student_billing_settings settings
set
  classes_per_month = 4,
  updated_at = now()
from public.profiles profile
where profile.id = settings.student_id
  and profile.archived = true
  and settings.active = false
  and settings.plan_review_required = true
  and settings.classes_per_month is null
  and round(settings.monthly_fee, 2) in (80.00, 300.00);

alter table public.student_billing_settings
  enable trigger sync_lesson_credits_after_plan_change;

do $validation$
begin
  if exists (
    select 1
    from public.student_billing_settings settings
    join public.profiles profile on profile.id = settings.student_id
    where profile.archived = true
      and settings.active = false
      and settings.plan_review_required = true
      and settings.classes_per_month is null
      and round(settings.monthly_fee, 2) in (80.00, 300.00)
  ) then
    raise exception 'Há planos legados revisados ainda pendentes de resolução.';
  end if;
end;
$validation$;
