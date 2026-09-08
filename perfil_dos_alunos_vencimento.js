(function () {
  "use strict";

  if (window.__teacherFlaviusPerfilDueDayReadonlyLoaded) return;
  window.__teacherFlaviusPerfilDueDayReadonlyLoaded = true;

  function getDueDayField() {
    return document.getElementById("studentDueDay");
  }

  function getBillingSettings(studentId) {
    try {
      if (typeof studentBillingMap !== "undefined" && studentBillingMap && typeof studentBillingMap.get === "function") {
        return studentBillingMap.get(String(studentId)) || {};
      }
    } catch (_) {}
    return {};
  }

  function ensureDueDayField() {
    const form = document.getElementById("studentBillingForm");
    const monthlyFeeInput = document.getElementById("studentMonthlyFee");
    if (!form || !monthlyFeeInput) return false;

    const title = document.getElementById("studentBillingTitle");
    if (title) title.textContent = "Mensalidade";

    let field = getDueDayField();
    if (!field) {
      const label = document.createElement("label");
      label.className = "modal-help";
      label.htmlFor = "studentDueDay";
      label.textContent = "Vencimento escolhido pelo aluno";

      field = document.createElement("input");
      field.id = "studentDueDay";
      field.className = "class-select";
      field.type = "text";
      field.readOnly = true;
      field.placeholder = "Aguardando escolha do aluno";

      const note = form.querySelector(".billing-modal-note");
      if (note) {
        form.insertBefore(label, note);
        form.insertBefore(field, note);
        note.textContent = "Defina apenas o valor mensal. O vencimento é escolhido pelo aluno durante a matrícula ou no primeiro acesso. O mês inicial, o status e as observações existentes serão preservados.";
      } else {
        monthlyFeeInput.insertAdjacentElement("afterend", label);
        label.insertAdjacentElement("afterend", field);
      }
    }

    const saveButton = document.getElementById("saveStudentBillingButton");
    if (saveButton && !saveButton.disabled) saveButton.textContent = "SALVAR MENSALIDADE";
    return true;
  }

  function populateDueDay(studentId) {
    ensureDueDayField();
    const field = getDueDayField();
    if (!field) return;

    const settings = getBillingSettings(studentId);
    const dueDay = Number(settings.due_day);
    field.value = Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 31
      ? "Dia " + dueDay
      : "";
    field.placeholder = "Aguardando escolha do aluno";
  }

  function annotateBillingCards() {
    try {
      document.querySelectorAll(".student-card").forEach(function (card) {
        const button = card.querySelector(".billing-settings-button");
        const badge = card.querySelector(".student-billing-row .billing-category");
        if (!button || !badge) return;

        const settings = getBillingSettings(button.dataset.studentId);
        const dueDay = Number(settings.due_day);
        if (Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 31) {
          const suffix = " · vence dia " + dueDay;
          if (!badge.textContent.includes("vence dia")) badge.textContent += suffix;
          return;
        }

        if (!badge.textContent.includes("vencimento aguardando aluno")) {
          badge.textContent += " · vencimento aguardando aluno";
        }
      });
    } catch (_) {}
  }

  document.addEventListener("click", function (event) {
    const button = event.target.closest && event.target.closest(".billing-settings-button");
    if (!button) return;
    window.setTimeout(function () {
      populateDueDay(button.dataset.studentId);
    }, 0);
  }, true);

  document.addEventListener("submit", async function (event) {
    if (!event.target || event.target.id !== "studentBillingForm") return;

    event.preventDefault();
    event.stopImmediatePropagation();

    let selection;
    try {
      selection = typeof selectedStudentForBilling !== "undefined" ? selectedStudentForBilling : null;
    } catch (_) {
      selection = null;
    }
    if (!selection) return;

    const feeInput = document.getElementById("studentMonthlyFee");
    const button = document.getElementById("saveStudentBillingButton");
    const fee = Number(String(feeInput ? feeInput.value : "").replace(",", "."));

    if (!Number.isFinite(fee) || fee <= 0) {
      if (typeof setStudentBillingMessage === "function") {
        setStudentBillingMessage("Informe um valor de mensalidade maior que zero.", "error");
      }
      return;
    }

    const settings = selection.settings || getBillingSettings(selection.studentId) || {};
    const startMonth = settings.billing_start_month || (
      typeof getCurrentBillingMonth === "function"
        ? getCurrentBillingMonth()
        : new Date().toISOString().slice(0, 7) + "-01"
    );
    const active = settings.monthly_fee == null ? true : settings.billing_active === true;

    if (button) {
      button.disabled = true;
      button.textContent = "SALVANDO...";
    }
    if (typeof setStudentBillingMessage === "function") {
      setStudentBillingMessage("Salvando mensalidade...", "empty");
    }

    try {
      const client = Auth.getClient();
      const response = await client.rpc("save_student_billing_settings", {
        target_student_id: selection.studentId,
        target_monthly_fee: fee,
        target_billing_start_month: startMonth,
        target_active: active,
        target_notes: settings.billing_notes || ""
      });
      if (response.error) throw response.error;

      const referenceMonth = typeof getCurrentBillingMonth === "function"
        ? getCurrentBillingMonth()
        : new Date().toISOString().slice(0, 7) + "-01";
      const generation = await client.rpc("generate_monthly_tuition", {
        target_reference_month: referenceMonth
      });

      if (typeof refreshStudentBillingMap === "function") {
        await refreshStudentBillingMap({ showSuccess: false });
      }
      if (typeof renderFilteredStudents === "function") renderFilteredStudents();
      if (typeof closeStudentBillingModal === "function") closeStudentBillingModal();

      if (typeof setBillingStatusMessage === "function") {
        const awaitingDueDay = response.data && response.data.awaiting_student_due_day === true;
        if (generation.error) {
          setBillingStatusMessage(
            "Mensalidade salva, mas a cobrança do mês atual não pôde ser atualizada automaticamente: " + (generation.error.message || "erro desconhecido") + ".",
            "warning"
          );
        } else if (awaitingDueDay) {
          setBillingStatusMessage("Mensalidade salva. O vencimento será aplicado quando o aluno fizer a escolha.", "success");
        } else {
          setBillingStatusMessage("Mensalidade atualizada com sucesso.", "success");
        }
      }
      window.setTimeout(annotateBillingCards, 0);
    } catch (error) {
      if (typeof setStudentBillingMessage === "function") {
        setStudentBillingMessage("Não foi possível salvar a mensalidade: " + (error.message || "erro desconhecido"), "error");
      }
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "SALVAR MENSALIDADE";
      }
    }
  }, true);

  function observeStudentCards() {
    const list = document.getElementById("studentProfilesList");
    if (!list || typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(annotateBillingCards);
    observer.observe(list, { childList: true, subtree: true });
    annotateBillingCards();
  }

  function initialize() {
    ensureDueDayField();
    observeStudentCards();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
