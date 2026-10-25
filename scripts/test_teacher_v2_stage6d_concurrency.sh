#!/usr/bin/env bash
# Stage 6D: real PostgreSQL concurrency against the GitHub Actions
# disposable Supabase CLI container only. No --linked / production connection.
set -euo pipefail

DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -n 1)"
test -n "$DB_CONTAINER"
WORK_DIR="$(mktemp -d "${RUNNER_TEMP:-/tmp}/teacher-v2-stage6d.XXXXXX")"
writer_a_pid=""
writer_b_pid=""

cleanup() {
  local status=$?
  trap - EXIT
  if [[ -n "$writer_a_pid" ]]; then
    kill "$writer_a_pid" 2>/dev/null || true
    wait "$writer_a_pid" 2>/dev/null || true
  fi
  if [[ -n "$writer_b_pid" ]]; then
    kill "$writer_b_pid" 2>/dev/null || true
    wait "$writer_b_pid" 2>/dev/null || true
  fi
  if (( status != 0 )); then
    echo 'Stage 6D failed; independent writer logs:' >&2
    for log in "$WORK_DIR"/writer-*.log; do
      if [[ -f "$log" ]]; then
        cat "$log" >&2
      fi
    done
  fi
  rm -rf "$WORK_DIR"
  exit "$status"
}
trap cleanup EXIT

psql_scalar() {
  docker exec "$DB_CONTAINER" psql -X -At -U postgres -d postgres \
    -v ON_ERROR_STOP=1 -c "$1"
}

# All schema and fixture writes happen in the throwaway database. The prior
# stage 6A/6B/6C rehearsal rolled back its migration transaction entirely.
{
  echo 'BEGIN;'
  cat supabase/migrations/20261022202000_teacher_question_ratings_v2.sql
  cat supabase/migrations/20261022212500_academic_v2_auto_attendance_and_closure.sql
  cat supabase/migrations/20261022214500_academic_v2_private_table_rls.sql
  cat supabase/migrations/20261022220000_academic_v2_shared_closure_lock.sql
  cat supabase/migrations/20261022234500_fix_teacher_v2_closure_day_alias.sql
  cat tests/sql/teacher_v2_stage6d_concurrency_setup.sql
  echo 'COMMIT;'
} | docker exec -i "$DB_CONTAINER" psql -X -U postgres -d postgres \
  -v ON_ERROR_STOP=1 > "$WORK_DIR/setup.log"

# Both clients impersonate the same synthetic professor with real SQL role
# and JWT claims. They use different physical backend connections.
docker exec -i "$DB_CONTAINER" psql -X -At -U postgres -d postgres \
  -v ON_ERROR_STOP=1 > "$WORK_DIR/writer-a.log" 2>&1 <<'SQL' &
BEGIN;
SET LOCAL application_name = 'teacher_v2_6d_writer_a';
select set_config('request.jwt.claims',
  '{"sub":"98000000-0000-4000-8000-000000000001","email":"teacher-v2-6d-admin@invalid.test","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000001',true);
select set_config('teacher_v2_6d.membership',
  (select id::text from public.class_students
   where class_number=970006
     and user_id='99000000-0000-4000-8000-000000000006'),true);
SET LOCAL ROLE authenticated;
select 'FIRST_RATING=' || (result->>'rating') || '|' ||
       (result->>'already_rated') from (
  select public.rate_teacher_conversation_question_v2(
    'regular',
    current_setting('teacher_v2_6d.membership')::uuid,
    ((now() at time zone 'America/Sao_Paulo') - interval '15 minutes')::date,
    '97000000-0000-4000-8000-000000000016', 'good'
  ) result
) rating;
-- Hold the transaction lock after writing, so the second client really waits.
select pg_sleep(15);
COMMIT;
SQL
writer_a_pid=$!

# Poll the live lock table rather than assuming that concurrent shell jobs
# reached the RPC at the same time.
wait_for_advisory_lock() {
  local client="$1"
  local granted="$2"
  local i count
  for (( i=0; i<40; i++ )); do
    count="$(psql_scalar "select count(*) from pg_catalog.pg_locks locks join pg_catalog.pg_stat_activity activity on activity.pid=locks.pid where activity.application_name='${client}' and locks.locktype='advisory' and locks.classid=20261022::oid and locks.objid=4::oid and locks.granted=${granted};")"
    if [[ "$count" == "1" ]]; then
      return 0
    fi
    sleep 0.2
  done
  echo "Stage 6D: ${client} did not reach advisory granted=${granted}" >&2
  return 1
}
wait_for_advisory_lock teacher_v2_6d_writer_a true

docker exec -i "$DB_CONTAINER" psql -X -At -U postgres -d postgres \
  -v ON_ERROR_STOP=1 > "$WORK_DIR/writer-b.log" 2>&1 <<'SQL' &
BEGIN;
SET LOCAL application_name = 'teacher_v2_6d_writer_b';
select set_config('request.jwt.claims',
  '{"sub":"98000000-0000-4000-8000-000000000001","email":"teacher-v2-6d-admin@invalid.test","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000001',true);
select set_config('teacher_v2_6d.membership',
  (select id::text from public.class_students
   where class_number=970006
     and user_id='99000000-0000-4000-8000-000000000006'),true);
SET LOCAL ROLE authenticated;
select 'SECOND_RATING=' || (result->>'rating') || '|' ||
       (result->>'already_rated') from (
  select public.rate_teacher_conversation_question_v2(
    'regular',
    current_setting('teacher_v2_6d.membership')::uuid,
    ((now() at time zone 'America/Sao_Paulo') - interval '15 minutes')::date,
    '97000000-0000-4000-8000-000000000016', 'improve'
  ) result
) rating;
COMMIT;
SQL
writer_b_pid=$!
wait_for_advisory_lock teacher_v2_6d_writer_b false

# While client B is demonstrably blocked on client A's shared lock,
# enable the worker for the synthetic due class and prove try-lock skips.
due_start="$(psql_scalar "select ((date_trunc('day', now() at time zone 'America/Sao_Paulo') - interval '1 day' + interval '12 hours 59 minutes') at time zone 'America/Sao_Paulo')::text;")"
psql_scalar "update private.academic_v2_automation_control set enabled=true, enabled_from='${due_start}'::timestamptz where singleton=true;" >/dev/null

blocked_worker_result="$(psql_scalar 'select private.run_teacher_v2_auto_finalizations();')"
if [[ "$blocked_worker_result" != "0" ]]; then
  echo "Stage 6D: worker ignored concurrent teacher write: $blocked_worker_result" >&2
  exit 1
fi

wait "$writer_a_pid"
writer_a_pid=""
wait "$writer_b_pid"
writer_b_pid=""

grep -Fxq 'FIRST_RATING=good|false' "$WORK_DIR/writer-a.log"
grep -Fxq 'SECOND_RATING=good|true' "$WORK_DIR/writer-b.log"

# The next worker pass must close the eligible session exactly once.
closed="$(psql_scalar 'select private.run_teacher_v2_auto_finalizations();')"
again="$(psql_scalar 'select private.run_teacher_v2_auto_finalizations();')"
if [[ "$closed" != "1" || "$again" != "0" ]]; then
  echo "Stage 6D: closure was not exactly-once (first=$closed, second=$again)" >&2
  exit 1
fi

psql_scalar 'update private.academic_v2_automation_control set enabled=false, enabled_from=null where singleton=true;' >/dev/null
docker exec -i "$DB_CONTAINER" psql -X -U postgres -d postgres \
  -v ON_ERROR_STOP=1 < tests/sql/teacher_v2_stage6d_concurrency_verify.sql
