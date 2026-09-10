const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migration = fs.readFileSync(
  path.join(__dirname, "../supabase/migrations/20260910123534_normalize_trial_lesson_brazil_whatsapp.sql"),
  "utf8"
);

test("normalizes Brazilian WhatsApp numbers while preserving group-class restrictions", function () {
  assert.match(migration, /char_length\(normalized_whatsapp_digits\) in \(10, 11\)/i);
  assert.match(migration, /normalized_whatsapp := '\+55' \|\| normalized_whatsapp_digits/i);
  assert.match(migration, /tc\.class_type in \('quartet', 'eight_students'\)/i);
  assert.match(migration, /is_teacher_admin_mfa\(\)/i);
});
