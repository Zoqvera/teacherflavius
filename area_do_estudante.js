(function () {
  "use strict";

  const EXERCISE_SCHEDULE_CUTOFF = "2026-07-30";
  const EXERCISE_TIME_ZONE = "America/Sao_Paulo";
  const PROFESSOR_EMAIL = "flaviofreitas@ufu.br";
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const AUTH_RESOURCE_MAX_ATTEMPTS = 10;
  const AUTH_RESOURCE_RETRY_DELAY_MS = 150;
  const STUDENT_AREA_PATH = "/area-do-estudante/";
  const STUDENT_RESOURCES_PATH = "/area-do-estudante/recursos/";
  const LOGIN_PATH = "/login/";
  const FALLBACK_EXERCISES_PATH = "/exercicios-diarios/";

  const state = {
    session: null,
    isProfessor: false
  };

  function redirectToLogin() {
    const next = encodeURIComponent(STUDENT_AREA_PATH);
    window.location.href = LOGIN_PATH + "?next=" + next;
  }

  function authResourcesAreReady() {
    return !!(window.Auth && window.SUPABASE_CONFIG && Auth.isConfigured());
  }

  function waitForAuthResources() {
    return window.ResourceWaiter.waitUntil(authResourcesAreReady, {
      maxAttempts: AUTH_RESOURCE_MAX_ATTEMPTS,
      delayMs: AUTH_RESOURCE_RETRY_DELAY_MS
    });
  }

  function extractActivityNumber(title) {
    const match = String(title || "").match(/ATIVIDADE\s+(\d+)/i);
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
  }

  function dateKeyInSaoPaulo(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: EXERCISE_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);

    const values = {};
    parts.forEach(function (part) {
      if (part.type !== "literal") values[part.type] = part.value;
    });

    return values.year + "-" + values.month + "-" + values.day;
  }

  function dateKeyToUtcMs(dateKey) {
    const match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return NaN;
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  function getExerciseScheduleStartDate(profile) {
    const storedStartDate = profile && profile.exercise_schedule_start_date
      ? String(profile.exercise_schedule_start_date).slice(0, 10)
      : "";

    if (/^\d{4}-\d{2}-\d{2}$/.test(storedStartDate)) return storedStartDate;

    const profileCreatedDate = profile && profile.created_at
      ? dateKeyInSaoPaulo(profile.created_at)
      : "";

    if (!profileCreatedDate || profileCreatedDate <= EXERCISE_SCHEDULE_CUTOFF) {
      return EXERCISE_SCHEDULE_CUTOFF;
    }

    return profileCreatedDate;
  }

  function getCurrentExerciseWeek(profile) {
    const startDateKey = getExerciseScheduleStartDate(profile);
    const todayKey = dateKeyInSaoPaulo(new Date());
    const startMs = dateKeyToUtcMs(startDateKey);
    const todayMs = dateKeyToUtcMs(todayKey);

    if (!Number.isFinite(startMs) || !Number.isFinite(todayMs) || todayMs < startMs) return 0;

    const elapsedDays = Math.floor((todayMs - startMs) / MS_PER_DAY);
    return Math.floor(elapsedDays / 7) + 1;
  }

  function getLoggedEmail() {
    const user = state.session && state.session.user;
    return user && user.email ? String(user.email).trim().toLowerCase() : "";
  }

  function isProfessorSession() {
    return state.isProfessor || getLoggedEmail() === PROFESSOR_EMAIL;
  }

  async function detectProfessorSession() {
    state.isProfessor = getLoggedEmail() === PROFESSOR_EMAIL;

    try {
      const response = await Auth.getClient().rpc("is_teacher_admin");
      if (!response.error && response.data === true) state.isProfessor = true;
    } catch (error) {
      console.warn("Não foi possível confirmar credenciais de professor no banco:", error);
    }

    return state.isProfessor;
  }

  function updateProfessorAreaVisibility() {
    const professorSection = document.getElementById("professorAreaSection");
    if (professorSection) professorSection.hidden = !isProfessorSession();
  }

  function createStudentResourcesCard() {
    const card = document.createElement("a");
    card.className = "menu-button";
    card.href = STUDENT_RESOURCES_PATH;
    card.dataset.studentResourcesCard = "true";

    const label = document.createElement("span");
    label.className = "menu-label";

    const icon = document.createElement("span");
    icon.className = "icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = '<svg class="tf-icon-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18"/><path d="M12 3a15 15 0 0 0 0 18"/></svg>';

    label.appendChild(icon);
    label.appendChild(document.createTextNode("RECURSOS"));

    const arrow = document.createElement("span");
    arrow.className = "arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "›";

    card.appendChild(label);
    card.appendChild(arrow);
    return card;
  }

  function ensureStudentResourcesCard() {
    if (document.querySelector('[data-student-resources-card="true"]')) return;

    const studySection = document.querySelector('[aria-labelledby="studyTitle"]');
    const studyGrid = studySection ? studySection.querySelector(".menu-grid") : null;
    if (!studyGrid) return;

    studyGrid.appendChild(createStudentResourcesCard());
  }

  function countAvailabilitySlots(profile) {
    const availability = profile && profile.availability && typeof profile.availability === "object"
      ? profile.availability
      : {};

    return Object.keys(availability).reduce(function (total, day) {
      const daySlots = Array.isArray(availability[day]) ? availability[day].length : 0;
      return total + daySlots;
    }, 0);
  }

  function updateProfileSetupPrompt(profile) {
    const prompt = document.getElementById("profileSetupPrompt");
    if (prompt) prompt.hidden = isProfessorSession() || countAvailabilitySlots(profile) > 0;
  }

  function hideProfileSetupPrompt() {
    const prompt = document.getElementById("profileSetupPrompt");
    if (prompt) prompt.hidden = true;
  }

  function closeOverdueModal() {
    const modal = document.getElementById("overdueModal");
    if (modal) modal.hidden = true;
  }

  function bindOverdueModal() {
    const modal = document.getElementById("overdueModal");
    const closeButton = document.getElementById("overdueClose");

    if (closeButton) closeButton.addEventListener("click", closeOverdueModal);

    if (modal) {
      modal.addEventListener("click", function (event) {
        if (event.target === modal) closeOverdueModal();
      });
    }

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeOverdueModal();
    });
  }

  function showAuthLoadError(status) {
    document.body.classList.remove("auth-checking");
    if (!status) return;
    status.hidden = false;
    status.textContent = "Não foi possível carregar a autenticação. Atualize a página ou limpe o cache do navegador.";
  }

  async function guardStudentArea() {
    const status = document.getElementById("loginStatus");
    const resourcesReady = await waitForAuthResources();

    if (!resourcesReady) {
      showAuthLoadError(status);
      return false;
    }

    state.session = await Auth.getSession();

    if (!state.session || !state.session.user) {
      redirectToLogin();
      return false;
    }

    await detectProfessorSession();
    updateProfessorAreaVisibility();

    if (isProfessorSession()) {
      closeOverdueModal();
      hideProfileSetupPrompt();
    }

    document.body.classList.remove("auth-checking");
    return true;
  }

  async function loadPublishedExercises() {
    const response = await Auth.getClient().rpc("get_public_teacher_exercises");
    if (response.error) throw response.error;

    return (response.data || []).map(function (item) {
      return {
        id: item.exercise_id,
        title: item.exercise_title,
        url: item.exercise_url
      };
    });
  }

  async function loadStudentCompletions() {
    const response = await Auth.getClient()
      .from("daily_exercise_completion")
      .select("exercise_id, completed")
      .eq("user_id", state.session.user.id);

    if (response.error) throw response.error;
    return response.data || [];
  }

  function buildCompletionMap(completions) {
    const completedByExerciseId = new Map();
    completions.forEach(function (row) {
      completedByExerciseId.set(row.exercise_id, row.completed === true);
    });
    return completedByExerciseId;
  }

  function isExerciseOverdue(exercise, completedByExerciseId, currentWeek) {
    if (!exercise.id || completedByExerciseId.get(exercise.id) === true) return false;
    const activityNumber = extractActivityNumber(exercise.title);
    return Number.isFinite(activityNumber) && activityNumber < currentWeek;
  }

  function compareExercisesByActivityNumber(a, b) {
    const numberDifference = extractActivityNumber(a.title) - extractActivityNumber(b.title);
    if (numberDifference !== 0) return numberDifference;
    return String(a.title || "").localeCompare(String(b.title || ""), "pt-BR");
  }

  function findFirstOverdueExercise(exercises, completions, currentWeek) {
    const completedByExerciseId = buildCompletionMap(completions);
    const overdueExercises = exercises
      .filter(function (exercise) {
        return isExerciseOverdue(exercise, completedByExerciseId, currentWeek);
      })
      .sort(compareExercisesByActivityNumber);

    if (!overdueExercises.length) return null;
    return overdueExercises.find(function (exercise) { return !!exercise.url; }) || overdueExercises[0];
  }

  function showOverdueExercise(exercise) {
    const modal = document.getElementById("overdueModal");
    const link = document.getElementById("overdueActivityLink");
    if (!modal || !link || !exercise) return;

    link.textContent = exercise.title || "Abrir atividade atrasada";
    link.href = exercise.url || FALLBACK_EXERCISES_PATH;
    modal.hidden = false;
  }

  async function showOverdueActivityIfNeeded(profile) {
    const modal = document.getElementById("overdueModal");
    const link = document.getElementById("overdueActivityLink");
    if (!modal || !link) return;

    if (isProfessorSession()) {
      modal.hidden = true;
      return;
    }

    try {
      const currentWeek = getCurrentExerciseWeek(profile);
      if (currentWeek <= 1) {
        modal.hidden = true;
        return;
      }

      const [exercises, completions] = await Promise.all([
        loadPublishedExercises(),
        loadStudentCompletions()
      ]);

      if (isProfessorSession()) {
        modal.hidden = true;
        return;
      }

      const overdueExercise = findFirstOverdueExercise(exercises, completions, currentWeek);
      if (!overdueExercise) {
        modal.hidden = true;
        return;
      }

      showOverdueExercise(overdueExercise);
    } catch (error) {
      console.error("Não foi possível verificar atividades atrasadas:", error);
      modal.hidden = true;
    }
  }

  function clearLoginStatus() {
    const status = document.getElementById("loginStatus");
    if (!status) return;
    status.textContent = "";
    status.hidden = true;
  }

  async function updateStatus() {
    const isAllowed = await guardStudentArea();
    if (!isAllowed) return;

    clearLoginStatus();

    if (isProfessorSession()) {
      closeOverdueModal();
      hideProfileSetupPrompt();
      return;
    }

    try {
      const profile = await Auth.getProfile();
      updateProfileSetupPrompt(profile);
      await showOverdueActivityIfNeeded(profile);
    } catch (error) {
      console.error("Não foi possível carregar o ciclo semanal do aluno:", error);
      hideProfileSetupPrompt();
      closeOverdueModal();
    }
  }

  ensureStudentResourcesCard();
  bindOverdueModal();
  updateStatus();
})();
