-- Disposable fixture only: relation shape observed in production, 2026-11-04.
-- This fixture must never be applied to the production database.
begin;
do $$
begin
  if to_regclass('public.student_course_states') is not null
    or (select count(*) from public.teacher_classes where class_number in (970001, 970002)) <> 2
    or exists (select 1 from public.profiles)
    or exists (select 1 from public.monthly_tuition)
    or exists (select 1 from cron.job where active) then
    raise exception 'Refusing course-state overlay on a non-disposable database';
  end if;
end;
$$;
alter table public.monthly_tuition
  add column amount_override numeric check (amount_override is null or amount_override > 0),
  add column amount_override_reason text check (amount_override_reason is null or char_length(amount_override_reason) <= 500);
create table public.student_course_states (
  student_id uuid primary key references public.profiles(id) on delete cascade,
  course_status text not null check (course_status in ('active','awaiting_class','paused')),
  status_since date,
  status_reason text,
  billing_exemption text not null default 'none' check (billing_exemption in ('none','permanent')),
  billing_block_from_month date,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  check (billing_block_from_month is null or billing_block_from_month = date_trunc('month', billing_block_from_month::timestamptz)::date),
  check ((course_status = 'paused' and billing_block_from_month is not null) or (course_status <> 'paused' and billing_block_from_month is null))
);
alter table public.student_course_states enable row level security;
create policy "Professores gerenciam estados administrativos" on public.student_course_states
  for all to authenticated using (public.is_teacher_admin()) with check (public.is_teacher_admin());
revoke all on public.student_course_states from public, anon, teacher_payment_agent;
commit;
