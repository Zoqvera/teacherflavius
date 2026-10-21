-- ETAPA 1D.2: auth account health storage only, disaster recovery only.
-- Verbatim DDL from 20260910163542_add_auth_account_health_monitoring.sql.
-- Does NOT install health-monitoring functions, jobs or perform checks.
-- Apply after overlay 400 exclusively in an isolated schema reconstruction.
-- Private schema restrictions are retained as in production; RLS is not added
-- to this table because the production object is private and lacks RLS.

create table if not exists private.auth_account_health_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('healthy','degraded','critical')),
  issue_count integer not null default 0 check (issue_count >= 0),
  critical_count integer not null default 0 check (critical_count >= 0),
  warning_count integer not null default 0 check (warning_count >= 0),
  metrics jsonb not null default '{}'::jsonb,
  issues jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz not null default now()
);

create index if not exists auth_account_health_runs_completed_at_idx
  on private.auth_account_health_runs (completed_at desc);

revoke all on table private.auth_account_health_runs from public, anon, authenticated;
grant select, insert, update, delete on table private.auth_account_health_runs to service_role;
