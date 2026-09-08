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
    anchorDate: null,
    options: [],
    selectedDueDay: null,
    firstDueDate: null
  };

  function getClient() {
    if (!window.Auth || typeof window.Auth.getClient !== "function") {
      throw new Error("A autenticação ainda não está disponível.");
    }
    return window.Auth.getClient();
  }

  function normalizeOptions(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map(function (item) { return Number(item); })
      .filter(function (item) { return Number.isInteger(item) && item >= 1 && item <= 31; });
  }

  async function loadState() {
    if (state.loaded) return state;
    if (state.loadingPromise) return state.loadingPromise;

    state.loadingPromise = (async function () {
      const response = await getClient().rpc("get_my_tuition_due_day_options");
      if (response.error) throw response.error;

      const payload = response.data || {};
      state.anchorDate = payload.anchor_date || null;
      state.options = normalizeOptions(payload.options);
      state.selectedDueDay = payload.selected_due_day == null ? null : Number(payload.selected_due_day);
      state.firstDueDate = payload.first_due_date || null;
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
      ".tuition-due-day-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:14px}",
      ".tuition-due-day-option{position:relative;display:block;cursor:pointer}",
      ".tuition-due-day-option input{position:absolute;opacity:0;pointer-events:none}",
      ".tuition-due-day-option span{display:flex;align-items:center;justify-content:center;min-height:52px;border:1.5px solid rgba(129,140,248,.32);border-radius:14px;background:rgba(129,140,248,.08);color:#e2e8f0;font-weight:700}",
      ".tuition-due-day-option input:checked+span{border-color:#818cf8;background:rgba(129,140,248,.22);color:#fff;box-shadow:0 0 0 2px rgba(129,140,248,.12)}",
      ".tuition-due-day-option input:focus-visible+span{outline:2px solid #c4b5fd;outline-offset:2px}",
      ".tuition-due-day-note{margin-top:10px;color:#94a3b8;font-size:12px;line-height:1.5}",
      "@media(max-width:540px){.tuition-due-day-options{grid-template-columns:1fr}}"
    ].join("");
    document.head.appendChild(style);
  }

  function getSelectedInputValue() {
    const checked = document.querySelector('input[name="tuitionDueDay"]:checked');
    return checked ? Number(checked.value) : null;
  }

  function buildSection() {
    const section = document.createElement("section");
    section.id = SECTION_ID;
    section.className = "form-section";
    section.setAttribute("aria-labelledby", "tuitionDueDayTitle");

    const heading = document.createElement("div");
    heading.className = "section-heading";
    heading.innerHTML = '<h2 id="tuitionDueDayTitle">Escolha o vencimento da mensalidade</h2>' +
      '<p>Você terá três opções calculadas a partir da data da sua matrícula.</p>';
    section.appendChild(heading);

    const options = document.createElement("div");
    options.className = "tuition-due-day-options";

    state.options.forEach(function (dueDay) {
      const label = document.createElement("label");
      label.className = "tuition-due-day-option";

      const input = document.createElement("input");
      input.type = "radio";
      input.name = "tuitionDueDay";
      input.value = String(dueDay);
      input.required = state.selectedDueDay == null;
      input.checked = state.selectedDueDay === dueDay;
      input.disabled = state.selectedDueDay != null;

      const text = document.createElement("span");
      text.textContent = "Dia " + dueDay;

      label.appendChild(input);
      label.appendChild(text);
      options.appendChild(label);
    });

    section.appendChild(options);

    const note = document.createElement("p");
    note.className = "tuition-due-day-note";
    note.textContent = state.selectedDueDay == null
      ? "Escolha uma das três opções. O valor da mensalidade continuará sendo definido pelo professor."
      : "Vencimento já registrado: dia " + state.selectedDueDay + ".";
    section.appendChild(note);

    return section;
  }

  async function mount() {
    const form = document.getElementById(FORM_ID);
    const message = document.getElementById(MESSAGE_ID);
    if (!form || !message) return false;
    if (document.getElementById(SECTION_ID)) return true;

    await loadState();
    ensureStyles();
    form.insertBefore(buildSection(), message);
    return true;
  }

  async function saveSelection() {
    await loadState();
    if (state.selectedDueDay != null) return state.selectedDueDay;

    await mount();
    const selectedDueDay = getSelectedInputValue();
    if (!Number.isInteger(selectedDueDay)) {
      throw new Error("Escolha uma das três opções de vencimento da mensalidade.");
    }

    const response = await getClient().rpc("set_my_tuition_due_day", {
      target_due_day: selectedDueDay
    });
    if (response.error) throw response.error;

    state.selectedDueDay = Number(response.data && response.data.due_day || selectedDueDay);
    state.firstDueDate = response.data && response.data.first_due_date || state.firstDueDate;
    return state.selectedDueDay;
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

  function initialize() {
    installProfileCompletionWrapper();
    mount().catch(function (error) {
      const message = document.getElementById(MESSAGE_ID);
      if (message && !message.textContent) {
        message.textContent = error.message || "Não foi possível carregar as opções de vencimento.";
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }

  window.StudentTuitionDueDay = Object.freeze({
    loadState: loadState,
    mount: mount,
    saveSelection: saveSelection
  });
})();
