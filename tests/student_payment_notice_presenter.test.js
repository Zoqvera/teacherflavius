const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const presenterPath = path.resolve(__dirname, "..", "student_payment_notice_presenter.js");
global.window = {};
require(presenterPath);
const presenter = global.window.StudentPaymentNoticePresenter;

test("detecta pagamentos que aguardam confirmação", function () {
  const waiting = {
    provider_payment_id: "payment-1",
    attempt_status: "pending"
  };
  const completed = {
    provider_payment_id: "payment-2",
    attempt_status: "approved"
  };

  assert.equal(presenter.hasPaymentWaiting([completed, waiting]), true);
  assert.equal(presenter.hasPaymentWaiting([completed]), false);
});

test("prioriza mensalidades vencidas e mantém a cobrança mais antiga para o modal", function () {
  const oldest = {
    tuition_id: "tuition-1",
    payment_status: "overdue",
    reference_month: "2026-08-01",
    due_date: "2026-08-10",
    amount_due: 150
  };
  const upcoming = {
    tuition_id: "tuition-2",
    payment_status: "due_today",
    reference_month: "2026-09-01",
    due_date: "2026-09-02",
    amount_due: 150
  };

  const notice = presenter.createNotice([oldest, upcoming]);

  assert.equal(notice.tone, "overdue");
  assert.equal(notice.modalTuition, oldest);
  assert.equal(notice.summary.title, "Você possui uma mensalidade vencida");
});

test("usa aviso de vencimento quando não há mensalidade vencida", function () {
  const upcoming = {
    tuition_id: "tuition-2",
    payment_status: "due_tomorrow",
    reference_month: "2026-09-01",
    due_date: "2026-09-03",
    amount_due: 150
  };

  const notice = presenter.createNotice([upcoming]);

  assert.equal(notice.tone, "warning");
  assert.equal(notice.modalTuition, null);
  assert.match(notice.summary.banner, /vence amanhã/);
});

test("usa pagamento aguardando confirmação como fallback", function () {
  const waiting = {
    tuition_id: "tuition-3",
    payment_status: "open",
    reference_month: "2026-09-01",
    due_date: "2026-09-10",
    amount_due: 150,
    provider_payment_id: "payment-3",
    attempt_status: "in_process"
  };

  const notice = presenter.createNotice([waiting]);

  assert.equal(notice.tone, "warning");
  assert.equal(notice.modalTuition, null);
  assert.match(notice.summary.banner, /Pagamento aguardando confirmação/);
});

test("não cria aviso sem mensalidades relevantes", function () {
  assert.equal(presenter.createNotice([]), null);
  assert.equal(presenter.createNotice([{ payment_status: "future" }]), null);
});
