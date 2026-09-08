(function () {
  "use strict";

  if (window.__teacherFlaviusMensalidadesDueDayReadonlyLoaded) return;
  window.__teacherFlaviusMensalidadesDueDayReadonlyLoaded = true;

  function getDueDayInput() {
    return document.getElementById("dueDay");
  }

  function getStartMonthInput() {
    return document.getElementById("billingStartMonth");
  }

  function getSelectedStudent() {
    try {
      if (typeof selectedStudentId === "undefined" || !selectedStudentId) return null;
      if (typeof billingStudents === "undefined" || !Array.isArray(billingStudents)) return null;
      return billingStudents.find(function (item) {
        return String(item.student_id) === String(selectedStudentId);
      }) || null;
    } catch (_) {
      return null;
    }
  }

  function updateDueDayField() {
    const input = getDueDayInput();
    if (!input) return;

    const label = document.querySelector('label[for="dueDay"]');
    if (label) label.textContent = "Vencimento escolhido pelo aluno";

    input.readOnly = true;
    input.required = false;
    input.min = "";
    input.max = "";
    input.step = "";
    input.placeholder = "Aguardando escolha do aluno";

    const student = getSelectedStudent();
    const dueDay = student && Number(student.due_day);
    input.value = Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 31 ? String(dueDay) : "";

    let note = document.getElementById("dueDayStudentChoiceNote");
    if (!note) {
      note = document.createElement("small");
      note.id = "dueDayStudentChoiceNote";
      note.style.color = "#94a3b8";
      note.style.lineHeight = "1.45";
      input.insertAdjacentElement("afterend", note);
    }
    note.textContent = input.value
      ? "O aluno escolheu o dia " + input.value + "."
      : "O aluno ainda não escolheu o vencimento.";
  }

  function hideSystemStartMonthField() {
    const input = getStartMonthInput();
    if (!input) return;

    input.required = false;
    input.readOnly = true;
    const field = input.closest(".form-field");
    if (field) field.hidden = true;
  }

  function refreshSystemFields() {
    updateDueDayField();
    hideSystemStartMonthField();
  }

  function installModalObserver() {
    document.addEventListener("click", function (event) {
      const button = event.target.closest && event.target.closest('[data-action="settings"]');
      if (!button) return;
      window.setTimeout(refreshSystemFields, 0);
    }, true);
  }

  async function handleSettingsSubmit(event) {
    const form = event.target;
    if (!form || form.id !== "settingsForm") return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const button = document.getElementById("saveSettingsButton");
    const fee = Number(document.getElementById("monthlyFee").value);

    if (!fee || fee <= 0) {
      if (typeof setFormMessage === "function") {
        setFormMessage("settingsMessage", "Informe um valor mensal válido.", "error");
      }
      return;
    }

    if (typeof setButtonBusy === "function") setButtonBusy(button, true, "SALVANDO...");
    if (typeof setFormMessage === "function") {
      setFormMessage("settingsMessage", "Salvando valor da mensalidade...", "info");
    }

    try {
      const response = await Auth.getClient().rpc("save_student_billing_settings", {
        target_student_id: selectedStudentId,
        target_monthly_fee: fee,
        target_active: document.getElementById("billingActive").checked,
        target_notes: document.getElementById("billingNotes").value.trim()
      });
      if (response.error) throw response.error;

      if (typeof loadBillingStudents === "function") await loadBillingStudents();
      if (typeof loadSelectedMonth === "function") await loadSelectedMonth({ generate: true });
      if (typeof closeModal === "function") closeModal("settingsModal");

      const awaitingDueDay = response.data && response.data.awaiting_student_due_day === true;
      if (typeof setPageMessage === "function") {
        setPageMessage(
          awaitingDueDay
            ? "Valor da mensalidade salvo. Vencimento e início da cobrança serão finalizados automaticamente quando o aluno escolher uma das opções."
            : "Valor da mensalidade atualizado. Vencimento e início da cobrança permanecem controlados pelo sistema.",
          "success"
        );
      }
    } catch (error) {
      if (typeof setFormMessage === "function") {
        setFormMessage("settingsMessage", "Não foi possível salvar: " + (error.message || "erro desconhecido"), "error");
      }
    } finally {
      if (typeof setButtonBusy === "function") setButtonBusy(button, false);
    }
  }

  function initialize() {
    const panelDescription = document.querySelector(".finance-panel:nth-of-type(2) .panel-header p");
    if (panelDescription) {
      panelDescription.textContent = "Defina apenas o valor mensal. O vencimento e o início da cobrança são definidos automaticamente pelo sistema.";
    }

    refreshSystemFields();
    installModalObserver();
    document.addEventListener("submit", handleSettingsSubmit, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
