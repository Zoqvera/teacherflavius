const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const migration = read(
  "supabase/migrations/20261006225907_canonicalize_tuition_release_and_push_eligibility.sql"
);
const baseline = read(
  "supabase/baseline/280_canonicalize_tuition_release_and_push_eligibility.sql"
);

for (const [label, sql] of [
  ["migration", migration],
  ["baseline", baseline]
]) {
  test(label + " centralizes tuition release timing", function () {
    assert.match(
      sql,
      /private\.get_tuition_student_availability\([\s\S]*available_on date[\s\S]*effective_due_date date/i
    );
    assert.match(
      sql,
      /previous_tuition\.payment_date \+ 2/i
    );
    assert.match(
      sql,
      /greatest\(timing\.due_date, timing\.available_on\)/i
    );
  });

  test(label + " uses the canonical rule in the student payment query", function () {
    assert.match(
      sql,
      /public\.get_my_pending_tuitions\(\)[\s\S]*cross join lateral private\.get_tuition_student_availability\(tuition\.id\) availability/i
    );
    assert.match(sql, /availability\.available_on <= local_today/i);
    assert.match(sql, /availability\.effective_due_date < local_today then 'overdue'/i);
  });

  test(label + " uses the canonical rule before queueing and claiming tuition push", function () {
    assert.match(
      sql,
      /private\.enqueue_due_web_push_notifications\(\)[\s\S]*cross join lateral private\.get_tuition_student_availability\(tuition\.id\) availability/i
    );
    assert.match(
      sql,
      /availability\.effective_due_date in \([\s\S]*current_local_date,[\s\S]*current_local_date \+ 2/i
    );
    assert.match(
      sql,
      /public\.claim_due_web_push_notifications[\s\S]*Lembrete invalidado pela regra vigente de liberação da mensalidade/i
    );
  });

  test(label + " keeps the internal helper inaccessible to browser roles", function () {
    assert.match(
      sql,
      /revoke all on function private\.get_tuition_student_availability\(uuid\)[\s\S]*from public, anon, authenticated/i
    );
  });
}

test("month-boundary contract releases a later tuition two calendar days after payment", function () {
  const paymentDate = new Date("2026-09-30T12:00:00Z");
  const availableOn = new Date(paymentDate);
  availableOn.setUTCDate(availableOn.getUTCDate() + 2);

  const originalDueDate = new Date("2026-10-01T12:00:00Z");
  const effectiveDueDate = new Date(
    Math.max(originalDueDate.getTime(), availableOn.getTime())
  );

  assert.equal(availableOn.toISOString().slice(0, 10), "2026-10-02");
  assert.equal(effectiveDueDate.toISOString().slice(0, 10), "2026-10-02");
});
