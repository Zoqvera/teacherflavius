create table if not exists private.billing_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  monthly_fee numeric(10, 2) not null,
  classes_per_month smallint not null,
  active boolean not null default true,
  legacy boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_plans_monthly_fee_positive
    check (monthly_fee > 0),
  constraint billing_plans_classes_per_month_valid
    check (classes_per_month between 1 and 31),
  constraint billing_plans_price_lessons_unique
    unique (monthly_fee, classes_per_month)
);

revoke all on table private.billing_plans from public, anon, authenticated;
grant select on table private.billing_plans to service_role;

comment on table private.billing_plans is
  'Canonical commercial plans. Student billing rows reference a plan instead of defining an unconstrained fee/lesson combination.';
comment on column private.billing_plans.legacy is
  'True for historical plans that existing records may retain but new active assignments must not select.';

insert into private.billing_plans (
  code,
  name,
  monthly_fee,
  classes_per_month,
  active,
  legacy
)
values
  ('standard_50_4', 'R$ 50,00 - 4 aulas por mês', 50.00, 4, true, false),
  ('legacy_80_4', 'R$ 80,00 - 4 aulas por mês', 80.00, 4, false, true),
  ('standard_99_90_4', 'R$ 99,90 - 4 aulas por mês', 99.90, 4, true, false),
  ('standard_100_8', 'R$ 100,00 - 8 aulas por mês', 100.00, 8, true, false),
  ('standard_250_4', 'R$ 250,00 - 4 aulas por mês', 250.00, 4, true, false)
on conflict (code) do update
set
  name = excluded.name,
  monthly_fee = excluded.monthly_fee,
  classes_per_month = excluded.classes_per_month,
  active = excluded.active,
  legacy = excluded.legacy,
  updated_at = now();

alter table public.student_billing_settings
  add column if not exists billing_plan_id uuid,
  add column if not exists plan_review_required boolean not null default false;

alter table public.student_billing_settings
  drop constraint if exists student_billing_settings_billing_plan_id_fkey;

alter table public.student_billing_settings
  add constraint student_billing_settings_billing_plan_id_fkey
  foreign key (billing_plan_id)
  references private.billing_plans(id)
  on delete restrict;

comment on column public.student_billing_settings.billing_plan_id is
  'Canonical commercial plan. monthly_fee and classes_per_month remain as denormalized compatibility fields and must match this plan.';
comment on column public.student_billing_settings.plan_review_required is
  'Historical exception flag for archived inactive rows whose commercial plan cannot be inferred safely.';

create index if not exists student_billing_settings_billing_plan_idx
  on public.student_billing_settings (billing_plan_id);

create index if not exists student_billing_settings_plan_review_idx
  on public.student_billing_settings (student_id)
  where plan_review_required = true;

alter table public.student_billing_settings
  disable trigger sync_lesson_credits_after_plan_change;

update public.student_billing_settings settings
set classes_per_month = 4
where settings.classes_per_month is null
  and round(settings.monthly_fee, 2) in (99.90, 250.00);

update public.student_billing_settings settings
set
  billing_plan_id = plan.id,
  plan_review_required = false
from private.billing_plans plan
where round(settings.monthly_fee, 2) = plan.monthly_fee
  and settings.classes_per_month = plan.classes_per_month;

update public.student_billing_settings settings
set
  billing_plan_id = null,
  plan_review_required = true
from public.profiles profile
where profile.id = settings.student_id
  and settings.classes_per_month is null
  and coalesce(profile.archived, false) = true
  and settings.active = false;

alter table public.student_billing_settings
  enable trigger sync_lesson_credits_after_plan_change;

do $validation$
begin
  if exists (
    select 1
    from public.student_billing_settings settings
    where settings.plan_review_required = false
      and (
        settings.billing_plan_id is null
        or settings.classes_per_month is null
      )
  ) then
    raise exception 'Há configurações financeiras sem plano canônico após o backfill.';
  end if;

  if exists (
    select 1
    from public.student_billing_settings settings
    join public.profiles profile on profile.id = settings.student_id
    where settings.plan_review_required = true
      and (
        settings.billing_plan_id is not null
        or settings.classes_per_month is not null
        or settings.active = true
        or coalesce(profile.archived, false) = false
      )
  ) then
    raise exception 'Há exceções legadas fora do escopo seguro de revisão.';
  end if;
end;
$validation$;

create or replace function private.enforce_student_billing_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  profile_archived boolean;
  allow_inactive_plan boolean;
  commercial_changed boolean;
  plan_changed boolean;
  candidate_plan_ids uuid[];
  selected_plan private.billing_plans%rowtype;
begin
  select coalesce(profile.archived, false)
  into profile_archived
  from public.profiles profile
  where profile.id = new.student_id;

  if not found then
    raise exception 'Perfil do aluno não encontrado para validar o plano financeiro.';
  end if;

  allow_inactive_plan :=
    profile_archived
    and not coalesce(new.active, true);

  if tg_op = 'INSERT' then
    commercial_changed := true;
    plan_changed := true;
  else
    commercial_changed :=
      new.monthly_fee is distinct from old.monthly_fee
      or new.classes_per_month is distinct from old.classes_per_month;
    plan_changed :=
      new.billing_plan_id is distinct from old.billing_plan_id;
  end if;

  if new.plan_review_required then
    if not allow_inactive_plan then
      raise exception 'Somente registros históricos arquivados e inativos podem permanecer pendentes de revisão de plano.';
    end if;

    if tg_op = 'UPDATE'
       and not commercial_changed
       and not plan_changed
    then
      return new;
    end if;

    new.plan_review_required := false;
  end if;

  if tg_op = 'UPDATE'
     and not commercial_changed
     and not plan_changed
  then
    if new.billing_plan_id is null then
      raise exception 'A configuração financeira precisa estar vinculada a um plano.';
    end if;

    select plan.*
    into selected_plan
    from private.billing_plans plan
    where plan.id = new.billing_plan_id;

    if not found then
      raise exception 'Plano financeiro vinculado não encontrado.';
    end if;

    if round(new.monthly_fee, 2) is distinct from selected_plan.monthly_fee
       or new.classes_per_month is distinct from selected_plan.classes_per_month
    then
      raise exception 'Mensalidade e quantidade de aulas não correspondem ao plano financeiro vinculado.';
    end if;

    return new;
  end if;

  if new.billing_plan_id is not null
     and plan_changed
  then
    select plan.*
    into selected_plan
    from private.billing_plans plan
    where plan.id = new.billing_plan_id;

    if not found then
      raise exception 'Plano financeiro selecionado não existe.';
    end if;

    if not selected_plan.active
       and not allow_inactive_plan
    then
      raise exception 'Este plano financeiro é legado e não pode ser atribuído a um aluno ativo.';
    end if;
  elsif tg_op = 'UPDATE'
        and new.monthly_fee is distinct from old.monthly_fee
        and new.classes_per_month is not distinct from old.classes_per_month
  then
    select array_agg(plan.id order by plan.code)
    into candidate_plan_ids
    from private.billing_plans plan
    where plan.monthly_fee = round(new.monthly_fee, 2)
      and (plan.active or allow_inactive_plan);

    if cardinality(coalesce(candidate_plan_ids, '{}'::uuid[])) <> 1 then
      raise exception 'Selecione um plano financeiro válido para esta mensalidade.';
    end if;

    select plan.*
    into selected_plan
    from private.billing_plans plan
    where plan.id = candidate_plan_ids[1];
  elsif new.classes_per_month is not null
  then
    select plan.*
    into selected_plan
    from private.billing_plans plan
    where plan.monthly_fee = round(new.monthly_fee, 2)
      and plan.classes_per_month = new.classes_per_month
      and (plan.active or allow_inactive_plan);

    if not found then
      raise exception 'A combinação de mensalidade e quantidade de aulas não corresponde a um plano financeiro válido.';
    end if;
  else
    select array_agg(plan.id order by plan.code)
    into candidate_plan_ids
    from private.billing_plans plan
    where plan.monthly_fee = round(new.monthly_fee, 2)
      and plan.active;

    if cardinality(coalesce(candidate_plan_ids, '{}'::uuid[])) <> 1 then
      raise exception 'Selecione um plano financeiro válido para esta mensalidade.';
    end if;

    select plan.*
    into selected_plan
    from private.billing_plans plan
    where plan.id = candidate_plan_ids[1];
  end if;

  new.billing_plan_id := selected_plan.id;
  new.monthly_fee := selected_plan.monthly_fee;
  new.classes_per_month := selected_plan.classes_per_month;
  new.plan_review_required := false;

  return new;
end;
$function$;

revoke execute on function private.enforce_student_billing_plan()
  from public, anon, authenticated;
grant execute on function private.enforce_student_billing_plan()
  to service_role;

drop trigger if exists enforce_student_billing_plan_before_write
  on public.student_billing_settings;

create trigger enforce_student_billing_plan_before_write
before insert or update
on public.student_billing_settings
for each row
execute function private.enforce_student_billing_plan();

alter table public.student_billing_settings
  drop constraint if exists student_billing_settings_plan_state_check;

alter table public.student_billing_settings
  add constraint student_billing_settings_plan_state_check
  check (
    (
      plan_review_required = false
      and billing_plan_id is not null
      and classes_per_month is not null
    )
    or
    (
      plan_review_required = true
      and billing_plan_id is null
      and classes_per_month is null
      and active = false
    )
  );

drop function if exists private.enrollment_classes_per_month_for_fee(numeric);

notify pgrst, 'reload schema';
