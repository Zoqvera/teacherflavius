-- Stage 7 preparation: both gates start disabled, with no pilot members.
-- Applying this migration alone does not activate the new student flow.

create table if not exists public.student_preparation_pilot_settings (
  id boolean primary key default true check (id = true),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.student_preparation_pilot_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.student_preparation_pilot_settings enable row level security;
alter table public.student_preparation_pilot_members enable row level security;

revoke all on table public.student_preparation_pilot_settings from public, anon, authenticated;
revoke all on table public.student_preparation_pilot_members from public, anon, authenticated;

grant select on public.student_preparation_pilot_settings to authenticated;
grant select on public.student_preparation_pilot_members to authenticated;
grant all on public.student_preparation_pilot_settings to service_role;
grant all on public.student_preparation_pilot_members to service_role;

create policy "authenticated_can_read_preparation_pilot_switch"
on public.student_preparation_pilot_settings
for select to authenticated
using (true);

create policy "student_can_read_only_own_pilot_grant"
on public.student_preparation_pilot_members
for select to authenticated
using ((select auth.uid()) = user_id);

insert into public.student_preparation_pilot_settings (id, enabled)
values (true, false)
on conflict (id) do nothing;
