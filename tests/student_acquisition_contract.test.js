const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const enrollment = read("complete-cadastro.html");
const editing = read("editar_aluno.js");
const directory = read("perfil_dos_alunos.js");
const reservations = read("reservas-de-vagas/reservations.js");
const trials = read("trial_lesson_scheduler.js");
const migrations = [
  "supabase/migrations/20261012164429_student_acquisition_origin_20261012.sql",
  "supabase/migrations/20261012164853_acquisition_lead_atomic_wrappers_20261012.sql",
  "supabase/migrations/20261012165452_secure_acquisition_enrollment_trigger.sql"
].map(read);

function loadAcquisitionService() {
  class FakeOption {
    constructor(text, value) {
      this.text = text;
      this.value = value;
    }
  }
  const detailContainer = { hidden: false };
  const select = {
    required: false,
    options: [],
    value: "",
    replaceChildren(option) { this.options = [option]; },
    add(option) { this.options.push(option); }
  };
  const detail = {
    value: "",
    required: false,
    closest() { return detailContainer; }
  };
  const document = {
    referrer: "",
    getElementById(id) {
      return { acquisitionSource: select, acquisitionDetail: detail }[id] || null;
    }
  };
  const window = {
    location: { search: "?utm_source=instagram&utm_campaign=october" }
  };
  vm.runInNewContext(read("student_acquisition.js"), {
    window, document, Option: FakeOption, URL, URLSearchParams
  });
  return { api: window.StudentAcquisition, select, detail, detailContainer };
}

test("required enrollment captures self-reported source before profile completion", () => {
  assert.match(enrollment, /id="acquisitionSource" required/);
  assert.match(enrollment, /get_my_student_acquisition/);
  assert.match(enrollment, /set_my_student_acquisition/);
  assert.ok(
    enrollment.indexOf('rpc("set_my_student_acquisition"') <
    enrollment.indexOf("await Auth.completeProfile(")
  );
});

test("professor can mark any enrolled student's source and directory can filter missing entries", () => {
  assert.match(read("editar_aluno.html"), /studentAcquisitionSource/);
  assert.match(editing, /get_teacher_student_acquisitions/);
  assert.match(editing, /set_teacher_student_acquisition/);
  assert.match(directory, /without_origin/);
  assert.match(directory, /Como conheceu as aulas/);
  assert.match(directory, /formatAvailabilityForSpreadsheet\(student\),[\s\S]*StudentAcquisition\.label/);
});

test("promotion and trial registrations save sources in a single database transaction", () => {
  assert.match(reservations, /save_teacher_promotion_reservation_with_origin/);
  assert.match(trials, /create_teacher_trial_lesson_with_origin/);
  assert.match(trials, /update_teacher_trial_lesson_with_origin/);
  assert.match(migrations[1], /saved := public\.save_teacher_promotion_reservation/);
  assert.match(migrations[1], /perform public\.set_teacher_lead_acquisition\('reservation'/);
  assert.match(migrations[1], /perform public\.set_teacher_lead_acquisition\('trial'/);
});

test("acquisition is separate from technical attribution and preserves audit trail", () => {
  assert.match(migrations[0], /technical_attribution jsonb/);
  assert.match(migrations[0], /student_acquisition_history/);
  assert.match(migrations[0], /if exists\(select 1 from private\.student_acquisition where student_id=p_student and declared_source is not null\) then return/);
  assert.match(migrations[0], /private\.normalize_trial_phone/);
  assert.match(migrations[0], /where public\.is_teacher_admin\(\)/);
  assert.match(migrations[2], /security definer/i);
  assert.match(read("marketing_acquisition.js"), /get_teacher_declared_acquisition_report/);
});

test("source options validate free-text only for 'other'", () => {
  const { api, select, detail, detailContainer } = loadAcquisitionService();
  select.required = true;
  api.setup("acquisitionSource", "acquisitionDetail", "google");
  assert.equal(api.label("google"), "Google");
  assert.equal(api.read("acquisitionSource", "acquisitionDetail", true).source, "google");
  assert.equal(detailContainer.hidden, true);
  select.value = "other";
  select.onchange();
  assert.equal(detailContainer.hidden, false);
  assert.throws(() => api.read("acquisitionSource", "acquisitionDetail", true), /Informe onde/);
  detail.value = "Cartaz no bairro";
  const answer = api.read("acquisitionSource", "acquisitionDetail", true);
  assert.deepEqual(JSON.parse(JSON.stringify(answer)), { source: "other", detail: "Cartaz no bairro" });
  assert.equal(api.technicalAttribution().utm_source, "instagram");
});

test("unsupported acquisition sources are rejected", () => {
  const { api, select } = loadAcquisitionService();
  api.setup("acquisitionSource", "acquisitionDetail");
  select.value = "invalid-source";
  assert.throws(() => api.read("acquisitionSource", "acquisitionDetail", true), /origem válida/);
});
