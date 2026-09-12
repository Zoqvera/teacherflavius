const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadUtils() {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "student_data_utils.js"),
    "utf8"
  );
  const context = { window: {} };
  vm.runInNewContext(source, context);
  return context.window.StudentDataUtils;
}

function validEnrollmentInput(password) {
  return {
    name: "Student",
    email: "student@example.com",
    password: password,
    cpf: "12345678901",
    whatsapp: "11999999999",
    pixKey: "student@example.com",
    availability: { seg: ["09"] }
  };
}

test("rejects enrollment passwords shorter than twelve characters", function () {
  const utils = loadUtils();

  assert.throws(
    function () {
      utils.validateStudentInput(
        validEnrollmentInput("12345678901"),
        "Preencha todos os campos da matrícula.",
        { requireEnrollmentCredentials: true }
      );
    },
    /pelo menos 12 caracteres/
  );
});

test("accepts enrollment passwords with at least twelve characters", function () {
  const utils = loadUtils();

  assert.doesNotThrow(function () {
    utils.validateStudentInput(
      validEnrollmentInput("strong-pass-12"),
      "Preencha todos os campos da matrícula.",
      { requireEnrollmentCredentials: true }
    );
  });
});

test("profile validation does not require enrollment credentials", function () {
  const utils = loadUtils();
  const input = validEnrollmentInput("");
  input.email = "";

  assert.doesNotThrow(function () {
    utils.validateStudentInput(input, "Preencha os campos obrigatórios.");
  });
});
