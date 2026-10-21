const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(
  path.join(root, "area-do-estudante/minhas-aulas/app.js"), "utf8"
);
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20261020225137_add_my_lesson_forecast.sql"),
  "utf8"
);

function futureDate(daysFromNow) {
  return new Date(Date.now() + daysFromNow * 86400000).toISOString();
}

function makeLesson(status, daysFromNow) {
  return {
    status,
    class_number: 29,
    class_name: "Turma 29",
    starts_at: futureDate(daysFromNow)
  };
}

async function renderStudentPage({ paid = true, forecast, forecastFails = false }) {
  const elements = {
    loginStatus: { textContent: "" },
    pageMessage: { textContent: "", className: "", hidden: true },
    myClassesContent: { innerHTML: "" }
  };
  const rpcCalls = [];
  const data = {
    get_my_lessons_overview: {
      is_paid: paid,
      has_paid_before: true,
      available_credits: 0,
      classes_per_month: 4,
      classes: [{ class_number: 29, class_name: "Turma 29", class_start_time: "10:00" }]
    },
    get_my_lesson_credits: [1, 2, 3, 4].map(function (day) {
      return {
        ...makeLesson("scheduled", day),
        credit_id: "credit-" + day,
        can_cancel: true,
        cancellation_deadline: futureDate(day - 1)
      };
    }),
    get_my_lesson_forecast: forecast
  };
  const auth = {
    isConfigured: () => true,
    getSession: async () => ({ user: { id: "test-student", email: "student@example.test" } }),
    getClient: () => ({
      rpc: async (name) => {
        rpcCalls.push(name);
        if (name === "get_my_lesson_forecast" && forecastFails) {
          return { data: null, error: new Error("Service unavailable") };
        }
        assert.ok(Object.hasOwn(data, name), "Unexpected RPC: " + name);
        return { data: data[name], error: null };
      }
    })
  };

  const mockWindow = { Auth: auth, SUPABASE_CONFIG: {}, setTimeout, confirm: () => true };
  vm.runInNewContext(app, {
    Auth: auth,
    window: mockWindow,
    console: { warn: () => {} },
    document: {
      getElementById: (id) => elements[id] || null,
      querySelectorAll: () => [],
      body: { classList: { remove: () => {}, add: () => {} } }
    },
    Date,
    Intl,
    Number,
    String,
    Promise
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  return { html: elements.myClassesContent.innerHTML, rpcCalls };
}

test("four paid lessons appear with four non-actionable predicted lessons", async () => {
  const page = await renderStudentPage({
    forecast: {
      prepaid_lessons: [],
      predicted_lessons: [5, 6, 7, 8].map((day) => makeLesson("predicted", day)),
      next_payment_due_date: "2026-11-05"
    }
  });
  assert.equal((page.html.match(/AULA PREVISTA/g) || []).length, 4);
  assert.equal((page.html.match(/>CONFIRMADA<\/span>/g) || []).length, 4);
  assert.match(page.html, /Próximo vencimento: 05\/11\/2026/);
  assert.match(page.html, /href="\/pagamento\/"/);

  const forecastSection = page.html.split('class="surface-card forecast-section"')[1];
  assert.ok(forecastSection);
  assert.doesNotMatch(forecastSection, /data-credit-id|regular-cancel-button|ACESSAR AULA|MARCAR REPOSIÇÃO/);
  assert.ok(page.rpcCalls.includes("get_my_lesson_forecast"));
});

test("advance payment confirms future lessons and leaves a following forecast", async () => {
  const page = await renderStudentPage({
    forecast: {
      prepaid_lessons: [5, 6, 7, 8].map((day) => makeLesson("confirmed", day)),
      predicted_lessons: [9, 10, 11, 12].map((day) => makeLesson("predicted", day)),
      next_payment_due_date: null
    }
  });
  assert.equal((page.html.match(/AULA PREVISTA/g) || []).length, 4);
  assert.equal((page.html.match(/>CONFIRMADA<\/span>/g) || []).length, 8);
  assert.doesNotMatch(page.html, /Próximo vencimento:/);
});

test("previously paying student can see forecast even when current tuition is outstanding", async () => {
  const page = await renderStudentPage({
    paid: false,
    forecast: {
      prepaid_lessons: [],
      predicted_lessons: [1, 2, 3, 4].map((day) => makeLesson("predicted", day)),
      next_payment_due_date: "2026-10-20"
    }
  });
  assert.equal((page.html.match(/AULA PREVISTA/g) || []).length, 4);
  assert.ok(!page.rpcCalls.includes("get_my_lesson_credits"));
  assert.doesNotMatch(page.html, /data-credit-id|regular-cancel-button/);
});

test("a forecast service failure does not hide confirmed lesson cards", async () => {
  const page = await renderStudentPage({ forecastFails: true });
  assert.match(page.html, /A previsão das próximas aulas está indisponível/);
  assert.equal((page.html.match(/>CONFIRMADA<\/span>/g) || []).length, 4);
});

test("the forecast RPC is read-only, identity-scoped, and honors start dates", () => {
  assert.match(migration, /auth\.uid\(\)/i);
  assert.match(migration, /where membership\.user_id = caller_id/i);
  assert.match(migration, /tuition\.student_id = caller_id/i);
  assert.match(migration, /credit\.revoked_at is null/i);
  assert.match(migration, /membership\.first_lesson_date/i);
  assert.match(migration, /class\.first_lesson_date/i);
  assert.match(migration, /membership\.created_at/i);
  assert.match(migration, /not exists \([\s\S]*private\.get_tuition_coverage_end/i);
  assert.match(migration, /revoke all on function public\.get_my_lesson_forecast\(\) from public, anon/i);
  assert.doesNotMatch(migration, /insert into private\.lesson_credits|update private\.lesson_credits|delete from private\.lesson_credits/i);
});
