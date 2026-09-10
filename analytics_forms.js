(function () {
  "use strict";

  const RETRY_INTERVAL_MS = 250;
  const MAX_RETRY_ATTEMPTS = 60;

  function assertDependencies(dependencies) {
    if (!dependencies || typeof dependencies.track !== "function") {
      throw new Error("Analytics form instrumentation requires track().");
    }
    if (!dependencies.utils) {
      throw new Error("Analytics form instrumentation requires utilities.");
    }
  }

  function create(dependencies) {
    assertDependencies(dependencies);
    const deps = dependencies;
    const formStates = new Map();

    function formName(form) {
      return deps.utils.cleanText(
        form && (form.id || form.getAttribute("name") || "form"),
        80
      ) || "form";
    }

    function isLeadForm(form) {
      if (!form) return false;
      const name = formName(form).toLowerCase();
      const area = deps.utils.classifyArea(deps.utils.currentPath());
      return area === "enrollment" || /cadastro|matricula|lead|contact|profile/.test(name);
    }

    function ensureFormState(form) {
      if (!formStates.has(form)) {
        formStates.set(form, {
          started: false,
          submitted: false,
          completed: false,
          startedAt: 0,
          touched: new Set()
        });
      }
      return formStates.get(form);
    }

    function markFormInteraction(event) {
      const field = event.target;
      const form = field && field.form;
      if (!form || !isLeadForm(form)) return;

      const state = ensureFormState(form);
      if (!state.started) {
        state.started = true;
        state.startedAt = Date.now();
        deps.track("lead_form_start", { form_name: formName(form) });
      }

      if (field.id || field.name) {
        state.touched.add(deps.utils.cleanText(field.id || field.name, 80));
      }
    }

    function handleFormSubmit(event) {
      const form = event.target;
      if (!form || !isLeadForm(form)) return;

      const state = ensureFormState(form);
      state.submitted = true;
      deps.track("lead_form_submit", {
        form_name: formName(form),
        fields_touched: state.touched.size,
        time_to_submit_seconds: state.startedAt
          ? Math.round((Date.now() - state.startedAt) / 1000)
          : 0
      });
    }

    function markFormComplete(name) {
      document.querySelectorAll("form").forEach(function (form) {
        if (formName(form) !== name) return;
        const state = ensureFormState(form);
        state.completed = true;
        state.submitted = true;
      });
    }

    function markFormSubmitFailed(name) {
      document.querySelectorAll("form").forEach(function (form) {
        if (formName(form) !== name) return;
        ensureFormState(form).submitted = false;
      });
    }

    function trackAbandonedForms() {
      formStates.forEach(function (state, form) {
        if (!state.started || state.submitted || state.completed) return;
        deps.track("lead_form_abandon", {
          form_name: formName(form),
          fields_touched: state.touched.size,
          time_on_form_seconds: state.startedAt
            ? Math.round((Date.now() - state.startedAt) / 1000)
            : 0,
          transport_type: "beacon"
        });
      });
    }

    function installAuthInstrumentation() {
      if (
        !window.Auth ||
        typeof window.Auth.completeProfile !== "function" ||
        window.Auth.completeProfile.__tfAnalyticsWrapped
      ) {
        return false;
      }

      const original = window.Auth.completeProfile;
      const wrapped = async function () {
        try {
          const result = await original.apply(this, arguments);
          markFormComplete("completeProfileForm");
          deps.track("sign_up", {
            method: "google",
            form_name: "completeProfileForm"
          });
          return result;
        } catch (error) {
          markFormSubmitFailed("completeProfileForm");
          deps.track("lead_form_error", {
            form_name: "completeProfileForm",
            error_type: "profile_completion_failed"
          });
          throw error;
        }
      };

      wrapped.__tfAnalyticsWrapped = true;
      window.Auth.completeProfile = wrapped;
      return true;
    }

    function retryAuthInstrumentation() {
      if (deps.utils.classifyArea(deps.utils.currentPath()) !== "enrollment") return;
      let attempts = 0;
      const timer = window.setInterval(function () {
        attempts += 1;
        if (installAuthInstrumentation() || attempts >= MAX_RETRY_ATTEMPTS) {
          window.clearInterval(timer);
        }
      }, RETRY_INTERVAL_MS);
    }

    function initialize() {
      document.addEventListener("focusin", markFormInteraction, true);
      document.addEventListener("change", markFormInteraction, true);
      document.addEventListener("input", markFormInteraction, true);
      document.addEventListener("submit", handleFormSubmit, true);
      window.addEventListener("pagehide", trackAbandonedForms);
      installAuthInstrumentation();
      retryAuthInstrumentation();
    }

    return Object.freeze({
      initialize: initialize,
      markFormComplete: markFormComplete,
      markFormSubmitFailed: markFormSubmitFailed
    });
  }

  window.TeacherAnalyticsForms = Object.freeze({
    create: create
  });
})();
