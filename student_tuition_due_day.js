(function () {
  "use strict";

  if (window.__teacherFlaviusStudentTuitionDueDayLoaded) return;
  window.__teacherFlaviusStudentTuitionDueDayLoaded = true;

  const FORM_ID = "completeProfileForm";
  const MESSAGE_ID = "message";
  const SECTION_ID = "tuitionDueDaySection";
  const STYLE_ID = "tuitionDueDayStyles";
  const WRAPPED_FLAG = "__tfTuitionDueDayWrapped";
  const state = {
    loaded: false,
    loadingPromise: null,
    enabled: null,
    anchorDate: null,
    dateOptions: [],
    selectedDueDate: null
  };

  function getClient() {
    if (!window.Auth || typeof window.Auth.getClient !== "function") {
      throw new Error("A autenticação ainda não está disponível.");
    }
    return window.Auth.getClient();
  }

  function isIsoDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
  }

  function normalizeDateOptions(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map(function (item) { return String(item || "").trim(); })
      .filter(isIsoDate);
  }

  function formatDateBr(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    return match ? match[3] + "/" + match[2] + "/" + match[1] : "";
  }

  async function loadState() {
    if (state.loaded) return state;
    if (state.loadingPromise) return state.loadingPromise;

    state.loadingPromise = (async function () {
      if (!window.EnrollmentOnboardingState) {
        throw new Error("O estado da matrícula não foi inicializado.");
      }

      const onboardingState = await window.EnrollmentOnboardingState.get();
      state.enabled = onboardingState.requiresTuitionDueDate === true;

      if (!state.enabled) {
        state.loaded = true;
        return state;
      }

      const response = await getClient().rpc("get_my_tuition_due_day_options");
      if (response.error) throw response.error;

      const payload = response.data || {};
      state.anchorDate = payload.anchor_date || null;
      state.dateOptions = normalizeDateOptions(payload.date_options);
      state.selectedDueDate = payload.selected_due_date || payload.first_due_date || null;
      state.loaded = true;
      return state;
    })().finally(function () {
      state.loadingPromise = null;
    });

    return state.loadingPromise;
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      ".tuition-due-date-field{margin-top:14px}",
      ".tuition-due-date-field label{display:block;margin-bottom:8px;color:#e2e8f0;font-weight:700}",
      ".tuition-due-date-note{margin-top:10px;color:#94a3b8;font-size:12px;line-height:1.5}"
    ].join("");
    document.head.appendChild(style);
  }

  function getSelectedDate() {
    const select = document.getElementById("tuitionDueDate");
    return select && isIsoDate(select.value) ? select.value : null;
  }

  function getOptionsToRender() {
    if (
      state.selectedDueDate != null &&
      !state.dateOptions.includes(state.selectedDueDate)
    ) {
      return [state.selectedDueDate];
    }
    return state.dateOptions;
  }

  function getOptionLabel(dueDate, index) {
    if (state.selectedDueDate != null && !state.dateOptions.includes(dueDate)) {
      return formatDateBr(dueDate) + " — vencimento registrado";
    }
    return formatDateBr(dueDate) +
      (index === 0 ? " — dia da matrícula" : " — dia seguinte");
  }

  function buildSection() {
    const section = document.createElement("section");
    section.id = SECTION_ID;
    section.className = "form-section";
    section.setAttribute("aria-labelledby", "tuitionDueDayTitle");

    const heading = document.createElement("div");
    heading.className = "section-heading";

    const title = document.createElement("h2");
    title.id = "tuitionDueDayTitle";
    title.textContent = "Escolha o vencimento da primeira mensalidade";

    const description = document.createElement("p");
    description.textContent =
      "Você pode escolher somente o dia da matrícula ou o dia seguinte.";

    heading.appendChild(title);
    heading.appendChild(description);
    section.appendChild(heading);

    const field = document.createElement("div");
    field.className = "field full tuition-due-date-field";

    const label = document.createElement("label");
    label.className = "field-label";
    label.htmlFor = "tuitionDueDate";
    label.textContent = "Data de vencimento";

    const select = document.createElement("select");
    select.id = "tuitionDueDate";
    select.required = state.selectedDueDate == null;
    select.disabled = state.selectedDueDate != null;

    if (state.selectedDueDate == null) {
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.disabled = true;
      placeholder.selected = true;
      placeholder.textContent = "Selecione uma das duas datas";
      select.appendChild(placeholder);
    }

    getOptionsToRender().forEach(function (dueDate, index) {
      const option = document.createElement("option");
      option.value = dueDate;
      option.textContent = getOptionLabel(dueDate, index);
      option.selected = state.selectedDueDate === dueDate;
      select.appendChild(option);
    });

    field.appendChild(label);
    field.appendChild(select);
    section.appendChild(field);

    const note = document.createElement("p");
    note.className = "tuition-due-date-note";
    note.textContent = state.selectedDueDate == null
      ? "A escolha é obrigatória. A primeira mensalidade ficará disponível assim que a matrícula for concluída."
      : "Vencimento já registrado: " + formatDateBr(state.selectedDueDate) + ".";
    section.appendChild(note);

    return section;
  }

  async function mount() {
    const form = document.getElementById(FORM_ID);
    const message = document.getElementById(MESSAGE_ID);
    if (!form || !message) return false;
    if (document.getElementById(SECTION_ID)) return true;

    await loadState();
    if (!state.enabled) {
      const existingSection = document.getElementById(SECTION_ID);
      if (existingSection) existingSection.remove();
      return false;
    }
    if (state.selectedDueDate == null && state.dateOptions.length !== 2) {
      throw new Error("Não foi possível carregar as duas datas de vencimento.");
    }

    ensureStyles();
    form.insertBefore(buildSection(), message);
    return true;
  }

  async function saveSelection() {
    await loadState();
    if (!state.enabled) return null;
    if (state.selectedDueDate != null) return state.selectedDueDate;

    await mount();
    const selectedDueDate = getSelectedDate();
    if (!selectedDueDate) {
      throw new Error("Escolha a data de vencimento da primeira mensalidade.");
    }

    const response = await getClient().rpc("set_my_tuition_due_date", {
      target_due_date: selectedDueDate
    });
    if (response.error) throw response.error;

    state.selectedDueDate =
      response.data && response.data.first_due_date || selectedDueDate;
    return state.selectedDueDate;
  }

  function installProfileCompletionWrapper() {
    if (!window.Auth || typeof window.Auth.completeProfile !== "function") return false;
    if (window.Auth.completeProfile[WRAPPED_FLAG]) return true;

    const original = window.Auth.completeProfile;
    const wrapped = async function () {
      await saveSelection();
      return original.apply(this, arguments);
    };
    wrapped[WRAPPED_FLAG] = true;
    window.Auth.completeProfile = wrapped;
    return true;
  }

  async function initialize() {
    try {
      await loadState();
      if (!state.enabled) return;
      installProfileCompletionWrapper();
      await mount();
    } catch (error) {
      const message = document.getElementById(MESSAGE_ID);
      if (message && !message.textContent) {
        message.textContent =
          error.message || "Não foi possível carregar as opções de vencimento.";
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      initialize();
    }, { once: true });
  } else {
    initialize();
  }

  window.StudentTuitionDueDay = Object.freeze({
    loadState: loadState,
    mount: mount,
    saveSelection: saveSelection
  });
})();
