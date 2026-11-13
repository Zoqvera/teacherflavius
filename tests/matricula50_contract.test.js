"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

function enrollmentFields(page) {
  return [...page.matchAll(/<input\b[^>]*\bid="([^"]+)"[^>]*>/g)]
    .map((match) => match[1]);
}

test("matricula50 uses exactly the same student fields as matricula80", () => {
  const fifty = read("matricula50/index.html");
  const eighty = read("matricula80/index.html");
  assert.deepEqual(enrollmentFields(fifty), enrollmentFields(eighty));
  assert.deepEqual(enrollmentFields(fifty), ["fullName", "cpf", "birthDate", "whatsapp"]);
  assert.match(fifty, /R\$ 50<span>,00<\/span>/);
  assert.match(fifty, /\/login\/\?next=%2Fmatricula50%2F/);
  assert.match(fifty, /https:\/\/teacherflavius\.com\/matricula50\//);
  assert.match(fifty, /name="robots" content="noindex,nofollow"/);
  assert.match(fifty, /professor enviará pelo WhatsApp a chave Pix/);
  assert.match(fifty, /href="\/matricula-concluida\/"/);
  assert.doesNotMatch(fifty, /sdk\.mercadopago\.com|http2\.mlstatic\.com|href="\/pagamento\//);
});

test("Google sign-in preserves the R$50 enrollment destination", () => {
  const login = read("login.html");
  assert.match(login, /destination === "\/matricula50\/"/);
  assert.match(login, /destination\.startsWith\("\/matricula50\/\?"\)/);
});

test("R$50 promotional offer is server-authenticated and linked to Instagram", () => {
  const sql = read("supabase/migrations/20261113111331_matricula50_manual_pix_offer_and_campaign.sql");
  assert.match(sql, /'matricula50'[\s\S]*?50\.00, 4, 'group', true/);
  assert.match(sql, /authorize_my_enrollment_link\(promotion\.token\)/);
  assert.match(sql, /'instagram'/);
  assert.match(sql, /marketing_campaign_confirmed_students/);
  assert.match(sql, /'anuncio50'/);
  assert.match(sql, /grant execute on function public\.authorize_my_matricula50\(\) to authenticated/);
  assert.match(sql, /settings\.monthly_fee = 50\.00/);
});

test("R$50 enrollment registers a group student and displays manual Pix instructions, never payment checkout", async () => {
  const handlers = {};
  const ids = [
    "pageStatus", "googleStep", "detailsStep", "existingEnrollmentStep",
    "resumePaymentStep", "enrollmentForm", "submitEnrollment", "fullName",
    "cpf", "birthDate", "whatsapp", "signedInEmail", "paymentTerms"
  ];
  const nodes = Object.fromEntries(ids.map((id) => [id, {
    hidden: true,
    disabled: false,
    value: "",
    textContent: "",
    dataset: {},
    addEventListener: function (event, callback) { handlers[id + ":" + event] = callback; }
  }]));
  let completed = false;
  let registeredValues;
  const calls = [];
  const redirects = [];
  const client = {
    rpc: async function (name) {
      calls.push(name);
      if (name === "authorize_my_matricula50") {
        return { data: {
          ok: true, class_mode: "group", monthly_fee: 50,
          classes_per_month: 4, origin: "instagram", campaign_alias: "anuncio50"
        }, error: null };
      }
      if (name === "get_my_enrollment_checkout_policy") {
        return { data: {
          enabled_for_new_enrollments: true, applies: completed, first_paid: false
        }, error: null };
      }
      if (name === "set_my_enrollment_class_mode") {
        return { data: { class_type: "QUINTETO" }, error: null };
      }
      if (name === "set_my_enrollment_billing_terms") {
        return { data: { monthly_fee: 50, classes_per_month: 4 }, error: null };
      }
      throw new Error("Unexpected RPC: " + name);
    },
    from: function (table) {
      assert.equal(table, "profiles");
      return {
        update: function (payload) {
          assert.equal(payload.date_of_birth, "1990-05-05");
          return {
            eq: function () {
              return {
                select: function () {
                  return { single: async function () { return { error: null }; } };
                }
              };
            }
          };
        }
      };
    }
  };
  const user = { id: "student-1", email: "aluna@example.test" };
  const context = {
    window: {
      location: { pathname: "/matricula50/", replace: (path) => redirects.push(path) },
      Auth: {
        isConfigured: () => true,
        getClient: () => client,
        getSession: async () => ({ user }),
        ensureProfileForUser: async () => ({
          enrolled: false, profile_completed: false, archived: false
        }),
        getUser: async () => user,
        completeProfile: async function (values) {
          registeredValues = values;
          completed = true;
          return { enrolled: true };
        }
      },
      setTimeout: setTimeout
    },
    document: { getElementById: (id) => nodes[id] },
    console: console
  };
  vm.runInNewContext(read("matricula80/app.js"), context);
  for (let index = 0; index < 10 && nodes.detailsStep.hidden; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.equal(nodes.detailsStep.hidden, false);
  nodes.fullName.value = "Ana da Silva";
  nodes.cpf.value = "529.982.247-25";
  nodes.birthDate.value = "1990-05-05";
  nodes.whatsapp.value = "(34) 99999-9999";
  await handlers["enrollmentForm:submit"]({ preventDefault: () => {} });

  assert.equal(registeredValues.name, "Ana da Silva");
  assert.equal(registeredValues.cpf, "52998224725");
  assert.equal(registeredValues.whatsapp, "34999999999");
  assert.deepEqual(redirects, ["/matricula-concluida/"]);
  assert.ok(calls.includes("authorize_my_matricula50"));
  assert.ok(calls.includes("set_my_enrollment_billing_terms"));
  assert.ok(!calls.includes("authorize_my_matricula80"));
  assert.match(nodes.paymentTerms.textContent, /professor enviará pelo WhatsApp a chave Pix/);
});
