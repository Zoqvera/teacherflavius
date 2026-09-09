let paymentSession = null;
let pendingTuitions = [];
let selectedTuition = null;
let mercadoPago = null;
let bricksBuilder = null;
let paymentBrickController = null;
let statusScreenBrickController = null;
let paymentPollTimer = null;
let currentIdempotencyKey = null;

function sleep(milliseconds) {
  return new Promise(function (resolve) { window.setTimeout(resolve, milliseconds); });
}

async function waitForResources() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (window.Auth && window.SUPABASE_CONFIG && window.MercadoPago && Auth.isConfigured()) return true;
    await sleep(250);
  }
  return !!(window.Auth && window.SUPABASE_CONFIG && window.MercadoPago && Auth.isConfigured());
}

function redirectToLogin() {
  window.location.href = "/login/?next=" + encodeURIComponent("/pagamento/");
}

function formatCurrency(value) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : "—";
}

function formatReferenceMonth(value) {
  const date = new Date(String(value || "") + "T12:00:00");
  if (Number.isNaN(date.getTime())) return "Mensalidade";
  return date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function formatDate(value) {
  const date = new Date(String(value || "") + "T12:00:00");
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("pt-BR");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setPageMessage(message, type) {
  const element = document.getElementById("paymentPageMessage");
  if (!element) return;
  element.hidden = !message;
  element.className = "payment-message" + (type ? " " + type : "");
  element.textContent = message || "";
}

async function destroyBricks() {
  if (paymentBrickController) {
    try { await paymentBrickController.unmount(); } catch (error) { console.warn("Não foi possível desmontar o formulário de pagamento:", error); }
    paymentBrickController = null;
  }
  if (statusScreenBrickController) {
    try { await statusScreenBrickController.unmount(); } catch (error) { console.warn("Não foi possível desmontar o status do pagamento:", error); }
    statusScreenBrickController = null;
  }
  document.getElementById("paymentBrickContainer").innerHTML = "";
  document.getElementById("statusScreenBrickContainer").innerHTML = "";
}

function stopPaymentPolling() {
  if (paymentPollTimer) window.clearTimeout(paymentPollTimer);
  paymentPollTimer = null;
}

function getPaymentStorage() {
  try {
    return window.sessionStorage;
  } catch (_) {
    return null;
  }
}

function getPaymentUserId() {
  return paymentSession && paymentSession.user ? paymentSession.user.id : "";
}

function loadPaymentAttemptKey(tuitionId) {
  if (!window.PaymentIdempotency || !tuitionId) return null;
  return window.PaymentIdempotency.load(getPaymentStorage(), getPaymentUserId(), tuitionId);
}

function getOrCreatePaymentAttemptKey(tuitionId) {
  if (!window.PaymentIdempotency) return currentIdempotencyKey || window.crypto.randomUUID();
  return window.PaymentIdempotency.getOrCreate(
    getPaymentStorage(),
    getPaymentUserId(),
    tuitionId,
    function () { return window.crypto.randomUUID(); }
  );
}

function clearPaymentAttemptKey(tuitionId) {
  if (window.PaymentIdempotency && tuitionId) {
    window.PaymentIdempotency.clear(getPaymentStorage(), getPaymentUserId(), tuitionId);
  }
  if (!selectedTuition || String(selectedTuition.tuition_id) === String(tuitionId || "")) {
    currentIdempotencyKey = null;
  }
}

async function getFunctionFailure(error) {
  const fallbackMessage = error && error.message
    ? error.message
    : "Não foi possível processar o pagamento.";
  const failure = { message: fallbackMessage, code: "", status: null };
  if (!error) return failure;

  try {
    if (error.context && typeof error.context.clone === "function") {
      const status = Number(error.context.status);
      if (Number.isFinite(status) && status > 0) failure.status = status;
      const data = await error.context.clone().json();
      if (data && data.error) failure.message = data.error;
      if (data && data.code) failure.code = String(data.code);
    }
  } catch (_) {
    // Mantém os dados disponíveis no erro original.
  }

  return failure;
}

async function getFunctionError(error) {
  return (await getFunctionFailure(error)).message;
}

function shouldClearPaymentAttemptKey(failure) {
  if (!window.PaymentIdempotency) return true;
  return window.PaymentIdempotency.shouldClearAfterFailure(failure);
}

async function invokePaymentFunction(payload) {
  const response = await Auth.getClient().functions.invoke("create-mercado-pago-payment", {
    body: payload
  });
  if (response.error) throw response.error;
  return response.data || {};
}

async function loadPendingTuitions() {
  const response = await Auth.getClient().rpc("get_my_pending_tuitions");
  if (response.error) throw response.error;
  pendingTuitions = (response.data || []).slice().sort(function (first, second) {
    return String(first.due_date || "").localeCompare(String(second.due_date || ""));
  });
  return pendingTuitions;
}

async function reconcilePendingPayments(tuitionId) {
  const response = await Auth.getClient().functions.invoke("reconcile-mercado-pago-payments", {
    body: tuitionId ? { tuition_id: tuitionId } : {}
  });
  if (response.error) throw response.error;
  return response.data || {};
}

function renderTuitionList() {
  const list = document.getElementById("tuitionList");
  list.innerHTML = pendingTuitions.map(function (tuition) {
    const selected = selectedTuition && selectedTuition.tuition_id === tuition.tuition_id;
    const overdue = tuition.payment_status === "overdue";
    const statusLabel = tuition.attempt_status === "pending"
      ? "Aguardando Pix"
      : (overdue ? "Vencida" : "Em aberto");
    return '<button class="tuition-card' + (selected ? ' selected' : '') + '" type="button" data-tuition-id="' + escapeHtml(tuition.tuition_id) + '">' +
      '<span class="tuition-card__top"><strong>' + escapeHtml(formatReferenceMonth(tuition.reference_month)) + '</strong><span class="tuition-card__amount">' + escapeHtml(formatCurrency(tuition.amount_due)) + '</span></span>' +
      '<span class="tuition-card__bottom"><span>Vencimento: ' + escapeHtml(formatDate(tuition.due_date)) + '</span><span class="tuition-card__status' + (overdue ? ' overdue' : '') + '">' + statusLabel + '</span></span>' +
    '</button>';
  }).join("");

  list.querySelectorAll(".tuition-card").forEach(function (button) {
    button.addEventListener("click", function () {
      selectTuition(button.dataset.tuitionId);
    });
  });
}

function updateCheckoutHeading() {
  const title = document.getElementById("checkoutTitle");
  const description = document.getElementById("checkoutDescription");
  if (!selectedTuition) {
    title.textContent = "Escolha uma mensalidade";
    description.textContent = "Selecione uma cobrança para carregar as opções de pagamento.";
    return;
  }
  title.textContent = formatReferenceMonth(selectedTuition.reference_month) + " · " + formatCurrency(selectedTuition.amount_due);
  description.textContent = "Vencimento em " + formatDate(selectedTuition.due_date) + ". Escolha Pix ou cartão de crédito abaixo.";
}

async function renderPaymentBrick() {
  if (!selectedTuition || !bricksBuilder) return;
  stopPaymentPolling();
  await destroyBricks();
  currentIdempotencyKey = loadPaymentAttemptKey(selectedTuition.tuition_id);
  document.getElementById("retryPaymentButton").hidden = true;
  document.getElementById("paymentBrickLoading").hidden = false;

  const settings = {
    initialization: {
      amount: Number(selectedTuition.amount_due),
      payer: {
        email: paymentSession.user.email || ""
      }
    },
    customization: {
      paymentMethods: {
        bankTransfer: "all",
        creditCard: "all",
        minInstallments: 1,
        maxInstallments: 1
      },
      visual: {
        style: { theme: "dark" }
      }
    },
    callbacks: {
      onReady: function () {
        document.getElementById("paymentBrickLoading").hidden = true;
      },
      onSubmit: async function (submission) {
        currentIdempotencyKey = getOrCreatePaymentAttemptKey(selectedTuition.tuition_id);
        setPageMessage("Enviando o pagamento com segurança ao Mercado Pago...", "");
        try {
          const result = await invokePaymentFunction({
            action: "pay",
            tuition_id: selectedTuition.tuition_id,
            idempotency_key: currentIdempotencyKey,
            selected_payment_method: submission.selectedPaymentMethod,
            payment_data: submission.formData
          });

          if (!result.payment_id) throw new Error("O Mercado Pago não retornou o identificador do pagamento.");
          await renderStatusScreen(String(result.payment_id), result.status);
          setPageMessage(
            result.status === "approved"
              ? "Pagamento aprovado. Atualizando sua mensalidade..."
              : "Pagamento criado. A confirmação será atualizada automaticamente.",
            result.status === "approved" ? "success" : "warning"
          );
          startPaymentPolling(selectedTuition.tuition_id, 0);
        } catch (error) {
          const failure = await getFunctionFailure(error);
          if (shouldClearPaymentAttemptKey(failure)) {
            clearPaymentAttemptKey(selectedTuition.tuition_id);
          }
          setPageMessage(failure.message, "error");
          throw error;
        }
      },
      onError: function (error) {
        console.error("Erro do Mercado Pago Payment Brick:", error);
        setPageMessage("Não foi possível carregar ou validar os dados do pagamento. Tente novamente.", "error");
      }
    }
  };

  paymentBrickController = await bricksBuilder.create("payment", "paymentBrickContainer", settings);
}

async function renderStatusScreen(paymentId, status) {
  if (paymentBrickController) {
    await paymentBrickController.unmount();
    paymentBrickController = null;
  }
  document.getElementById("paymentBrickContainer").innerHTML = "";
  document.getElementById("paymentBrickLoading").hidden = true;
  const retryableStatus = ["rejected", "cancelled"].includes(status);
  document.getElementById("retryPaymentButton").hidden = !retryableStatus;
  if (retryableStatus && selectedTuition) clearPaymentAttemptKey(selectedTuition.tuition_id);

  statusScreenBrickController = await bricksBuilder.create("statusScreen", "statusScreenBrickContainer", {
    initialization: { paymentId: paymentId },
    customization: {
      visual: { showExternalReference: false }
    },
    callbacks: {
      onReady: function () {},
      onError: function (error) {
        console.error("Erro do Mercado Pago Status Screen Brick:", error);
        setPageMessage("O pagamento foi criado, mas o status não pôde ser exibido. Aguarde a confirmação automática.", "warning");
      }
    }
  });
}

async function selectTuition(tuitionId) {
  const tuition = pendingTuitions.find(function (item) { return String(item.tuition_id) === String(tuitionId); });
  if (!tuition) return;
  selectedTuition = tuition;
  renderTuitionList();
  updateCheckoutHeading();
  await renderPaymentBrick();
}

function showAllPaid(message) {
  stopPaymentPolling();
  if (selectedTuition) clearPaymentAttemptKey(selectedTuition.tuition_id);
  destroyBricks();
  document.getElementById("paymentWorkspace").hidden = true;
  document.getElementById("paymentSuccess").hidden = false;
  document.getElementById("paymentSuccessDescription").textContent = message || "Não há nenhuma mensalidade pendente nesta conta.";
  const globalBanner = document.getElementById("tf-tuition-payment-banner");
  if (globalBanner) globalBanner.remove();
  setPageMessage("Pagamento confirmado e mensalidade atualizada.", "success");
}

async function refreshAfterPayment(paidTuitionId) {
  const previousCount = pendingTuitions.length;
  await reconcilePendingPayments(paidTuitionId);
  await loadPendingTuitions();
  const stillPending = pendingTuitions.some(function (tuition) {
    return String(tuition.tuition_id) === String(paidTuitionId);
  });

  if (!stillPending) {
    clearPaymentAttemptKey(paidTuitionId);
    if (!pendingTuitions.length) {
      showAllPaid("Seu pagamento foi confirmado. Todas as mensalidades desta conta estão em dia.");
      return true;
    }

    await destroyBricks();
    selectedTuition = pendingTuitions[0];
    renderTuitionList();
    updateCheckoutHeading();
    setPageMessage("Pagamento confirmado. Você ainda possui " + pendingTuitions.length + " mensalidade(s) em aberto.", "success");
    await renderPaymentBrick();
    return true;
  }

  if (pendingTuitions.length !== previousCount) renderTuitionList();
  return false;
}

function startPaymentPolling(tuitionId, attempt) {
  stopPaymentPolling();
  if (attempt >= 24) {
    setPageMessage("O pagamento ainda está aguardando confirmação. Você pode voltar mais tarde; a atualização será automática.", "warning");
    return;
  }

  paymentPollTimer = window.setTimeout(async function () {
    try {
      const completed = await refreshAfterPayment(tuitionId);
      if (!completed) startPaymentPolling(tuitionId, attempt + 1);
    } catch (error) {
      console.warn("Não foi possível atualizar o status da mensalidade:", error);
      startPaymentPolling(tuitionId, attempt + 1);
    }
  }, 5000);
}

async function initializePage() {
  const ready = await waitForResources();
  if (!ready) {
    document.body.classList.remove("auth-checking");
    setPageMessage("Não foi possível carregar a autenticação ou o Mercado Pago. Atualize a página.", "error");
    return;
  }

  paymentSession = await Auth.getSession();
  if (!paymentSession || !paymentSession.user) {
    redirectToLogin();
    return;
  }
  document.body.classList.remove("auth-checking");

  try {
    await loadPendingTuitions();
    if (pendingTuitions.some(function (tuition) { return !!tuition.provider_payment_id; })) {
      try {
        await reconcilePendingPayments();
        await loadPendingTuitions();
      } catch (error) {
        console.warn("Não foi possível reconciliar pagamentos pendentes:", error);
      }
    }
    if (!pendingTuitions.length) {
      showAllPaid();
      return;
    }

    const config = await invokePaymentFunction({ action: "config" });
    if (!config.public_key) throw new Error("A chave pública do Mercado Pago não foi configurada.");

    mercadoPago = new window.MercadoPago(config.public_key, { locale: "pt-BR" });
    bricksBuilder = mercadoPago.bricks();
    document.getElementById("paymentWorkspace").hidden = false;

    const requestedTuitionId = new URLSearchParams(window.location.search).get("tuition");
    selectedTuition = pendingTuitions.find(function (tuition) {
      return String(tuition.tuition_id) === String(requestedTuitionId || "");
    }) || pendingTuitions[0];

    renderTuitionList();
    updateCheckoutHeading();
    setPageMessage("Escolha Pix ou cartão de crédito para pagar a mensalidade selecionada.", "");
    await renderPaymentBrick();
  } catch (error) {
    setPageMessage(await getFunctionError(error), "error");
  }
}

document.getElementById("retryPaymentButton").addEventListener("click", function () {
  if (selectedTuition) clearPaymentAttemptKey(selectedTuition.tuition_id);
  renderPaymentBrick();
});

window.addEventListener("beforeunload", function () {
  stopPaymentPolling();
  destroyBricks();
});

initializePage();
