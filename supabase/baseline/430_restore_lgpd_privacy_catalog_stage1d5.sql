-- Stage 1D.5: restore the LGPD data catalog in a fresh, disposable baseline.
-- Sources:
--   20260820231050_add_lgpd_data_subject_request_workflow.sql
--   20260820232656_expand_lgpd_data_subject_rights.sql
--   20260820233917_automate_data_retention_and_backup_cleanup.sql
--   20260925023000_tier_teacher_admin_mfa.sql
-- Production schema, historical migrations, personal records, privileged RPCs,
-- seed policies and scheduled purge jobs are intentionally out of scope.
do $lgpd_recovery_guard$
begin
  if to_regclass('public.data_subject_requests') is not null
     or to_regclass('public.data_retention_policies') is not null
     or to_regclass('public.data_retention_runs') is not null then
    raise exception 'LGPD tables must not exist before isolated recovery';
  end if;

  if to_regprocedure('public.is_teacher_admin_mfa()') is null then
    raise exception 'Administrative authorization function must be restored first';
  end if;
end;
$lgpd_recovery_guard$;

create table public.data_subject_requests (
  id uuid primary key default gen_random_uuid(),
  subject_user_id uuid not null,
  subject_name text,
  subject_email text,
  request_type text not null default 'account_deletion',
  status text not null default 'open'
    check (status in ('open', 'in_review', 'completed', 'cancelled', 'rejected')),
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  completed_at timestamptz,
  reviewed_by uuid,
  resolution_note text,
  retention_summary jsonb not null default '{}'::jsonb,
  request_details text,
  constraint data_subject_requests_request_type_check check (
    request_type in (
      'account_deletion', 'data_access', 'correction',
      'anonymization_blocking', 'sharing_information'
    )
  ),
  constraint data_subject_requests_request_details_length_check check (
    request_details is null or length(request_details) <= 4000
  ),
  constraint data_subject_requests_resolution_note_length_check check (
    resolution_note is null or length(resolution_note) <= 8000
  )
);

create unique index data_subject_requests_one_active_type_per_user
  on public.data_subject_requests (subject_user_id, request_type)
  where status in ('open', 'in_review');

create index data_subject_requests_status_requested_at_idx
  on public.data_subject_requests (status, requested_at desc);

create index data_subject_requests_type_status_requested_at_idx
  on public.data_subject_requests (request_type, status, requested_at desc);

create table public.data_retention_policies (
  dataset text primary key,
  category text not null,
  source_table text,
  timestamp_column text,
  retention_days integer,
  automatic_purge boolean not null default false,
  enabled boolean not null default true,
  rationale text not null,
  last_reviewed_at timestamptz not null default now(),
  next_review_at date,
  constraint data_retention_policies_days_check check (
    retention_days is null or retention_days between 1 and 3650
  ),
  constraint data_retention_policies_auto_requires_source check (
    automatic_purge = false or (
      source_table is not null and timestamp_column is not null
      and retention_days is not null
    )
  )
);

create table public.data_retention_runs (
  id uuid primary key default gen_random_uuid(),
  trigger_source text not null check (trigger_source in ('cron', 'manual')),
  status text not null check (status in ('running', 'completed', 'failed', 'skipped')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  deleted_counts jsonb not null default '{}'::jsonb,
  error_message text
);

create index data_retention_runs_started_at_idx
  on public.data_retention_runs (started_at desc);

alter table public.data_subject_requests enable row level security;
alter table public.data_retention_policies enable row level security;
alter table public.data_retention_runs enable row level security;

revoke all on table public.data_subject_requests from public, anon, authenticated;
revoke all on table public.data_retention_policies from public, anon, authenticated;
revoke all on table public.data_retention_runs from public, anon, authenticated;

-- In production, browser roles may SELECT only. Mutations happen via
-- independently reviewed, privileged RPCs, not direct table grants.
grant select on table public.data_subject_requests to authenticated;
grant select on table public.data_retention_policies to authenticated;
grant select on table public.data_retention_runs to authenticated;

create policy subjects_read_own_privacy_requests
  on public.data_subject_requests
  for select to authenticated
  using ((select auth.uid()) = subject_user_id);

create policy teacher_reads_privacy_requests
  on public.data_subject_requests
  for select to authenticated
  using (coalesce(public.is_teacher_admin_mfa(), false));

create policy teacher_reads_data_retention_policies
  on public.data_retention_policies
  for select to authenticated
  using (coalesce(public.is_teacher_admin_mfa(), false));

create policy teacher_reads_data_retention_runs
  on public.data_retention_runs
  for select to authenticated
  using (coalesce(public.is_teacher_admin_mfa(), false));

do $lgpd_recovery_verify$
begin
  if (
    select count(*)
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename in (
        'data_subject_requests', 'data_retention_policies', 'data_retention_runs'
      )
      and permissive = 'PERMISSIVE'
      and roles = array['authenticated']::name[]
      and cmd = 'SELECT'
  ) <> 4 then
    raise exception 'LGPD policy recovery is incomplete';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class c
    where c.oid in (
      'public.data_subject_requests'::regclass,
      'public.data_retention_policies'::regclass,
      'public.data_retention_runs'::regclass
    ) and not c.relrowsecurity
  ) then
    raise exception 'LGPD relations require RLS';
  end if;

  if has_table_privilege('anon', 'public.data_subject_requests', 'SELECT')
     or has_table_privilege('anon', 'public.data_retention_policies', 'SELECT')
     or has_table_privilege('anon', 'public.data_retention_runs', 'SELECT')
     or has_table_privilege('authenticated', 'public.data_subject_requests', 'INSERT')
     or has_table_privilege('authenticated', 'public.data_subject_requests', 'UPDATE')
     or has_table_privilege('authenticated', 'public.data_subject_requests', 'DELETE')
     or has_table_privilege('authenticated', 'public.data_retention_policies', 'UPDATE')
     or has_table_privilege('authenticated', 'public.data_retention_runs', 'DELETE')
  then
    raise exception 'Unexpected direct browser permissions on LGPD catalog';
  end if;
end;
$lgpd_recovery_verify$;
