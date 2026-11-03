const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PATCH_FILE = path.resolve(
  __dirname,
  "../scripts/sql/teacher_v2_recording_window_messages_patch.sql"
);
const PATCH = fs.readFileSync(PATCH_FILE, "utf8");

test("recording attempts before the window report when registration opens", () => {
  assert.match(
    PATCH,
    /if now\(\) < lesson\.starts_at - interval '30 minutes' then\s+raise exception 'O registro ainda não foi liberado\./
  );
  assert.match(
    PATCH,
    /to_char\(\s*\(lesson\.starts_at - interval '30 minutes'\) at time zone 'America\/Sao_Paulo',\s*'HH24:MI'/
  );
});

test("recording attempts after the window remain blocked", () => {
  assert.match(
    PATCH,
    /if now\(\) >= lesson\.starts_at \+ interval '90 minutes' then\s+raise exception 'Janela de registro encerrada\./
  );
  assert.match(
    PATCH,
    /from private\.academic_class_session_finalizations closed/
  );
  assert.ok(
    PATCH.indexOf("O registro ainda não foi liberado") <
      PATCH.indexOf("Janela de registro encerrada"),
    "The early/late conditions must be evaluated in chronological order."
  );
});

test("the window fix preserves teacher authorization and finalization safety", () => {
  assert.match(PATCH, /public\.is_teacher_admin\(\)/);
  assert.match(PATCH, /private\.resolve_academic_lesson\(/);
  assert.match(PATCH, /pg_catalog\.pg_advisory_xact_lock\(20261022, 4\)/);
  assert.match(PATCH, /security definer\s+set search_path = ''/);
  assert.match(
    PATCH,
    /revoke all on function private\.assert_teacher_v2_session_open\(text, uuid, date\)\s+from public, anon, authenticated/i
  );
  assert.doesNotMatch(
    PATCH,
    /\b(delete|truncate|drop table|update\s+private\.lesson_credits)\b/i
  );
});
