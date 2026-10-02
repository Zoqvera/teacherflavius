const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const historicalFilterMigration = read(
  "supabase/migrations/20261002040500_limit_course_vacancies_to_three.sql"
);
const currentMigration = read(
  "supabase/migrations/20261002044000_show_sold_out_course_classes.sql"
);
const recoveryOverlay = read(
  "supabase/baseline/125_show_sold_out_course_classes.sql"
);
const workflow = read(".github/workflows/validate-supabase-baseline.yml");
const vacanciesScript = read("home_vacancies.js");
const vacanciesStyles = read("home_vacancies.css");
const coursePage = read("aulas-em-grupo/index.html");

test("historical one-to-three filter remains traceable", function () {
  assert.match(historicalFilterMigration, /available_spots between 1 and 3/);
});

test("current RPC returns quintet and individual classes while excluding trial-only records", function () {
  assert.match(currentMigration, /tc\.class_type in \('quintet', 'individual'\)/);
  assert.match(currentMigration, /not like 'AULA EXPERIMENTAL%'/);
  assert.match(currentMigration, /class_type text/);
  assert.match(currentMigration, /sold_out boolean/);
});

test("quintets are available only with one to three actual vacancies", function () {
  assert.match(
    currentMigration,
    /a\.class_type = 'quintet'[\s\S]*a\.actual_available_spots between 1 and 3[\s\S]*then a\.actual_available_spots[\s\S]*else 0/
  );
  assert.match(
    currentMigration,
    /when a\.actual_available_spots between 1 and 3 then false[\s\S]*else true/
  );
});

test("individual classes are always sold out with zero public vacancies", function () {
  assert.match(currentMigration, /when a\.class_type = 'individual' then true/);
  assert.match(
    currentMigration,
    /case[\s\S]*when a\.class_type = 'quintet'[\s\S]*then a\.actual_available_spots[\s\S]*else 0[\s\S]*end::integer as available_spots/
  );
});

test("public RPC exposes only aggregated schedule availability", function () {
  assert.match(currentMigration, /security definer/);
  assert.match(
    currentMigration,
    /revoke all on function public\.get_public_course_vacancies\(\)[\s\S]*from public, anon, authenticated/
  );
  assert.match(
    currentMigration,
    /grant execute on function public\.get_public_course_vacancies\(\)[\s\S]*to anon, authenticated, service_role/
  );
});

test("course page loads cache-busted vacancy assets", function () {
  assert.match(coursePage, /home_vacancies\.css\?v=20261002-sold-out-1/);
  assert.match(coursePage, /home_vacancies\.js\?v=20261002-sold-out-1/);
  assert.match(coursePage, /Disponibilidade das turmas/);
});

test("sold-out cards always show zero and the required ribbon", function () {
  assert.match(vacanciesScript, /VAGAS ESGOTADAS/);
  assert.match(vacanciesScript, /const spots = soldOut \? 0/);
  assert.match(vacanciesScript, /row\.class_type === "individual"/);
  assert.match(vacanciesStyles, /home-vacancy-ribbon/);
  assert.match(vacanciesStyles, /transform:rotate\(34deg\)/);
  assert.match(vacanciesStyles, /background:#b42318/);
});

test("recovery baseline preserves the current course availability policy", function () {
  assert.match(recoveryOverlay, /tc\.class_type in \('quintet', 'individual'\)/);
  assert.match(recoveryOverlay, /actual_available_spots between 1 and 3/);
  assert.match(workflow, /125_show_sold_out_course_classes\.sql/);
});
