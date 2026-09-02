(function () {
  "use strict";

  var headers = ["Solicitado em", "Tipo", "Titular", "Pedido / resposta", "Status", "Ações"];
  var rows = document.getElementById("privacyRequestRows");
  var refreshButton = document.getElementById("refreshPrivacyRequests");
  var statusElement = document.getElementById("privacyAdminStatus");

  document.documentElement.classList.add("tf-brand-palette");
  if (rows) rows.setAttribute("aria-live", "polite");

  function enhanceRows() {
    if (!rows) return;
    rows.querySelectorAll("tr").forEach(function (row) {
      row.querySelectorAll("td").forEach(function (cell, index) {
        if (!cell.hasAttribute("colspan")) cell.setAttribute("data-label", headers[index] || "");
      });

      var subject = row.querySelector(".subject strong");
      var subjectName = subject ? subject.textContent.trim() : "titular";
      row.querySelectorAll("button[data-action]").forEach(function (button) {
        var label = button.textContent.trim();
        if (label.indexOf("CONCLUIR ENCERRAMENTO") !== -1) {
          button.classList.add("privacy-destructive");
          button.setAttribute("aria-label", "Concluir encerramento da conta de " + subjectName + ". Ação destrutiva e irreversível sobre dados eliminados.");
        } else if (button.dataset.action === "complete") {
          button.classList.remove("privacy-destructive");
          button.setAttribute("aria-label", "Registrar resposta à solicitação de privacidade de " + subjectName);
        } else if (button.dataset.action === "review") {
          button.setAttribute("aria-label", "Iniciar análise da solicitação de privacidade de " + subjectName);
        }
        button.setAttribute("aria-busy", button.disabled ? "true" : "false");
      });
    });
  }

  function syncBusy() {
    if (refreshButton) refreshButton.setAttribute("aria-busy", refreshButton.disabled ? "true" : "false");
    document.querySelectorAll("button[data-action]").forEach(function (button) {
      button.setAttribute("aria-busy", button.disabled ? "true" : "false");
    });
  }

  if (statusElement) statusElement.setAttribute("aria-atomic", "true");
  enhanceRows();
  syncBusy();

  var observer = new MutationObserver(function () {
    enhanceRows();
    syncBusy();
  });
  if (rows) observer.observe(rows, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });
  if (refreshButton) observer.observe(refreshButton, { attributes: true, attributeFilter: ["disabled"] });
})();
