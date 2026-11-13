"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migrationPath = "supabase/migrations/20261113152416_normalize_instagram_origins_and_explicit_meta_campaign_links.sql";
const migration = read(migrationPath);

function createCatalog(initialSource = "facebook") {
  class FakeOption {
    constructor(label, value) {
      this.label = label;
      this.value = value;
    }
  }

  const sourceSelect = {
    value: "",
    options: [],
    required: true,
    replaceChildren(...options) { this.options = options; },
    add(option) { this.options.push(option); }
  };
  const detailContainer = { hidden: false };
  const sourceDetail = {
    value: "",
    required: false,
    closest() { return detailContainer; }
  };
  const document = {
    referrer: "https://facebook.com/example",
    getElementById(id) {
      return { originSelect: sourceSelect, originDetail: sourceDetail }[id];
    }
  };
  const window = {
    location: { search: "?utm_source=facebook&utm_campaign=anuncio50" }
  };

  vm.runInNewContext(read("student_acquisition.js"), {
    window, document, Option: FakeOption, URL, URLSearchParams
  });

  const api = window.StudentAcquisition;
  api.setup("originSelect", "originDetail", initialSource);
  return { api, sourceSelect, sourceDetail, detailContainer };
}

test("Facebook is not offered as a distinct commercial acquisition origin", () => {
  const { api, sourceSelect } = createCatalog();
  assert.equal(api.sources.some((source) => source.value === "facebook"), false);
  assert.equal(sourceSelect.options.some((option) => option.value === "facebook"), false);
  assert.equal(sourceSelect.value, "instagram");
  assert.equal(api.label("facebook"), "Instagram");
  assert.equal(api.read("originSelect", "originDetail", true).source, "instagram");
});

test("technical Meta identifiers remain intact, distinct from the student source", () => {
  const { api } = createCatalog();
  const attribution = api.technicalAttribution();
  assert.equal(attribution.utm_source, "facebook");
  assert.equal(attribution.utm_campaign, "anuncio50");
});

test("Facebook variants normalize to Instagram, while existing campaign aliases remain recognizable", () => {
  assert.match(migration, /WHEN token IN \('instagram', 'insta', 'facebook'\) THEN 'instagram'/);
  assert.match(migration, /WHEN token IN \('anuncio50', 'meta11nov2650'\) THEN 'anuncio50'/);
  assert.match(migration, /WHEN token = 'anuncio80' THEN 'anúncio80'/);
  assert.match(migration, /canonical_acquisition_source\('other', 'Facebook'\) <> 'instagram'/);
});

test("new campaign links enforce Instagram without inventing attribution based on price", () => {
  assert.match(migration, /CREATE TRIGGER enforce_meta_campaign_instagram_origin/);
  assert.match(migration, /AFTER INSERT OR UPDATE OF campaign_alias/);
  assert.match(migration, /NEW\.campaign_alias[\s\S]*?campaign\.meta_campaign_id IS NOT NULL/);
  assert.match(migration, /PERFORM private\.save_student_acquisition\(\s*NEW\.student_id, 'instagram'/);
  assert.match(migration, /requested_campaign IS NOT NULL OR linked_meta_campaign IS NOT NULL/);
  assert.match(migration, /VALUES \(p_student, requested_campaign, 'declared_campaign_code'\)/);
  assert.match(migration, /RAISE EXCEPTION 'Aluno já vinculado a outra campanha Meta/);
  assert.doesNotMatch(migration, /monthly_fee\s*=\s*50|tuition\s*=\s*50/i);
});

test("student, reservation and trial sources reject stored Facebook values", () => {
  const checks = [
    ["student_acquisition", "student_origin_allowed"],
    ["promotion_reservations", "promotion_origin_allowed"],
    ["trial_lesson_appointments", "trial_origin_allowed"]
  ];

  for (const [table, constraint] of checks) {
    const pattern = new RegExp(
      "ALTER TABLE private\\." + table +
        "\\s+DROP CONSTRAINT " + constraint +
        ";\\s*ALTER TABLE private\\." + table +
        "\\s+ADD CONSTRAINT " + constraint +
        " CHECK \\(([\\s\\S]*?)\\n\\s*\\);"
    );
    const match = migration.match(pattern);
    assert.ok(match, table + " must have a new constraint");
    assert.doesNotMatch(match[1], /'facebook'/);
  }
  assert.match(migration, /CREATE TRIGGER canonicalize_promotion_reservation_origin/);
  assert.match(migration, /CREATE TRIGGER canonicalize_trial_lesson_origin/);
});

test("existing attribution history and campaign data are preserved", () => {
  assert.match(migration, /INSERT INTO private\.student_acquisition_history/);
  assert.match(migration, /technical_attribution = CASE/);
  assert.match(migration, /THEN private\.student_acquisition\.technical_attribution/);
  assert.doesNotMatch(migration, /UPDATE\s+private\.marketing_campaign_aliases|DELETE\s+FROM\s+private\.marketing_campaign_confirmed_students/i);
  assert.doesNotMatch(migration, /UPDATE\s+public\.profiles/i);
});

test("all six source forms invalidate their previous cached script version", () => {
  for (const file of [
    "editar_aluno.html",
    "area_do_estudante.html",
    "aulas-experimentais/index.html",
    "reservas-de-vagas/index.html",
    "perfil_dos_alunos.html",
    "complete-cadastro.html"
  ]) {
    assert.match(read(file), /student_acquisition\.js\?v=20261113-origins-1/);
  }
});

test("the R$50 enrollment offer never assigns marketing attribution automatically", () => {
  const offerMigration = read(
    "supabase/migrations/20261113113321_remove_matricula50_automatic_campaign_attribution.sql"
  );
  const authorization = offerMigration.split("-- The first monthly tuition remains gated")[0];
  assert.doesNotMatch(
    authorization,
    /private\.save_student_acquisition|marketing_campaign_confirmed_students|anuncio50/
  );
});

test("historical R$50 migration mismatch requires pinned hashes and a live catalog attestation", () => {
  const checker = read("scripts/check_supabase_migration_drift.sh");
  const attestation = read("scripts/sql/matricula50_origin_catalog_attestation.sql");

  assert.match(checker, /20261113113321/);
  assert.match(checker, /50b5bc4e035b9833951d80e82bccd4426049f08e79fe5552b659b9cb7ac17bfb/);
  assert.match(checker, /803efe11d73499f2dd1e8d6262bb4ae557d1ec36824451bfefbc0e4ed685e688/);
  assert.match(checker, /matricula50_origin_catalog_attestation\.sql/);
  assert.match(attestation, /authorize_my_enrollment_link/);
  assert.match(attestation, /strpos\(auth_ddl, 'marketing_campaign_confirmed_students'\) = 0/);
  assert.match(attestation, /NOT has_function_privilege\('anon'/);
  assert.match(attestation, /has_function_privilege\('authenticated'/);
});


const reconciliation = read(
  "supabase/migrations/20261113155607_reconcile_confirmed_meta_student_origin_fallback.sql"
);

test("explicit Meta attribution only fills missing sources when declaration agrees with Instagram", () => {
  assert.match(reconciliation, /CREATE OR REPLACE FUNCTION public\.sync_student_origin_attribution/);
  const tagPosition = reconciliation.indexOf("from public.student_tags st");
  const leadPosition = reconciliation.indexOf("from public.marketing_commercial_leads ml");
  const metaPosition = reconciliation.indexOf("from private.marketing_campaign_confirmed_students link");
  assert.ok(tagPosition >= 0 && tagPosition < leadPosition && leadPosition < metaPosition);
  assert.match(reconciliation, /if v_source_record_id is null then\s+select link\.student_id/);
  assert.match(reconciliation, /campaign\.meta_campaign_id is not null\s+and acquisition\.declared_source = 'instagram'/);
  assert.match(reconciliation, /v_recorded_via := 'meta_campaign'/);
  assert.match(reconciliation, /v_source := 'Instagram'/);
});

test("reconciliation backfill never replaces a student's conflicting source or tag", () => {
  const backfill = reconciliation.split("DO $backfill$")[1]?.split("$backfill$;")[0];
  assert.ok(backfill, "backfill transaction must be present");
  assert.match(backfill, /acquisition\.declared_source = 'instagram'/);
  assert.match(backfill, /NOT EXISTS \(\s+SELECT 1 FROM public\.student_origin_attributions canonical/);
  assert.match(backfill, /NOT EXISTS \(\s+SELECT 1 FROM public\.student_tags tag/);
  assert.match(backfill, /NOT EXISTS \(\s+SELECT 1 FROM public\.marketing_commercial_leads lead/);
  assert.match(backfill, /PERFORM public\.sync_student_origin_attribution/);
  assert.doesNotMatch(backfill, /UPDATE\s+private\.student_acquisition|UPDATE\s+private\.marketing_campaign_confirmed_students/i);
});

test("canonical attribution appends a historical row and retains legacy tag and lead sources", () => {
  assert.match(reconciliation, /recorded_via IN \('student_tag', 'marketing_lead', 'meta_campaign'\)/);
  assert.match(reconciliation, /update public\.student_origin_attributions\s+set is_current = false/i);
  assert.match(reconciliation, /insert into public\.student_origin_attributions \(/i);
  assert.match(reconciliation, /v_current\.recorded_via = v_recorded_via/);
  assert.match(reconciliation, /v_current\.source_record_id = v_source_record_id/);
  assert.match(reconciliation, /v_current\.source_label = v_source_label/);
});

test("new, changed and deleted campaign links keep the fallback synchronized", () => {
  assert.match(reconciliation, /CREATE TRIGGER sync_origin_after_meta_campaign_link/);
  assert.match(reconciliation, /AFTER INSERT OR UPDATE OF campaign_alias OR DELETE/);
  assert.match(reconciliation, /PERFORM public\.sync_student_origin_attribution\(OLD\.student_id\)/);
  assert.match(reconciliation, /PERFORM public\.sync_student_origin_attribution\(NEW\.student_id\)/);
  assert.match(reconciliation, /CREATE TRIGGER sync_origin_after_acquisition_change/);
  assert.match(reconciliation, /AFTER INSERT OR UPDATE OF declared_source/);
});

test("inconsistency review queue is private and preserves source conflicts", () => {
  assert.match(reconciliation, /CREATE OR REPLACE VIEW private\.marketing_campaign_origin_reconciliation/);
  assert.match(reconciliation, /WITH \(security_invoker = true\)/);
  assert.match(reconciliation, /THEN 'canonical_conflict'/);
  assert.match(reconciliation, /THEN 'declared_conflict'/);
  assert.match(reconciliation, /THEN 'missing_declared'/);
  assert.match(reconciliation, /THEN 'missing_canonical'/);
  assert.match(reconciliation, /GRANT SELECT ON private\.marketing_campaign_origin_reconciliation TO service_role/);
  assert.match(reconciliation, /REVOKE ALL ON private\.marketing_campaign_origin_reconciliation FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(reconciliation, /CREATE OR REPLACE VIEW public\.marketing_campaign_origin_reconciliation/);
});
