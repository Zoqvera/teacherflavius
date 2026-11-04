const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { createController } = require("../teacher_mfa_setup.js");

function createMockMfa() {
  const calls = [];
  const factors = [
    { id: "stale", status: "unverified" }
  ];
  let currentLevel = "aal1";

  const mfa = {
    async listFactors() {
      calls.push("list");
      return { data: { totp: factors }, error: null };
    },
    async getAuthenticatorAssuranceLevel() {
      calls.push("aal");
      return { data: { currentLevel, nextLevel: "aal2" }, error: null };
    },
    async unenroll({ factorId }) {
      calls.push("unenroll:" + factorId);
      const index = factors.findIndex(item => item.id === factorId);
      if (index >= 0) factors.splice(index, 1);
      return { data: { id: factorId }, error: null };
    },
    async enroll({ factorType, friendlyName }) {
      calls.push("enroll:" + factorType);
      assert.equal(friendlyName, "Teacher Flávio");
      factors.push({ id: "new-totp-factor", status: "unverified" });
      return {
        data: {
          id: "new-totp-factor",
          totp: {
            secret: "TEST-NEVER-PERSIST",
            qr_code: "data:image/svg+xml;base64,PHN2Zy8+"
          }
        },
        error: null
      };
    },
    async challenge({ factorId }) {
      calls.push("challenge:" + factorId);
      return { data: { id: "challenge-1" }, error: null };
    },
    async verify({ factorId, challengeId, code }) {
      calls.push("verify:" + factorId);
      assert.equal(challengeId, "challenge-1");
      if (code !== "123456") {
        return { data: null, error: new Error("Invalid code") };
      }
      const target = factors.find(item => item.id === factorId);
      if (target) target.status = "verified";
      currentLevel = "aal2";
      return { data: { access_token: "mock" }, error: null };
    }
  };

  return { mfa, calls, factors, setLevel: value => { currentLevel = value; } };
}

test("the MFA controller does not expose administration to a student", async () => {
  const mock = createMockMfa();
  const controller = createController({
    getClient: () => { throw new Error("Not authorized"); },
    isTeacherAdmin: async () => false
  });
  assert.deepEqual(await controller.getStatus(), { allowed: false });
  await assert.rejects(controller.beginEnrollment(), /não está disponível/);
  assert.deepEqual(mock.calls, []);
});

test("teacher can enroll, discard unverified factors and verify AAL2", async () => {
  const fake = createMockMfa();
  const controller = createController({
    getClient: () => ({ auth: { mfa: fake.mfa } }),
    isTeacherAdmin: async () => true
  });

  assert.deepEqual(await controller.getStatus(), {
    allowed: true, enrolled: false, verified: false
  });

  const enrollment = await controller.beginEnrollment();
  assert.equal(enrollment.secret, "TEST-NEVER-PERSIST");
  assert.match(enrollment.qrCode, /^data:image\/svg\+xml/);
  assert.ok(fake.calls.includes("unenroll:stale"));

  const result = await controller.verifyCode("123456");
  assert.deepEqual(result, {
    allowed: true, enrolled: true, verified: true
  });
  assert.ok(fake.calls.includes("challenge:new-totp-factor"));
  assert.ok(fake.calls.includes("verify:new-totp-factor"));
  assert.ok(!Object.keys(controller).includes("secret"));
});

test("verified teacher factor can elevate a subsequent AAL1 session", async () => {
  const fake = createMockMfa();
  fake.factors.splice(0, 1, { id: "configured", status: "verified" });
  const controller = createController({
    getClient: () => ({ auth: { mfa: fake.mfa } }),
    isTeacherAdmin: async () => true
  });

  assert.deepEqual(await controller.getStatus(), {
    allowed: true, enrolled: true, verified: false
  });
  await controller.verifyCode("123456");
  assert.ok(fake.calls.includes("challenge:configured"));
  assert.ok(!fake.calls.some(action => action.startsWith("enroll:")));
});

test("invalid one-time codes cannot start a challenge", async () => {
  const fake = createMockMfa();
  const controller = createController({
    getClient: () => ({ auth: { mfa: fake.mfa } }),
    isTeacherAdmin: async () => true
  });

  await assert.rejects(controller.verifyCode("12345x"), /seis dígitos/);
  assert.ok(!fake.calls.includes("challenge:new-totp-factor"));
});

test("profile-only UI does not publish secrets or change SEO metadata", () => {
  const loader = fs.readFileSync(
    path.join(__dirname, "..", "auth_infrastructure.js"),
    "utf8"
  );
  const source = fs.readFileSync(
    path.join(__dirname, "..", "teacher_mfa_setup.js"),
    "utf8"
  );

  assert.match(loader, /if \(pathname !== PATHS\.profile\) return/);
  assert.match(loader, /teacher_mfa_setup\.js/);
  assert.match(source, /isTeacherAdmin/);
  assert.match(source, /getAuthenticatorAssuranceLevel/);
  assert.match(source, /mfa\.verify\(/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|innerHTML|console\.log/);
  assert.doesNotMatch(source, /<meta\b|<link rel=|<title>/i);
});
