(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TuitionHistory = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const HISTORY_RPC = "get_my_paid_tuition_history";
  const PAYMENT_METHODS = Object.freeze({
    pix: "Pix",
    cash: "Dinheiro",
    bank_transfer: "Transferência bancária",
    card: "Cartão",
    other: "Outro meio"
  });

  let clientProvider = null;
  let elements = null;
  let pendingLoad = null;

  function formatCurrency(value) {
    const amount = Number(value);
    return Number.isFinite(amount)
      ? amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
      : "Valor indisponível";
  }

  function formatDate(value, options) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return "Data indisponível";
    const date = new Date(value + "T12:00:00");
    return Number.isNaN(date.getTime())
      ? "Data indisponível"
      : date.toLocaleDateString("pt-BR", options);
  }

  function paymentMethodLabel(value) {
    return PAYMENT_METHODS[String(value || "").toLowerCase()] || "Não informado";
  }

  function normalizeRecords(value) {
    if (!Array.isArray(value)) return [];
    return value.filter(function (item) {
      return item && item.payment_date && Number(item.amount_paid) > 0 &&
        (item.payment_status === "paid" || item.payment_status === "partial");
    }).sort(function (first, second) {
      const referenceComparison = String(second.reference_month).localeCompare(String(first.reference_month));
      return referenceComparison || String(second.payment_date).localeCompare(String(first.payment_date));
    });
  }

  function appendText(parent, tagName, className, content) {
    const element = document.createElement(tagName);
    element.className = className;
    element.textContent = content;
    parent.appendChild(element);
    return element;
  }

  function renderPayment(record) {
    const card = document.createElement("article");
    card.className = "tuition-history-item";

    const heading = document.createElement("div");
    heading.className = "tuition-history-item__heading";
    appendText(heading, "strong", "tuition-history-item__month",
      formatDate(record.reference_month, { month: "long", year: "numeric" }));
    appendText(heading, "strong", "tuition-history-item__amount", formatCurrency(record.amount_paid));

    const details = document.createElement("div");
    details.className = "tuition-history-item__details";
    appendText(details, "span", "", "Pago em " + formatDate(record.payment_date));
    appendText(details, "span", "", paymentMethodLabel(record.payment_method));

    const status = record.payment_status === "partial" ? "Pagamento parcial" : "Pago";
    const badge = appendText(card, "span", "tuition-history-item__status", status);
    badge.dataset.status = record.payment_status;

    card.insertBefore(heading, badge);
    card.insertBefore(details, badge);
    return card;
  }

  function setMessage(message, isError) {
    elements.message.textContent = message;
    elements.message.dataset.error = isError ? "true" : "false";
    elements.retry.hidden = !isError;
  }

  function renderRecords(records) {
    elements.list.replaceChildren();
    if (!records.length) {
      setMessage("Você ainda não possui pagamentos registrados.", false);
      return;
    }

    const fragment = document.createDocumentFragment();
    records.forEach(function (record) {
      fragment.appendChild(renderPayment(record));
    });
    elements.list.appendChild(fragment);
    setMessage(records.length === 1 ? "1 mensalidade com pagamento registrado." :
      records.length + " mensalidades com pagamentos registrados.", false);
  }

  async function loadRecords() {
    const client = clientProvider();
    const response = await client.rpc(HISTORY_RPC);
    if (response.error) throw response.error;
    return normalizeRecords(response.data);
  }

  async function refresh() {
    if (!elements || elements.panel.hidden) return;
    if (pendingLoad) return pendingLoad;

    setMessage("Carregando seu histórico de pagamentos...", false);
    pendingLoad = (async function () {
      try {
        renderRecords(await loadRecords());
      } catch (error) {
        elements.list.replaceChildren();
        setMessage("Não foi possível carregar seu histórico. Tente novamente.", true);
      } finally {
        pendingLoad = null;
      }
    })();
    return pendingLoad;
  }

  function toggle() {
    const expanded = elements.toggle.getAttribute("aria-expanded") === "true";
    elements.toggle.setAttribute("aria-expanded", String(!expanded));
    elements.panel.hidden = expanded;
    if (!expanded) refresh();
  }

  function mount(config) {
    if (elements) return;
    if (!config || typeof config.getClient !== "function") {
      throw new Error("Cliente de pagamentos indisponível.");
    }

    const section = document.getElementById("tuitionHistorySection");
    if (!section) return;

    clientProvider = config.getClient;
    elements = {
      section: section,
      toggle: document.getElementById("tuitionHistoryToggle"),
      panel: document.getElementById("tuitionHistoryPanel"),
      message: document.getElementById("tuitionHistoryMessage"),
      list: document.getElementById("tuitionHistoryList"),
      retry: document.getElementById("tuitionHistoryRetry")
    };
    elements.toggle.addEventListener("click", toggle);
    elements.retry.addEventListener("click", refresh);
    elements.section.hidden = false;
  }

  return Object.freeze({
    formatCurrency: formatCurrency,
    formatDate: formatDate,
    normalizeRecords: normalizeRecords,
    paymentMethodLabel: paymentMethodLabel,
    mount: mount,
    refreshIfOpen: refresh
  });
});
