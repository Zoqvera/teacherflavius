(function () {
  "use strict";

  function getDueDayInput() {
    return document.getElementById("studentDueDay");
  }

  function ensureDueDayField() {
    const form = document.getElementById("studentBillingForm");
    const monthlyFeeInput = document.getElementById("studentMonthlyFee");
    if (!form || !monthlyFeeInput) return false;

    const title = document.getElementById("studentBillingTitle");
    if (title) title.textContent = "Mensalidade e vencimento";

    let dueDayInput = getDueDayInput();
    if (!dueDayInput) {
      const label = document.createElement("label");
      label.className = "modal-help";
      label.htmlFor = "studentDueDay";
      label.textContent = "Dia do vencimento";

      dueDayInput = document.createElement("input");
      dueDayInput.id = "studentDueDay";
      dueDayInput.className = "class-select";
      dueDayInput.type = "number";
      dueDayInput.min = "1";
      dueDayInput.max = "31";
      dueDayInput.step = "1";
      dueDayInput.inputMode = "numeric";
      dueDayInput.placeholder = "Ex.: 10";
      dueDayInput.required = true;

      const note = form.querySelector(".billing-modal-note");
      if (note) {
        form.insertBefore(label, note);
        form.insertBefore(dueDayInput, note);
        note.textContent = "Defina o valor mensal e o dia do vencimento. O mês inicial da cobrança, o status e as observações existentes serão preservados. Para uma nova configuração, a cobrança começa no mês atual.";
      } else {
        monthlyFeeInput.insertAdjacentElement("afterend", label);
        label.insertAdjacentElement("afterend", dueDayInput);
      }
    }

    const saveButton = document.getElementById("saveStudentBillingButton");
    if (saveButton && !saveButton.disabled) saveButton.textContent = "SALVAR MENSALIDADE";
    return true;
  }

  function getBillingSettings(studentId) {
    try {
      if (typeof studentBillingMap !== "undefined" && studentBillingMap && typeof studentBillingMap.get === "function") {
        return studentBillingMap.get(String(studentId)) || {};
      }
    } catch (_) {}
    return {};
  }

  function populateDueDay(studentId) {
    ensureDueDayField();
    const input = getDueDayInput();
    if (!input) return;

    const settings = getBillingSettings(studentId);
    const dueDay = Number(settings.due_day);
    input.value = Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 31 ? String(dueDay) : "10";
  }

  function annotateBillingCards() {
    try {
      document.querySelectorAll(".student-card").forEach(function (card) {
        const button = card.querySelector(".billing-settings-button");
        const badge = card.querySelector(".student-billing-row .billing-category");
        if (!button || !badge) return;

        const settings = getBillingSettings(button.dataset.studentId);
        const dueDay = Number(settings.due_day);
        if (settings.monthly_fee == null || !Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) return;

        const suffix = " · vence dia " + dueDay;
        if (!badge.textContent.includes("vence dia")) badge.textContent += suffix;
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

    ensureDueDayField();

    let selection;
    try {
      selection = typeof selectedStudentForBilling !== "undefined" ? selectedStudentForBilling : null;
    } catch (_) {
      selection = null;
    }
    if (!selection) return;

    const feeInput = document.getElementById("studentMonthlyFee");
    const dueDayInput = getDueDayInput();
    const button = document.getElementById("saveStudentBillingButton");
    const fee = Number(String(feeInput ? feeInput.value : "").replace(",", "."));
    const dueDay = Number(dueDayInput ? dueDayInput.value : "");

    if (!Number.isFinite(fee) || fee <= 0) {
      if (typeof setStudentBillingMessage === "function") {
        setStudentBillingMessage("Informe um valor de mensalidade maior que zero.", "error");
      }
      return;
    }

    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
      if (typeof setStudentBillingMessage === "function") {
        setStudentBillingMessage("Informe um dia de vencimento entre 1 e 31.", "error");
      }
      if (dueDayInput) dueDayInput.focus();
      return;
    }

    const settings = selection.settings || getBillingSettings(selection.studentId) || {};
    const startMonth = settings.billing_start_month || (typeof getCurrentBillingMonth === "function" ? getCurrentBillingMonth() : new Date().toISOString().slice(0, 7) + "-01");
    const active = settings.monthly_fee == null ? true : settings.billing_active === true;

    if (button) {
      button.disabled = true;
      button.textContent = "SALVANDO...";
    }
    if (typeof setStudentBillingMessage === "function") {
      setStudentBillingMessage("Salvando mensalidade e vencimento...", "empty");
    }

    try {
      const client = Auth.getClient();
      const response = await client.rpc("save_student_billing_settings", {
        target_student_id: selection.studentId,
        target_monthly_fee: fee,
        target_due_day: dueDay,
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
        if (generation.error) {
          setBillingStatusMessage(
            "Mensalidade e vencimento foram salvos, mas a cobrança do mês atual não pôde ser atualizada automaticamente: " + (generation.error.message || "erro desconhecido") + ".",
            "warning"
          );
        } else {
          setBillingStatusMessage("Mensalidade e dia de vencimento atualizados com sucesso.", "success");
        }
      }
      window.setTimeout(annotateBillingCards, 0);
    } catch (error) {
      if (typeof setStudentBillingMessage === "function") {
        setStudentBillingMessage("Não foi possível salvar a mensalidade e o vencimento: " + (error.message || "erro desconhecido"), "error");
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
    const observer = new MutationObserver(function () {
      annotateBillingCards();
    });
    observer.observe(list, { childList: true, subtree: true });
    annotateBillingCards();
  }

  if (!ensureDueDayField()) {
    document.addEventListener("DOMContentLoaded", ensureDueDayField, { once: true });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", observeStudentCards, { once: true });
  } else {
    observeStudentCards();
  }
})();
