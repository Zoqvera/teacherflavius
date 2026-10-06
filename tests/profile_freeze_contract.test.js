const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("profile page has only one Google identity mutation authority", function () {
  const profile = read("perfil.html");

  assert.doesNotMatch(profile, /enforceGoogleOnlyCopy/);
  assert.doesNotMatch(profile, /googleCopyObserver/);
  assert.doesNotMatch(profile, /new MutationObserver\(enforceGoogleOnlyCopy\)/);
});

test("Google-only profile copy updates are idempotent under repeated mutations", async function () {
  let mutationCallback = null;
  let statusWrites = 0;
  let statusValue = "Conta Google vinculada. Você pode entrar com Google ou com seu login atual.";

  const status = {
    classList: { add: function () {} },
    get textContent() { return statusValue; },
    set textContent(value) {
      statusWrites += 1;
      statusValue = value;
    }
  };
  const button = { hidden: false };

  class FakeMutationObserver {
    constructor(callback) {
      mutationCallback = callback;
    }
    observe() {}
  }

  const auth = {
    getClient: function () { return null; },
    getSession: async function () { return null; },
    getUserIdentities: async function () { return []; }
  };

  const context = {
    window: {
      __teacherFlaviusGoogleOnlyAccessLoaded: false,
      ResourceWaiter: {
        waitUntil: async function () { return true; }
      },
      Auth: auth,
      location: {
        pathname: "/perfil/",
        search: "",
        hash: "",
        replace: function () {}
      },
      setTimeout: function (callback) { callback(); }
    },
    Auth: auth,
    ResourceWaiter: {
      waitUntil: async function () { return true; }
    },
    document: {
      readyState: "complete",
      documentElement: {},
      getElementById: function (id) {
        if (id === "googleIdentityStatus") return status;
        if (id === "linkGoogleButton") return button;
        return null;
      }
    },
    MutationObserver: FakeMutationObserver,
    console: { warn: function () {} }
  };

  context.window.MutationObserver = FakeMutationObserver;
  vm.createContext(context);
  vm.runInContext(read("google_only_access.js"), context);

  await new Promise(function (resolve) { setImmediate(resolve); });

  assert.equal(typeof mutationCallback, "function");
  assert.equal(statusWrites, 1);
  assert.equal(button.hidden, true);

  mutationCallback([]);
  mutationCallback([]);

  assert.equal(statusWrites, 1, "Repeated DOM mutations must not rewrite the same status text");
});

test("profile route and runtime config use the cache-busted fixed access script", function () {
  const runtimeConfig = read("site_runtime_config.js");
  const profile = read("perfil.html");
  const wrapper = read("perfil/index.html");

  assert.match(runtimeConfig, /google_only_access\.js\?v=20261006-profile-freeze-1/);
  assert.match(profile, /site_runtime_config\.js\?v=20261006-profile-freeze-1/);
  assert.match(wrapper, /site_runtime_config\.js\?v=20261006-profile-freeze-1/);
});
