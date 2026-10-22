(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) {
    root.TrialMeetReport = api;
    root.document.addEventListener("DOMContentLoaded", function () {
      api.initialize(root.document, root);
    }, { once: true });
  }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const TIME_ZONE = "America/Sao_Paulo";
  const SLOT_LABELS = Object.freeze({
    monday_18: "Segunda-feira 18h",
    tuesday_10: "Terça-feira 10h",
    tuesday_15: "Terça-feira 15h",
    thursday_20: "Quinta-feira 20h"
  });

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatTimestamp(value) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "Data inválida";
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: TIME_ZONE,
      dateStyle: "short",
      timeStyle: "short"
    }).format(parsed);
  }

  function whatsappLink(value) {
    const digits = String(value || "").replace(/\D/g, "");
    return digits.length >= 10 && digits.length <= 15 ? "https://wa.me/" + digits : "";
  }

  function renderEntries(entries) {
    if (!entries.length) {
      return '<p class="trial-empty">Nenhum acesso ao Meet registrado ainda.</p>';
    }
    return entries.map(function (item) {
      const url = whatsappLink(item.whatsapp_digits);
      const label = SLOT_LABELS[item.lesson_slot] || "Aula não identificada";
      const contact = url
        ? '<a class="trial-whatsapp-link" href="' + escapeHtml(url) +
          '" target="_blank" rel="noopener noreferrer">ABRIR WHATSAPP</a>'
        : "";
      return '<article class="trial-card">' +
        '<div class="trial-card-header"><div>' +
        '<h3>' + escapeHtml(item.visitor_name) + '</h3>' +
        '<p class="trial-card-date">' + escapeHtml(formatTimestamp(item.accessed_at)) + '</p>' +
        '</div><span class="trial-pill">ACESSOU O LINK</span></div>' +
        '<div class="trial-card-meta"><span class="trial-pill">' + escapeHtml(label) + '</span></div>' +
        '<p class="trial-card-contact"><strong>WhatsApp:</strong> ' +
        escapeHtml(item.whatsapp_digits) + '</p>' +
        '<div class="trial-card-actions">' + contact + '</div></article>';
    }).join("");
  }

  async function waitForClient(windowRef) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (windowRef.Auth && typeof windowRef.Auth.getClient === "function") {
        return windowRef.Auth.getClient();
      }
      await new Promise(function (resolve) { windowRef.setTimeout(resolve, 150); });
    }
    throw new Error("A autenticação ainda não está disponível.");
  }

  function initialize(documentRef, windowRef) {
    const list = documentRef.getElementById("trialMeetReportList");
    const message = documentRef.getElementById("trialMeetReportMessage");
    const button = documentRef.getElementById("trialMeetRefreshButton");
    if (!list || !message || !button) return;

    async function refresh() {
      button.disabled = true;
      message.textContent = "";
      list.textContent = "Carregando acessos...";
      try {
        const client = await waitForClient(windowRef);
        const response = await client.rpc("get_teacher_trial_meet_accesses");
        if (response.error) throw response.error;
        const entries = Array.isArray(response.data) ? response.data : [];
        list.innerHTML = renderEntries(entries);
        message.textContent = entries.length + (entries.length === 1 ? " acesso registrado." : " acessos registrados (até 300 recentes).");
      } catch (error) {
        list.textContent = "";
        message.textContent = "Não foi possível consultar os acessos. Faça login como professor e tente novamente.";
        if (windowRef.console && windowRef.console.warn) {
          windowRef.console.warn("trial meet report failed", error && error.code ? error.code : "unknown");
        }
      } finally {
        button.disabled = false;
      }
    }

    button.addEventListener("click", refresh);
    refresh();
  }

  return Object.freeze({ renderEntries, whatsappLink, formatTimestamp, initialize });
});
