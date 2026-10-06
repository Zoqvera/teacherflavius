(function () {
  "use strict";

  if (window.EnrollmentOnboardingState) return;

  const VALID_MODES = Object.freeze([
    "new_enrollment",
    "existing_student_profile_completion",
    "complete"
  ]);

  let cachedState = null;
  let loadingPromise = null;

  function getClient() {
    if (!window.Auth || typeof window.Auth.getClient !== "function") {
      throw new Error("A autenticação ainda não está disponível.");
    }
    return window.Auth.getClient();
  }

  function normalizeState(payload) {
    const source = payload || {};
    const mode = String(source.mode || "");

    if (!VALID_MODES.includes(mode)) {
      throw new Error("O estado da matrícula retornado pelo servidor é inválido.");
    }

    return Object.freeze({
      mode: mode,
      profileExists: source.profile_exists === true,
      profileCompleted: source.profile_completed === true,
      enrolled: source.enrolled === true,
      requiresAccessCode: source.requires_access_code === true,
      enrollmentAccessAuthorized: source.enrollment_access_authorized === true,
      requiresClassMode: source.requires_class_mode === true,
      requiresTuitionDueDate: source.requires_tuition_due_date === true,
      requiresCommercialSetup: source.requires_commercial_setup === true,
      formUnlocked: source.form_unlocked === true
    });
  }

  async function load(forceRefresh) {
    if (!forceRefresh && cachedState) return cachedState;
    if (!forceRefresh && loadingPromise) return loadingPromise;

    loadingPromise = (async function () {
      const response = await getClient().rpc("get_my_enrollment_onboarding_state");
      if (response.error) throw response.error;
      cachedState = normalizeState(response.data);
      return cachedState;
    })().finally(function () {
      loadingPromise = null;
    });

    return loadingPromise;
  }

  function get() {
    return load(false);
  }

  function refresh() {
    return load(true);
  }

  function clear() {
    cachedState = null;
  }

  window.EnrollmentOnboardingState = Object.freeze({
    get: get,
    refresh: refresh,
    clear: clear
  });
})();
