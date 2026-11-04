const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

const catalog = read("scripts/sql/public_readonly_rpc_security_attestation.sql");
const reviews = read("student_reviews_public.js");
const homeVacancies = read("home_vacancies.js");
const courseVacancies = read("course_vacancies.js");
const migrationWorkflow = read(".github/workflows/supabase-migration-drift.yml");

test("exactly the three reviewed read-only RPCs can remain anonymous", () => {
  const approved = [
    "public.get_public_class_seat_availability()",
    "public.get_public_course_vacancies()",
    "public.get_public_student_reviews(text)"
  ];
  for (const signature of approved) {
    assert.ok(catalog.includes("'" + signature + "'::regprocedure"), signature);
  }
  assert.equal((catalog.split("verified_definitions as (")[0].match(/'::regprocedure/g) || []).length, approved.length);
  assert.match(catalog, /count\(\*\) = 3[\s\S]*from pg_proc function_definition/);
  assert.match(catalog, /function_definition\.provolatile = 's'/);
  assert.match(catalog, /function_definition\.proconfig @> array\['search_path="?"?'\]/);
  assert.match(catalog, /grant_record\.grantee = 0/);
});

test("public review payload has a fixed, consent-only structure", () => {
  assert.match(catalog, /review\.status = ''approved''/);
  assert.match(catalog, /review\.publication_consent_at is not null/);
  assert.match(catalog, /jsonb_array_length\(payload->'reviews'\) <= 5/);
  assert.match(catalog, /'display_name','rating','comment','submitted_at','verified_student'/);
  assert.match(catalog, /not has_table_privilege\('anon', 'private\.student_class_reviews'/);
  assert.match(catalog, /not has_schema_privilege\('anon', 'private', 'USAGE'\)/);
  assert.doesNotMatch(catalog, /^\s*(?:insert into|update\s|delete from|drop\s|alter\s|truncate\s|grant\s|revoke\s)/im);
});

test("browser renderers keep anonymous read access without injecting review HTML", () => {
  assert.match(reviews, /rpc\/get_public_student_reviews/);
  assert.match(reviews, /strong\.textContent = review\.display_name/);
  assert.match(reviews, /comment\.textContent = review\.comment/);
  assert.doesNotMatch(reviews, /innerHTML\s*=/);
  assert.match(homeVacancies, /rpc\/get_public_course_vacancies/);
  assert.match(courseVacancies, /rpc\/get_public_course_vacancies/);
});

test("existing migration-drift CI runs the live read-only catalog attestation", () => {
  assert.match(migrationWorkflow, /public_readonly_rpc_security_attestation\.sql/);
  assert.match(migrationWorkflow, /SUPABASE_DB_URL/);
  assert.match(migrationWorkflow, /ON_ERROR_STOP=1/);
});
