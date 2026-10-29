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

async function renderStudentPage({ paid = true, forecast, forecastFails = false, credits = null }) {
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
    get_my_lesson_credits: credits || [1, 2, 3, 4].map(function (day) {
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

  // The confirmed and predicted items share one chronological agenda.
  assert.match(page.html, /<h2>Minhas aulas<\/h2>/);
  const predictedCards = page.html.match(/<article class="lesson-card forecast-lesson"[\s\S]*?<\/article>/g) || [];
  assert.equal(predictedCards.length, 4);
  predictedCards.forEach((card) => {
    assert.doesNotMatch(card, /data-credit-id|regular-cancel-button|ACESSAR AULA|MARCAR REPOSIÇÃO/);
  });
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
      predicted_lessons: [5, 6, 7, 8].map((day) => makeLesson("predicted", day)),
      next_payment_due_date: "2026-10-20"
    }
  });
  assert.equal((page.html.match(/AULA PREVISTA/g) || []).length, 4);
  assert.ok(page.rpcCalls.includes("get_my_lesson_credits"));
  assert.equal((page.html.match(/>CONFIRMADA<\/span>/g) || []).length, 4);
  assert.match(page.html, /regular-cancel-button/);
});

test("the same paid class cannot appear twice as both credit and prepaid forecast", async () => {
  const startsAt = futureDate(8);
  const paidCredit = {
    status: "scheduled",
    class_number: 29,
    class_name: "Turma 29",
    starts_at: startsAt,
    credit_id: "already-paid",
    can_cancel: true,
    cancellation_deadline: futureDate(7)
  };
  const page = await renderStudentPage({
    paid: false,
    credits: [paidCredit],
    forecast: {
      prepaid_lessons: [{ ...paidCredit, status: "confirmed" }],
      predicted_lessons: [{ ...paidCredit, status: "predicted" }],
      next_payment_due_date: "2026-11-05"
    }
  });
  assert.equal((page.html.match(/>CONFIRMADA<\/span>/g) || []).length, 1);
  assert.equal((page.html.match(/AULA PREVISTA/g) || []).length, 0);
  assert.equal((page.html.match(/regular-cancel-button/g) || []).length, 1);
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


test("two unpaid preview dates allow cancellation without paid lesson access", async () => {
  const future = [5, 6].map((day) => ({
    ...makeLesson("predicted", day),
    can_cancel: true,
    cancellation_deadline: futureDate(day - 1)
  }));
  const page = await renderStudentPage({
    forecast: {
      prepaid_lessons: [],
      predicted_lessons: future,
      next_payment_due_date: "2026-11-05"
    }
  });

  assert.equal((page.html.match(/AULA PREVISTA/g) || []).length, 2);
  assert.equal((page.html.match(/class="secondary-button forecast-cancel-button"/g) || []).length, 2);
  const previewCards = page.html.match(/<article class="lesson-card forecast-lesson"[\s\S]*?<\/article>/g) || [];
  assert.equal(previewCards.length, 2);
  previewCards.forEach((card) => {
    assert.match(card, /CANCELAR ESTA AULA/);
    assert.doesNotMatch(card, /ACESSAR AULA|MARCAR REPOSIÇÃO|regular-cancel-button|data-credit-id/);
  });
});

test("advance-cancelled unpaid preview remains visible but is no longer actionable", async () => {
  const preview = [
    { ...makeLesson("cancelled_pending", 5), can_cancel: false },
    { ...makeLesson("predicted", 6), can_cancel: true, cancellation_deadline: futureDate(5) }
  ];
  const page = await renderStudentPage({
    paid: false,
    forecast: {
      prepaid_lessons: [],
      predicted_lessons: preview,
      next_payment_due_date: "2026-11-05"
    }
  });

  assert.equal((page.html.match(/AULA PREVISTA CANCELADA/g) || []).length, 1);
  assert.equal((page.html.match(/forecast-cancel-button/g) || []).length, 1);
  assert.match(page.html, /Cancelamento antecipado registrado/);
  assert.match(page.html, /Próximo vencimento: 05\/11\/2026/);
});

test("new forecast migration separates unpaid cancellations from paid contract credits", () => {
  const changes = fs.readFileSync(
    path.join(root, "supabase/migrations/20261029144549_enable_two_unpaid_cancellable_lessons.sql"),
    "utf8"
  );
  assert.match(changes, /preview_limit := 2/i);
  assert.match(changes, /last_paid_lesson_date \+ 1/i);
  assert.match(changes, /student_regular_lesson_cancellations/i);
  assert.match(changes, /CREATE TABLE IF NOT EXISTS private\.unpaid_lesson_cancellations/i);
  assert.match(changes, /private\.lesson_cancellation_grants_credit/i);
  assert.match(changes, /public\.cancel_my_unpaid_lesson/i);
  assert.match(changes, /pg_catalog\.pg_advisory_xact_lock/i);
  assert.match(changes, /REVOKE ALL ON TABLE private\.unpaid_lesson_cancellations FROM PUBLIC, anon, authenticated/i);
  assert.match(changes, /THEN 'cancelled_pending'/i);
  assert.match(changes, /'credit_granted', false/i);
  assert.match(changes, /tuition\.payment_date IS NOT NULL/i);
  assert.match(changes, /THEN 'available'[\s\S]*ELSE 'forfeited'/i);
  assert.doesNotMatch(changes, /INSERT INTO private\.lesson_credits/i);
});
