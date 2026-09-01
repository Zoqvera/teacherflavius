(function () {
  "use strict";

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function decorateTable(table) {
    if (!table) return;
    const wrap = table.closest(".data-table-wrap");
    if (wrap) wrap.classList.add("tf-mobile-cards");

    const headers = Array.from(table.querySelectorAll("thead th")).map(function (th) {
      return normalizeText(th.textContent);
    });

    table.querySelectorAll("tbody tr").forEach(function (row) {
      Array.from(row.children).forEach(function (cell, index) {
        if (cell.tagName !== "TD") return;
        cell.dataset.label = headers[index] || "Informação";
      });

      const status = row.querySelector(".status-pill");
      if (status && normalizeText(status.textContent).toLocaleLowerCase("pt-BR") === "suspenso") {
        status.classList.remove("status-overdue");
        status.classList.add("status-suspended");
      }
    });
  }

  function decorateAllTables() {
    document.querySelectorAll(".data-table").forEach(decorateTable);
  }

  function syncModalAria(modal) {
    if (!modal) return;
    modal.setAttribute("aria-hidden", modal.classList.contains("open") ? "false" : "true");
  }

  function setupObservers() {
    ["tuitionTableBody", "billingStudentsBody", "historyTableBody"].forEach(function (id) {
      const body = document.getElementById(id);
      if (!body) return;
      new MutationObserver(function () {
        decorateTable(body.closest("table"));
      }).observe(body, { childList: true, subtree: true });
    });

    document.querySelectorAll(".modal-backdrop").forEach(function (modal) {
      syncModalAria(modal);
      new MutationObserver(function () {
        syncModalAria(modal);
      }).observe(modal, { attributes: true, attributeFilter: ["class"] });
    });
  }

  function initialize() {
    decorateAllTables();
    setupObservers();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
