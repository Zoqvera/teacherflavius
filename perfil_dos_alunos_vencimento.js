(function () {
  "use strict";

  if (window.__teacherFlaviusPerfilDueDayRequiredLoaded) return;
  window.__teacherFlaviusPerfilDueDayRequiredLoaded = true;

  const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";

  function getDueDayField() {
    return document.getElementById("studentDueDay");
  }

  function getLessonQuantityField() {
    return document.getElementById("studentClassesPerMonth");
  }

  function getBillingSettings(studentId) {
    try {
      if (typeof studentBillingMap !== "undefined" && studentBillingMap && typeof studentBillingMap.get === "function") {
        return studentBillingMap.get(String(studentId)) || {};
      }
    } catch (_) {}
    return {};
  }

  function getStudentProfile(studentId) {
    try {
      if (typeof cachedVisibleStudents !== "undefined" && Array.isArray(cachedVisibleStudents)) {
        return cachedVisibleStudents.find(function (student) {
          return String(student.user_id || student.id || "") === String(studentId);
        }) || null;
      }
    } catch (_) {}
    return null;
  }

  function getSaoPauloCalendarDate(value) {
    const date = value ? new Date(value) : new Date();
    const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: SAO_PAULO_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(safeDate);

    const values = {};
    parts.forEach(function (part) {
      if (part.type !== "literal") values[part.type] = Number(part.value);
    });

    return {
      year: values.year,
      month: values.month,
      day: values.day
    };
  }

  function addCalendarDays(calendarDate, offset) {
    const date = new Date(Date.UTC(
      calendarDate.year,
      calendarDate.month - 1,
      calendarDate.day + offset
    ));

    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate()
    };
  }

  function calculateDueDayOptions(studentId) {
    const student = getStudentProfile(studentId);
    const anchorDate = getSaoPauloCalendarDate(student && student.created_at);
    const options = [
      anchorDate.day,
      addCalendarDays(anchorDate, 5).day,
      addCalendarDays(anchorDate, 8).day
    ];

    return options.filter(function (day, index) {
      return Number.isInteger(day) && day >= 1 && day <= 31 && options.indexOf(day) === index;
    });
  }

  function ensureDueDayField() {
    const field = getDueDayField();
    const lessonQuantityField = getLessonQuantityField();
    const form = document.getElementById("studentBillingForm");
    if (!field || !lessonQuantityField || !form) return false;

    field.required = true;
    lessonQuantityField.required = true;

    const title = document.getElementById("studentBillingTitle");
    if (title) title.textContent = "Mensalidade";

    const note = form.querySelector(".billing-modal-note");
    if (note) {
      note.textContent = "O dia de vencimento é obrigatório e segue as opções calculadas pelo sistema a partir da data da matrícula.";
    }

    const saveButton = document.getElementById("saveStudentBillingButton");
    if (saveButton && !saveButton.disabled) saveButton.textContent = "SALVAR MENSALIDADE";
    return true;
  }

  function populateDueDay(studentId) {
    if (!ensureDueDayField()) return;

    const field = getDueDayField();
    const settings = getBillingSettings(studentId);
    const currentDueDay = Number(settings.due_day);
    const hasCurrentDueDay = Number.isInteger(currentDueDay) && currentDueDay >= 1 && currentDueDay <= 31;
    const allowedOptions = calculateDueDayOptions(studentId);
    const options = hasCurrentDueDay && !allowedOptions.includes(currentDueDay)
      ? [currentDueDay].concat(allowedOptions)
      : allowedOptions.slice();

    field.innerHTML = '<option value="">Selecione o dia de vencimento</option>' + options.map(function (dueDay) {
      const currentLabel = hasCurrentDueDay && dueDay === currentDueDay && !allowedOptions.includes(currentDueDay)
        ? " (atual)"
        : "";
      return '<option value="' + dueDay + '">Dia ' + dueDay + currentLabel + '</option>';
    }).join("");

    field.value = hasCurrentDueDay ? String(currentDueDay) : "";
  }

  function populateLessonQuantity(studentId) {
    const field = getLessonQuantityField();
    if (!field) return;

    const settings = getBillingSettings(studentId);
    const classesPerMonth = Number(settings.classes_per_month);
    field.value = Number.isInteger(classesPerMonth) && classesPerMonth >= 1 && classesPerMonth <= 31
      ? String(classesPerMonth)
      : "";
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
          const dueDaySuffix = " · vence dia " + dueDay;
          if (!badge.textContent.includes("vence dia")) badge.textContent += dueDaySuffix;
        } else if (!badge.textContent.includes("vencimento não definido")) {
          badge.textContent += " · vencimento não definido";
        }

        const classesPerMonth = Number(settings.classes_per_month);
        if (Number.isInteger(classesPerMonth) && classesPerMonth >= 1 && classesPerMonth <= 31) {
          const lessonLabel = classesPerMonth === 1 ? "1 aula/mês" : classesPerMonth + " aulas/mês";
          if (!badge.textContent.includes("aula/mês") && !badge.textContent.includes("aulas/mês")) {
            badge.textContent += " · " + lessonLabel;
          }
        } else if (!badge.textContent.includes("aulas/mês não definidas")) {
          badge.textContent += " · aulas/mês não definidas";
        }
      });
    } catch (_) {}
  }

  function isAllowedDueDay(studentId, dueDay, currentDueDay) {
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) return false;
    if (dueDay === currentDueDay) return true;
    return calculateDueDayOptions(studentId).includes(dueDay);
  }

  document.addEventListener("click", function (event) {
    const button = event.target.closest && event.target.closest(".billing-settings-button");
    if (!button) return;

    window.setTimeout(function () {
      populateDueDay(button.dataset.studentId);
      populateLessonQuantity(button.dataset.studentId);
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
    const dueDayField = getDueDayField();
    const lessonQuantityField = getLessonQuantityField();
    const button = document.getElementById("saveStudentBillingButton");
    const fee = Number(String(feeInput ? feeInput.value : "").replace(",", "."));
    const dueDay = Number(dueDayField ? dueDayField.value : "");
    const classesPerMonth = Number(lessonQuantityField ? lessonQuantityField.value : "");
    const settings = selection.settings || getBillingSettings(selection.studentId) || {};
    const currentDueDay = Number(settings.due_day);

    if (!Number.isFinite(fee) || fee <= 0) {
      if (typeof setStudentBillingMessage === "function") {
        setStudentBillingMessage("Informe um valor de mensalidade maior que zero.", "error");
      }
      return;
    }

    if (!Number.isInteger(classesPerMonth) || classesPerMonth < 1 || classesPerMonth > 31) {
      if (typeof setStudentBillingMessage === "function") {
        setStudentBillingMessage("Informe a quantidade de aulas contratadas no mês, entre 1 e 31.", "error");
      }
      if (lessonQuantityField) lessonQuantityField.focus();
      return;
    }

    if (!isAllowedDueDay(selection.studentId, dueDay, currentDueDay)) {
      if (typeof setStudentBillingMessage === "function") {
        setStudentBillingMessage("Selecione um dos dias de vencimento disponíveis.", "error");
      }
      if (dueDayField) dueDayField.focus();
      return;
    }

    const active = settings.monthly_fee == null ? true : settings.billing_active === true;
    const startMonth = settings.billing_start_month || (
      typeof getCurrentBillingMonth === "function"
        ? getCurrentBillingMonth()
        : new Date().toISOString().slice(0, 7) + "-01"
    );

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
        target_due_day: dueDay,
        target_billing_start_month: startMonth,
        target_active: active,
        target_notes: settings.billing_notes || ""
      });
      if (response.error) throw response.error;

      const lessonPlanResponse = await client.rpc("save_student_lesson_plan", {
        target_student_id: selection.studentId,
        target_classes_per_month: classesPerMonth
      });
      if (lessonPlanResponse.error) throw lessonPlanResponse.error;

      const currentBillingMonth = typeof getCurrentBillingMonth === "function"
        ? getCurrentBillingMonth()
        : new Intl.DateTimeFormat("en-CA", {
          timeZone: SAO_PAULO_TIME_ZONE,
          year: "numeric",
          month: "2-digit"
        }).format(new Date()) + "-01";
      const billingStartMonth = response.data && response.data.billing_start_month
        ? String(response.data.billing_start_month).slice(0, 10)
        : currentBillingMonth;
      const generationMonth = billingStartMonth > currentBillingMonth
        ? billingStartMonth
        : currentBillingMonth;
      const generation = await client.rpc("generate_monthly_tuition", {
        target_reference_month: generationMonth
      });

      if (typeof refreshStudentBillingMap === "function") {
        await refreshStudentBillingMap({ showSuccess: false });
      }
      if (typeof renderFilteredStudents === "function") renderFilteredStudents();
      if (typeof closeStudentBillingModal === "function") closeStudentBillingModal();

      if (typeof setBillingStatusMessage === "function") {
        if (generation.error) {
          setBillingStatusMessage(
            "Mensalidade salva, mas a cobrança não pôde ser atualizada automaticamente: " + (generation.error.message || "erro desconhecido") + ".",
            "warning"
          );
        } else {
          setBillingStatusMessage(
            "Mensalidade atualizada com vencimento no dia " + dueDay + " e " +
            classesPerMonth + (classesPerMonth === 1 ? " aula contratada por mês." : " aulas contratadas por mês."),
            "success"
          );
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
