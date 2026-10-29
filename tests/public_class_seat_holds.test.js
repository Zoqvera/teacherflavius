const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function source(name) {
  return fs.readFileSync(path.join(__dirname, "..", name), "utf8");
}

const migration = source("supabase/migrations/20261029224119_public_class_seat_holds.sql");
const publicHtml = source("escolher-turma/index.html");
const publicApp = source("escolher-turma/app.js");
const adminHtml = source("reservas-de-turmas/index.html");
const adminApp = source("reservas-de-turmas/app.js");

test("15-minute holds use the membership lock and count as occupied capacity", () => {
  assert.match(migration, /expiry := now\(\)\+interval '15 minutes'/);
  assert.match(migration, /pg_advisory_xact_lock\(73008,target_class_number\)/);
  assert.match(migration, /pg_advisory_xact_lock\(73008,new\.class_number\)/);
  assert.match(migration, /private\.count_class_seat_holds\(target_class_number\)/);
  assert.match(migration, /current_count \+ private\.count_class_seat_holds\(new\.class_number,excluded_phone\) >= capacity/);
  assert.match(migration, /create trigger zz_guard_class_seat_holds_on_membership/);
  assert.match(migration, /create trigger zz_claim_class_seat_hold_on_membership/);
});

test("trial attendees must match registered WhatsApp digits and have limited holds", () => {
  assert.match(migration, /trial\.whatsapp_digits='55'\|\|target_phone/);
  assert.match(migration, /trial\.status in \('scheduled','completed'\)/);
  assert.match(migration, /count\(\*\) from private\.class_seat_holds[\s\S]*created_at>now\(\)-interval '24 hours'/);
  assert.match(migration, /class_seat_holds_one_active_phone/);
  assert.match(migration, /extensions\.digest\(secret,'sha256'\)/);
});

test("private contact data stays inaccessible to browser roles", () => {
  assert.match(migration, /create table private\.class_seat_holds/);
  assert.match(migration, /create table private\.class_seat_waitlist/);
  assert.match(migration, /alter table private\.class_seat_holds enable row level security/);
  assert.match(migration, /alter table private\.class_seat_waitlist enable row level security/);
  assert.match(migration, /revoke all on private\.class_seat_holds from public, anon, authenticated/);
  assert.match(migration, /revoke all on private\.class_seat_waitlist from public, anon, authenticated/);
  assert.match(migration, /if not coalesce\(public\.is_teacher_admin\(\),false\)/);
  assert.match(migration, /grant execute on function public\.get_teacher_class_seat_leads\(\) to authenticated,service_role/);
});

test("public pages are unindexed and contain neither contact data nor external styles", () => {
  assert.match(publicHtml, /content="noindex,nofollow"/);
  assert.match(adminHtml, /content="noindex,nofollow"/);
  assert.doesNotMatch(publicHtml, /\bonline\b/i);
  assert.doesNotMatch(publicApp, /\bonline\b/i);
  assert.match(publicApp, /get_public_class_seat_availability/);
  assert.match(publicApp, /create_public_class_seat_hold/);
  assert.match(publicApp, /join_public_class_seat_waitlist/);
  assert.match(publicApp, /REFRESH_INTERVAL_MS = 10000/);
  assert.match(publicApp, /get_public_class_seat_hold/);
  assert.match(publicApp, /cancel_public_class_seat_hold/);
});

test("teacher has a separate screen for active holds and waitlist", () => {
  assert.match(adminApp, /get_teacher_class_seat_leads/);
  assert.match(adminApp, /resolve_teacher_class_seat_lead/);
  assert.match(adminApp, /is_teacher_admin/);
  assert.match(source("professor_home.js"), /href: "\/reservas-de-turmas\/"/);
  assert.match(source("professor/professor_icons.js"), /'reservas-de-turmas': '<svg/);
  assert.match(source("reservas-de-vagas/index.html"), /href="\/reservas-de-turmas\/"/);
  assert.match(adminApp, /PUBLIC_LINK = "https:\/\/teacherflavius\.com\/escolher-turma\/"/);
});

test("promotional-price reservations remain separate from class-seat holds", () => {
  assert.match(source("reservas-de-vagas/index.html"), /Não bloqueia vaga nem horário em turmas/);
  assert.doesNotMatch(migration, /update public\.monthly_tuition/i);
  assert.doesNotMatch(migration, /update public\.student_billing_settings/i);
});
