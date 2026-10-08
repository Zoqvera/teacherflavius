"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { checkSqlFile, gitBlobSha, validateRepository } = require("../scripts/check_sql_class_taxonomy");

const root = path.resolve(__dirname, "..");
const historical = JSON.parse(
  fs.readFileSync(path.join(root, ".github/legacy-sql-class-type-lock.json"), "utf8")
);
const retired = [
  "supabase_tipo_turma_alunos.sql",
  "supabase_compatibilidade_tipo_turma.sql",
  "supabase_limite_excepcional_quinta_21h.sql",
  "supabase_limite_excepcional_turma_9_mon_21h.sql"
];

test("rejects obsolete SQL identifiers in any new manual script or migration", () => {
  for (const term of ["QUARTETO", "8 ALUNOS", "quartet", "eight_students", "get_public_quartet_vacancies"]) {
    const sql = "select '" + term + "';";
    assert.equal(checkSqlFile("supabase/new_file.sql", sql, historical).length, 1);
    assert.equal(checkSqlFile("supabase/migrations/20261009000000_new.sql", sql, historical).length, 1);
  }
});

test("accepts only the active classifications", () => {
  const sql = "check (class_type in ('INDIVIDUAL', 'QUINTETO', 'individual', 'quintet'));";
  assert.deepEqual(checkSqlFile("supabase/migrations/new.sql", sql, historical), []);
});

test("keeps historical SQL immutable and permits intentional conversion history", () => {
  const historicalPath = "supabase/migrations/20261007012501_enforce_quintet_only_group_classification.sql";
  const original = fs.readFileSync(path.join(root, historicalPath));
  assert.equal(gitBlobSha(original), historical[historicalPath]);
  assert.deepEqual(checkSqlFile(historicalPath, original, historical), []);
  assert.equal(checkSqlFile(historicalPath, Buffer.concat([original, Buffer.from("\n-- edit")]), historical).length, 1);
});

test("retired manual entry points fail before executing DDL or DML", () => {
  for (const file of retired) {
    const content = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(content, /^-- RETIRED MANUAL SQL/);
    assert.match(content, /RAISE EXCEPTION/);
    assert.doesNotMatch(content, /\b(?:create|alter|drop|update|insert|delete)\s+(?:table|function|into|public\.)/i);
    assert.deepEqual(checkSqlFile(file, content, historical), []);
  }
});

test("the SQL taxonomy guard passes for the repository", () => {
  assert.deepEqual(validateRepository(root, historical), []);
});
