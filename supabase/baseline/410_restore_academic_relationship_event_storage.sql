-- ETAPA 1D.3: schema-only restore of academic relationship event storage.
-- The SQL after this header is an exact prefix of reviewed historical migration
-- 20261016144000_homeworks_formal_relationship_retention.sql.
-- No teacher RPC, retention function, job, deletion, or data backfill is installed.
-- Execute only after overlay 405 in disposable clean reconstruction.

-- ETAPA 5 — evidência explícita do encerramento formal para a retenção acadêmica.
-- NÃO interpreta arquivamento como desligamento; NÃO elimina dados ou ativa o módulo.
-- Nenhum período anterior à implantação é inferido automaticamente.
create table public.homework_relationship_events (
  id bigint generated always as identity primary key,
  student_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in ('ended', 'resumed')),
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  recorded_by uuid references auth.users(id) on delete set null,
  constraint homework_relationship_time_not_future
    check (occurred_at <= recorded_at + interval '5 minutes')
);

create index homework_relationship_events_student_latest_idx
  on public.homework_relationship_events(student_id, id desc);

alter table public.homework_relationship_events enable row level security;
revoke all on public.homework_relationship_events from public, anon, authenticated;
revoke all on sequence public.homework_relationship_events_id_seq from public, anon, authenticated;
grant select, insert on public.homework_relationship_events to service_role;
grant usage, select on sequence public.homework_relationship_events_id_seq to service_role;
