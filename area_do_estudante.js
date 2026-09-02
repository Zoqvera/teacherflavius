let currentSession = null;
let currentUserIsProfessor = false;

const EXERCISE_SCHEDULE_CUTOFF = "2026-07-30";
const EXERCISE_TIME_ZONE = "America/Sao_Paulo";
const PROFESSOR_EMAIL = "flaviofreitas@ufu.br";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function redirectToLogin() {
  window.location.href = "/login/?next=" + encodeURIComponent("/area-do-estudante/");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForAuthResources() {
  for (let i = 0; i < 10; i++) {
    if (window.Auth && window.SUPABASE_CONFIG && Auth.isConfigured()) return true;
    await sleep(150);
  }
  return !!(window.Auth && window.SUPABASE_CONFIG && Auth.isConfigured());
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

  if (/^\d{4}-\d{2}-\d{2}$/.test(storedStartDate)) {
    return storedStartDate;
  }

  const profileCreatedDate = profile && profile.created_at ? dateKeyInSaoPaulo(profile.created_at) : "";
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
  return currentSession && currentSession.user && currentSession.user.email
    ? String(currentSession.user.email).trim().toLowerCase()
    : "";
}

function isProfessorSession() {
  return currentUserIsProfessor || getLoggedEmail() === PROFESSOR_EMAIL;
}

async function detectProfessorSession() {
  currentUserIsProfessor = getLoggedEmail() === PROFESSOR_EMAIL;

  try {
    const client = Auth.getClient();
    const response = await client.rpc("is_teacher_admin");
    if (!response.error && response.data === true) {
      currentUserIsProfessor = true;
    }
  } catch (error) {
    console.warn("Não foi possível confirmar credenciais de professor no banco:", error);
  }

  return currentUserIsProfessor;
}

function updateProfessorAreaVisibility() {
  const professorSection = document.getElementById("professorAreaSection");
  if (!professorSection) return;
  professorSection.hidden = !isProfessorSession();
}

function countAvailabilitySlots(profile) {
  const availability = profile && profile.availability && typeof profile.availability === "object"
    ? profile.availability
    : {};

  return Object.keys(availability).reduce(function (total, day) {
    return total + (Array.isArray(availability[day]) ? availability[day].length : 0);
  }, 0);
}

function updateProfileSetupPrompt(profile) {
  const prompt = document.getElementById("profileSetupPrompt");
  if (!prompt) return;
  prompt.hidden = isProfessorSession() || countAvailabilitySlots(profile) > 0;
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

  if (closeButton) {
    closeButton.addEventListener("click", closeOverdueModal);
  }

  if (modal) {
    modal.addEventListener("click", function (event) {
      if (event.target === modal) closeOverdueModal();
    });
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeOverdueModal();
  });
}

async function guardStudentArea() {
  const status = document.getElementById("loginStatus");
  const resourcesReady = await waitForAuthResources();

  if (!resourcesReady) {
    document.body.classList.remove("auth-checking");
    if (status) {
      status.hidden = false;
      status.textContent = "Não foi possível carregar a autenticação. Atualize a página ou limpe o cache do navegador.";
    }
    return false;
  }

  currentSession = await Auth.getSession();

  if (!currentSession || !currentSession.user) {
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
  const client = Auth.getClient();
  const response = await client.rpc("get_public_teacher_exercises");
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
  const client = Auth.getClient();
  const response = await client
    .from("daily_exercise_completion")
    .select("exercise_id, completed")
    .eq("user_id", currentSession.user.id);

  if (response.error) throw response.error;
  return response.data || [];
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

    const results = await Promise.all([
      loadPublishedExercises(),
      loadStudentCompletions()
    ]);

    if (isProfessorSession()) {
      modal.hidden = true;
      return;
    }

    const exercises = results[0];
    const completions = results[1];
    const completedMap = new Map();

    completions.forEach(function (row) {
      completedMap.set(row.exercise_id, row.completed === true);
    });

    const overdue = exercises
      .filter(function (exercise) {
        if (!exercise.id || completedMap.get(exercise.id) === true) return false;
        const activityNumber = extractActivityNumber(exercise.title);
        return Number.isFinite(activityNumber) && activityNumber < currentWeek;
      })
      .sort(function (a, b) {
        const numberDiff = extractActivityNumber(a.title) - extractActivityNumber(b.title);
        return numberDiff !== 0 ? numberDiff : String(a.title || "").localeCompare(String(b.title || ""), "pt-BR");
      });

    if (!overdue.length || isProfessorSession()) {
      modal.hidden = true;
      return;
    }

    const overdueExercise = overdue.find(function (exercise) {
      return !!exercise.url;
    }) || overdue[0];

    link.textContent = overdueExercise.title || "Abrir atividade atrasada";
    link.href = overdueExercise.url || "/exercicios-diarios/";
    modal.hidden = false;
  } catch (error) {
    console.error("Não foi possível verificar atividades atrasadas:", error);
    modal.hidden = true;
  }
}

async function updateStatus() {
  const isAllowed = await guardStudentArea();
  if (!isAllowed) return;

  const status = document.getElementById("loginStatus");
  if (status) {
    status.textContent = "";
    status.hidden = true;
  }

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

bindOverdueModal();
updateStatus();
