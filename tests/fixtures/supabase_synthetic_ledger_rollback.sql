-- Synthetic PostgreSQL rehearsal. NEVER connect this file to production.
-- No access to any application or production migration tables.
\set ON_ERROR_STOP on

create temporary table rehearsal_ledger (
  version text primary key,
  statements text[] not null default '{}',
  name text,
  created_by text,
  idempotency_key text,
  rollback text[]
);

insert into rehearsal_ledger
  (version, statements, name, created_by, idempotency_key, rollback)
values
  ('20261013000001', array['select 1;'], 'fixture_1', 'local_fixture', 'key-1', null),
  ('20261013000002', array['select 2;'], 'fixture_2', 'local_fixture', 'key-2', array['select 0;']);

-- Snapshot every column, including the statements and rollback arrays.
create temporary table rehearsal_ledger_snapshot as
  select * from rehearsal_ledger;

begin;
  -- Simulate an incorrect history cutover. This intentionally changes the
  -- migration bodies, deletes one version, and appends a fabricated version.
  delete from rehearsal_ledger where version = '20261013000001';
  update rehearsal_ledger set statements = array['select 999;']
    where version = '20261013000002';
  insert into rehearsal_ledger(version, statements, name)
    values('20261013000003', array['select 3;'], 'synthetic_cutover');

  do $rehearsal_confirms_change$
  begin
    if (select count(*) from rehearsal_ledger) <> 2 then
      raise exception 'The synthetic cutover did not run';
    end if;
    if not exists (
      select 1 from rehearsal_ledger
      where version = '20261013000003'
    ) then
      raise exception 'The synthetic cutover was not applied';
    end if;
    if not exists (
      select 1 from rehearsal_ledger
      where version = '20261013000002'
        and statements = array['select 999;']
    ) then
      raise exception 'The synthetic migration-body mutation did not run';
    end if;
  end;
  $rehearsal_confirms_change$;
rollback;

-- Both directional EXCEPT ALL checks detect missing, added, duplicated,
-- or modified records. JSONB comparison includes all six actual ledger fields.
do $verify_rollback$
begin
  if exists (
    (select to_jsonb(row_data) as content from rehearsal_ledger row_data
      except all
     select to_jsonb(row_data) as content from rehearsal_ledger_snapshot row_data)
    union all
    (select to_jsonb(row_data) as content from rehearsal_ledger_snapshot row_data
      except all
     select to_jsonb(row_data) as content from rehearsal_ledger row_data)
  ) then
    raise exception 'Full migration metadata and statements were not restored';
  end if;
  if (select count(*) from rehearsal_ledger) <> 2 then
    raise exception 'Unexpected synthetic ledger cardinality after rollback';
  end if;
end;
$verify_rollback$;

select 'SYNTHETIC_LEDGER_ROLLBACK_PASSED' as result;
