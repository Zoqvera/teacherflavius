const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const page = fs.readFileSync(
  path.join(__dirname, "..", "complete-cadastro.html"),
  "utf8"
);
const start = page.indexOf("    function configureFormForState(state) {");
const end = page.indexOf("    async function applyAuthorizedPlan(state) {", start);
const configureCode = page.slice(start, end);

function createNode() {
  return {
    hidden: false,
    required: false,
    disabled: false,
    textContent: "",
    value: "",
    classList: { toggle: function () {} },
    querySelector: function () { return { textContent: "" }; }
  };
}

function renderForm(mode) {
  const nodes = new Map();
  const document = {
    getElementById: function (id) {
      if (!nodes.has(id)) nodes.set(id, createNode());
      return nodes.get(id);
    },
    querySelector: function (selector) {
      if (!nodes.has(selector)) nodes.set(selector, createNode());
      return nodes.get(selector);
    }
  };
  const context = {
    document: document,
    authorizedInviteMode: mode,
    EXISTING_PROFILE_MODE: "existing_student_profile_completion",
    updateSubmitButton: function () {}
  };
  const state = {
    mode: "new_enrollment",
    requiresAccessCode: true,
    formUnlocked: true,
    requiresClassMode: true
  };
  vm.runInNewContext(
    configureCode + "\nconfigureFormForState(state);",
    Object.assign(context, { state: state })
  );
  return nodes;
}

test("the invitation form starts with the type-of-class question hidden", function () {
  assert.match(page, /<div id="classModeField" class="field full" hidden>/);
});

test("group link hides class selection and fixes the already-authorized mode", function () {
  const nodes = renderForm("group");
  assert.equal(nodes.get("classModeField").hidden, true);
  assert.equal(nodes.get("classMode").value, "group");
  assert.equal(nodes.get("classMode").required, false);
  assert.equal(nodes.get("classMode").disabled, true);
});

test("individual link also hides class selection", function () {
  const nodes = renderForm("individual");
  assert.equal(nodes.get("classModeField").hidden, true);
  assert.equal(nodes.get("classMode").value, "individual");
  assert.equal(nodes.get("classMode").required, false);
  assert.equal(nodes.get("classMode").disabled, true);
});

test("legacy code flow keeps the required selection until migration", function () {
  const nodes = renderForm(null);
  assert.equal(nodes.get("classModeField").hidden, false);
  assert.equal(nodes.get("classMode").required, true);
  assert.equal(nodes.get("classMode").disabled, false);
});

test("submission derives the class from the server-authorized invitation mode", function () {
  assert.match(
    page,
    /const classMode = authorizedInviteMode \|\| document\.getElementById\("classMode"\)\.value;/
  );
  assert.match(
    page,
    /const state = await refreshOnboardingState\(\);\s*await applyAuthorizedPlan\(state\);\s*configureFormForState\(state\);/
  );
  assert.match(page, /rpc\("get_my_authorized_enrollment_plan"\)/);
});
