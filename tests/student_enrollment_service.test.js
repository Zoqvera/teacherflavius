const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadEnrollmentService() {
  const context = { window: {}, console: console, Math: Math };
  const utilsSource = fs.readFileSync(
    path.join(__dirname, "..", "student_data_utils.js"),
    "utf8"
  );
  const serviceSource = fs.readFileSync(
    path.join(__dirname, "..", "student_enrollment_service.js"),
    "utf8"
  );

  vm.runInNewContext(utilsSource, context);
  vm.runInNewContext(serviceSource, context);
  return context.window.StudentEnrollmentService;
}

function createClient(signUpCalls, profileCalls) {
  return {
    auth: {
      signUp: async function (payload) {
        signUpCalls.push(payload);
        return { data: { user: { id: "user-1" } }, error: null };
      }
    },
    from: function (table) {
      assert.equal(table, "profiles");
      return {
        upsert: async function (payload) {
          profileCalls.push(payload);
          return { data: payload, error: null };
        }
      };
    }
  };
}

test("generic signup rejects an eleven-character password before Supabase", async function () {
  const signUpCalls = [];
  const profileCalls = [];
  const client = createClient(signUpCalls, profileCalls);
  const service = loadEnrollmentService().create({
    requireClient: function () { return client; },
    getRedirectUrl: function () { return "https://teacherflavius.com/perfil/"; }
  });

  await assert.rejects(
    service.signUp("Student", "student@example.com", "12345678901"),
    /pelo menos 12 caracteres/
  );

  assert.equal(signUpCalls.length, 0);
  assert.equal(profileCalls.length, 0);
});

test("generic signup accepts twelve characters and keeps the trusted redirect", async function () {
  const signUpCalls = [];
  const profileCalls = [];
  const client = createClient(signUpCalls, profileCalls);
  const service = loadEnrollmentService().create({
    requireClient: function () { return client; },
    getRedirectUrl: function () { return "https://teacherflavius.com/perfil/"; }
  });

  const result = await service.signUp(
    "Student",
    "student@example.com",
    "123456789012"
  );

  assert.equal(result.user.id, "user-1");
  assert.equal(signUpCalls.length, 1);
  assert.equal(signUpCalls[0].password, "123456789012");
  assert.equal(
    signUpCalls[0].options.emailRedirectTo,
    "https://teacherflavius.com/perfil/"
  );
  assert.equal(profileCalls.length, 1);
  assert.equal(profileCalls[0].id, "user-1");
});
