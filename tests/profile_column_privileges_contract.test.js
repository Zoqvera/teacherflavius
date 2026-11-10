"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("student profile writes never include administrative enrollment columns", () => {
  const sandbox = { window: {} };
  vm.runInNewContext(readProjectFile("student_data_utils.js"), sandbox);

  const input = {
    name: "Test Student",
    cpf: "12345678901",
    whatsapp: "34912345678",
    pixKey: "contact@example.com",
    availability: { seg: ["09"] }
  };
  const payload = sandbox.window.StudentDataUtils.buildProfilePayload({
    userId: "test-student-id",
    email: "contact@example.com",
    input,
    enrollmentCode: "not-client-authoritative",
    enrolled: true
  });

  assert.equal(payload.name, "Test Student");
  assert.equal(payload.profile_completed, true);
  assert.equal(payload.availability_seg_09, true);
  assert.equal(Object.hasOwn(payload, "enrolled"), false);
  assert.equal(Object.hasOwn(payload, "enrollment_code"), false);
});

test("optional profile editor does not submit administrative enrollment values", () => {
  const source = readProjectFile("student_profile_optional.js");
  const profilePayload = source.split("const payload = Object.assign({")[1].split("}, availabilityColumns")[0];

  assert.doesNotMatch(profilePayload, /\benrolled\s*:/);
  assert.doesNotMatch(profilePayload, /\benrollment_code\s*:/);
});

test("teacher class classification uses an authorized RPC", () => {
  const source = readProjectFile("tipo_turma_alunos.js");
  assert.match(source, /\.rpc\("set_teacher_student_profile_class_type"/);
  assert.doesNotMatch(source, /\.update\(\{ class_type:/);
});
