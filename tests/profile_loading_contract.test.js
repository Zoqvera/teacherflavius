"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function loadOptionalProfileModule(auth) {
  const context = {
    Auth: auth,
    window: { Auth: auth }
  };
  vm.createContext(context);
  vm.runInContext(read("student_profile_optional.js"), context);
}

test("optional profile module uses the public session API and preserves enrollment state", async function () {
  let savedPayload = null;
  let metadataPayload = null;
  const currentProfile = {
    email: "student@example.com",
    enrollment_code: "ABCDE",
    enrolled: true,
    pix_key: "",
    availability: {}
  };

  const client = {
    from: function (table) {
      assert.equal(table, "profiles");
      return {
        upsert: function (payload) {
          savedPayload = payload;
          return {
            select: function () {
              return {
                single: async function () {
                  return { data: payload, error: null };
                }
              };
            }
          };
        }
      };
    },
    auth: {
      updateUser: async function (payload) {
        metadataPayload = payload;
        return { data: {}, error: null };
      }
    }
  };

  const auth = {
    getClient: function () { return client; },
    getSession: async function () {
      return { user: { id: "student-1", email: "student@example.com" } };
    },
    getProfile: async function () { return currentProfile; },
    ensureProfileForUser: async function () { return currentProfile; }
  };

  loadOptionalProfileModule(auth);

  assert.equal(typeof auth.updateProfile, "function");
  const saved = await auth.updateProfile({
    name: "Student Name",
    cpf: "123.456.789-01",
    whatsapp: "(34) 99999-9999",
    pix_key: "",
    availability: {}
  });

  assert.equal(saved.id, "student-1");
  assert.equal(savedPayload.enrolled, true);
  assert.equal(savedPayload.enrollment_code, "ABCDE");
  assert.equal(savedPayload.pix_key, "");
  assert.deepEqual(savedPayload.availability, {});
  assert.equal(metadataPayload.data.enrolled, true);
  assert.equal(metadataPayload.data.enrollment_code, "ABCDE");
});

test("clean profile route refreshes auth assets without depending on exact whitespace", function () {
  const loader = read("clean_route_loader.js");
  const wrapper = read("perfil/index.html");

  assert.equal(
    loader.includes('/<script src="\\/?auth\\.js\\?v=[^"]+"><\\/script>/'),
    true
  );
  assert.equal(loader.includes("/auth.js?v=20261003-profile-1"), true);
  assert.equal(loader.includes("/student_profile_optional.js?v=20261003-profile-1"), true);
  assert.equal(wrapper.includes("/clean_route_loader.js?v=20261003-profile-1"), true);
});

test("profile page replaces indefinite loading with authenticated fallback and error state", function () {
  const profile = read("perfil.html");
  const fallbackIndex = profile.indexOf("renderProfile(null, user);");
  const fetchIndex = profile.indexOf("const profile = await Auth.getProfile();");

  assert.ok(fallbackIndex >= 0, "Authenticated fallback render must exist");
  assert.ok(fetchIndex > fallbackIndex, "Fallback must render before the profile request finishes");
  assert.equal(profile.includes('console.error("Não foi possível carregar o perfil:", error);'), true);
  assert.equal(
    profile.includes('setMessage("Não foi possível atualizar os dados do perfil. Recarregue a página.", "error");'),
    true
  );
});
