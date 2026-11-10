"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const version = "20261110-profile-permissions-1";

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

const references = [
  ["clean_route_loader.js", "student_profile_optional.js"],
  ["matricula80/index.html", "student_profile_optional.js"],
  ["complete-cadastro.html", "student_profile_optional.js"],
  ["perfil/index.html", "clean_route_loader.js"],
  ["perfil-dos-alunos/loader.js", "tipo_turma_alunos.js"],
  ["perfil-dos-alunos/index.html", "perfil-dos-alunos/loader.js"],
  ["global_logout.js", "student_data_utils.js"],
  ["student_payment_notice.js", "student_data_utils.js"],
  ["student_policy_notice.js", "student_data_utils.js"],
  ["recuperar-senha/index.html", "student_data_utils.js"],
  ["scripts/static_site_dependencies.py", "student_data_utils.js"]
];

test("every changed browser script is served through the new versioned URL", () => {
  for (const [file, asset] of references) {
    const source = read(file);
    assert.ok(
      source.includes(`${asset}?v=${version}`),
      `${file} must reference the current version of ${asset}`
    );
  }
});

test("student profile payloads omit server-controlled enrollment fields", () => {
  const studentData = read("student_data_utils.js");
  const optionalProfile = read("student_profile_optional.js");

  const corePayload = studentData.split("function buildProfilePayload(options) {")[1]
    .split("function buildUserMetadata")[0];
  const optionalPayload = optionalProfile.split("const payload = Object.assign({")[1]
    .split("}, availabilityColumns")[0];

  for (const payload of [corePayload, optionalPayload]) {
    assert.doesNotMatch(payload, /\\benrolled\\s*:/);
    assert.doesNotMatch(payload, /\\benrollment_code\\s*:/);
  }
});

test("teacher class classification uses an authorized server operation", () => {
  const teacherClient = read("tipo_turma_alunos.js");

  assert.match(teacherClient, /\\.rpc\\("set_teacher_student_profile_class_type"/);
  assert.doesNotMatch(teacherClient, /\\.update\\(\\{ class_type:/);
});
