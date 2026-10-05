const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

const loader = read("student_policy_notice_loader.js");
const orchestrator = read("student_policy_notice.js");
const renderer = read("student_policy_notice_renderer.js");
const service = read("student_policy_notice_service.js");
const authInfrastructure = read("auth_infrastructure.js");
const footerCore = read("site_footer_core.js");
const manifest = read("site.webmanifest");
const studentArea = read("area_do_estudante.html");
const migration = read(
  "supabase/migrations/20261005164625_require_cancellation_policy_acceptance.sql"
);
const baseline = read(
  "supabase/baseline/205_require_cancellation_policy_acceptance.sql"
);
const workflow = read(".github/workflows/validate-supabase-baseline.yml");

test("renders the exact mandatory cancellation and makeup notice", function () {
  assert.match(renderer, /Atualização sobre cancelamento e reposição de aulas\./);
  assert.match(renderer, /CENCELAMENTO DE UMA AULA/);
  assert.match(renderer, /REPOSIÇÃO/);
  assert.match(renderer, /pelo menos 12 horas de antecedência/);
  assert.match(renderer, /não haverá reembolso do valor e nem direito à reposição/);
  assert.match(renderer, /solicite no whatsapp o link um dia depois da aula/);
  assert.match(renderer, /Portanto, evite cancelar aulas!/);
  assert.match(renderer, /MINHAS AULAS/);
  assert.match(renderer, /Teacher Flávio/);
  assert.match(renderer, /heading\("h2", "Atualização sobre cancelamento e reposição de aulas\."\)/);
  assert.match(renderer, /heading\("h3", "CENCELAMENTO DE UMA AULA"\)/);
  assert.match(renderer, /heading\("h3", "REPOSIÇÃO"\)/);
});

test("has one required agreement action and no dismiss control", function () {
  assert.match(renderer, /button\.textContent = "estou de acordo"/);
  assert.doesNotMatch(renderer, /Fechar aviso/);
  assert.doesNotMatch(renderer, /Ver depois/);
  assert.doesNotMatch(renderer, /event\.target === modal/);
  assert.match(renderer, /event\.key === "Escape"/);
  assert.match(renderer, /event\.preventDefault\(\)/);
  assert.match(renderer, /event\.stopImmediatePropagation\(\)/);
});

test("locks background navigation until acceptance succeeds", function () {
  assert.match(renderer, /element\.inert = true/);
  assert.match(renderer, /document\.body\.classList\.add\(LOCK_CLASS\)/);
  assert.match(renderer, /document\.documentElement\.classList\.add\(LOCK_CLASS\)/);
  assert.match(orchestrator, /await service\.acceptNotice\(notice\.policy_version\)/);
  assert.match(orchestrator, /StudentPolicyNoticeRenderer\.dismiss\(\)/);
});

test("loads on authenticated site pages and the PWA student area", function () {
  assert.match(authInfrastructure, /student_policy_notice_loader\.js/);
  assert.match(footerCore, /student_policy_notice_loader\.js/);
  assert.match(manifest, /"start_url": "\/area-do-estudante\/"/);
  assert.match(studentArea, /pwa_registration\.js/);
  assert.match(studentArea, /auth\.js/);
  assert.match(loader, /SUPABASE_AUTH_STORAGE_KEY/);
});

test("notice service uses only the current-user RPCs", function () {
  assert.match(service, /get_my_required_student_policy_notice/);
  assert.match(service, /accept_my_student_policy_notice/);
  assert.match(service, /target_policy_version: version/);
});

test("database stores versioned acceptance in private schema", function () {
  for (const sql of [migration, baseline]) {
    assert.match(sql, /create table if not exists private\.student_policy_acceptances/i);
    assert.match(sql, /primary key \(student_id, policy_key, policy_version\)/i);
    assert.match(sql, /references public\.profiles\(id\) on delete cascade/i);
    assert.match(sql, /2026-10-05-v1/);
    assert.match(sql, /lesson-cancellation-makeup/);
    assert.match(sql, /revoke all on table private\.student_policy_acceptances[\s\S]*public, anon, authenticated/i);
  }
});

test("RPCs require the signed-in active student and exclude teachers", function () {
  for (const sql of [migration, baseline]) {
    assert.match(sql, /caller_id uuid := auth\.uid\(\)/i);
    assert.match(sql, /coalesce\(profile_row\.enrolled, false\) = false/i);
    assert.match(sql, /coalesce\(profile_row\.archived, false\) = true/i);
    assert.match(sql, /from public\.teacher_admins admin/i);
    assert.match(sql, /admin\.user_id = caller_id/i);
    assert.match(sql, /grant execute on function public\.get_my_required_student_policy_notice\(\)[\s\S]*authenticated, service_role/i);
    assert.match(sql, /grant execute on function public\.accept_my_student_policy_notice\(text\)[\s\S]*authenticated, service_role/i);
  }
});

test("recovery baseline includes the mandatory policy overlay", function () {
  assert.match(workflow, /205_require_cancellation_policy_acceptance\.sql/);
});
