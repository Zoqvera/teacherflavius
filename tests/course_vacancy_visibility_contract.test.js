const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const migration = read("supabase/migrations/20261002040500_limit_course_vacancies_to_three.sql");
const recoveryOverlay = read("supabase/baseline/120_limit_course_vacancies_to_three.sql");
const workflow = read(".github/workflows/validate-supabase-baseline.yml");
const courseVacancies = read("course_vacancies.js");
const homeVacancies = read("home_vacancies.js");

test("course vacancy RPC returns only one to three available spots", function () {
  assert.match(migration, /get_public_course_vacancies\(\)/);
  assert.match(migration, /get_public_quartet_vacancies\(\)/);
  assert.match(migration, /available_spots between 1 and 3/);
});

test("course vacancy RPC is an invoker wrapper with explicit public grants", function () {
  assert.match(migration, /security invoker/);
  assert.match(
    migration,
    /revoke all on function public\.get_public_course_vacancies\(\)[\s\S]*from public, anon, authenticated/
  );
  assert.match(
    migration,
    /grant execute on function public\.get_public_course_vacancies\(\)[\s\S]*to anon, authenticated, service_role/
  );
});

test("course page uses the filtered RPC while home keeps its current RPC", function () {
  assert.match(courseVacancies, /\/rest\/v1\/rpc\/get_public_course_vacancies/);
  assert.doesNotMatch(courseVacancies, /\/rest\/v1\/rpc\/get_public_quartet_vacancies/);
  assert.match(homeVacancies, /\/rest\/v1\/rpc\/get_public_quartet_vacancies/);
  assert.doesNotMatch(homeVacancies, /\/rest\/v1\/rpc\/get_public_course_vacancies/);
});

test("recovery baseline preserves the course vacancy filter", function () {
  assert.match(recoveryOverlay, /available_spots between 1 and 3/);
  assert.match(workflow, /120_limit_course_vacancies_to_three\.sql/);
});
