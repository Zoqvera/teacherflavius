let currentProfessorSession = null;

const PROFESSOR_CARD_ORDER_KEY = "teacherFlavius.professorCardOrder.v1";
const PROFESSOR_AUTH_MAX_ATTEMPTS = 40;
const PROFESSOR_AUTH_RETRY_DELAY_MS = 100;
const PROFESSOR_PATH = "/professor/";
const LOGIN_PATH = "/login/";
const PROFESSOR_MFA_CSS = "/professor_mfa_gate.css?v=20260909-1";
const PROFESSOR_MFA_MODULES = Object.freeze({
  service: Object.freeze({
    globalName: "ProfessorMfaService",
    selector: 'script[src^="/professor_mfa_service.js"]',
    src: "/professor_mfa_service.js?v=20260909-1",
    missingMessage: "O serviço MFA do professor não foi inicializado.",
    loadErrorMessage: "Não foi possível carregar o serviço MFA do professor."
  }),
  gate: Object.freeze({
    globalName: "ProfessorMfaGate",
    selector: 'script[src^="/professor_mfa_gate.js"]',
    src: "/professor_mfa_gate.js?v=20260909-1",
    missingMessage: "O gate MFA do professor não foi inicializado.",
    loadErrorMessage: "Não foi possível carregar o gate MFA do professor."
  })
});

function applyProfessorCardOrder(grid) {
  if (!grid) return;
  try {
    const savedOrder = JSON.parse(localStorage.getItem(PROFESSOR_CARD_ORDER_KEY) || "[]");
    if (!Array.isArray(savedOrder) || !savedOrder.length) return;

    const cards = Array.from(grid.querySelectorAll(".menu-button[data-card-id]"));
    const cardsById = new Map(cards.map(card => [card.dataset.cardId, card]));

    savedOrder.forEach(id => {
      const card = cardsById.get(id);
      if (card) grid.appendChild(card);
    });

    Array.from(grid.querySelectorAll(".menu-button[data-card-id]")).forEach(card => {
      if (!savedOrder.includes(card.dataset.cardId)) grid.appendChild(card);
    });
  } catch (error) {
    // Mantém a ordem padrão se o armazenamento local estiver indisponível/corrompido.
  }
}

function saveProfessorCardOrder(grid) {
  if (!grid) return;
  try {
    const order = Array.from(grid.querySelectorAll(".menu-button[data-card-id]"))
      .map(card => card.dataset.cardId);
    localStorage.setItem(PROFESSOR_CARD_ORDER_KEY, JSON.stringify(order));
  } catch (error) {
    // A navegação continua funcional mesmo sem persistência local.
  }
}

function setupDynamicCardDragging(grid, card) {
  if (!grid || !card) return;

  let draggingCard = false;
  let dragStarted = false;

  function getCards() {
    return Array.from(grid.querySelectorAll(".menu-button[data-card-id]"));
  }

  function clearDragOverState() {
    getCards().forEach(item => item.classList.remove("drag-over"));
  }

  function getInsertionTarget(mouseY) {
    const candidates = getCards().filter(item => item !== card);
    let closest = { offset: Number.NEGATIVE_INFINITY, element: null };

    candidates.forEach(item => {
      const box = item.getBoundingClientRect();
      const offset = mouseY - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        closest = { offset, element: item };
      }
    });

    return closest.element;
  }

  card.addEventListener("dragstart", event => {
    draggingCard = true;
    dragStarted = true;
    card.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", card.dataset.cardId);
  });

  card.addEventListener("dragend", () => {
    draggingCard = false;
    card.classList.remove("dragging");
    clearDragOverState();
    saveProfessorCardOrder(grid);
    setTimeout(() => { dragStarted = false; }, 0);
  });

  card.addEventListener("click", event => {
    if (dragStarted) {
      event.preventDefault();
      event.stopPropagation();
    }
  });

  grid.addEventListener("dragover", event => {
    if (!draggingCard) return;
    event.preventDefault();

    const target = getInsertionTarget(event.clientY);
    clearDragOverState();

    if (target) {
      target.classList.add("drag-over");
      grid.insertBefore(card, target);
    } else {
      grid.appendChild(card);
    }
  });

  grid.addEventListener("drop", event => {
    if (!draggingCard) return;
    event.preventDefault();
    clearDragOverState();
    saveProfessorCardOrder(grid);
  });
}

function createDynamicProfessorCard(config) {
  const card = document.createElement("a");
  card.className = "menu-button";
  card.href = config.href;
  card.draggable = true;
  card.dataset.cardId = config.id;
  card.innerHTML = '<span><span class="icon" aria-hidden="true"></span>' + config.label + '</span><span class="arrow">›</span>';
  return card;
}

function ensureProfessorDashboardCard(config) {
  const grid = document.getElementById("professorMenuGrid");
  if (!grid || grid.querySelector('[data-card-id="' + config.id + '"]')) return;

  const card = createDynamicProfessorCard(config);
  const anchor = config.beforeId ? grid.querySelector('[data-card-id="' + config.beforeId + '"]') : null;
  if (anchor) grid.insertBefore(card, anchor);
  else grid.appendChild(card);

  applyProfessorCardOrder(grid);
  setupDynamicCardDragging(grid, card);
}

function ensureDynamicProfessorCards() {
  ensureProfessorDashboardCard({
    id: "aulas-experimentais",
    href: "/aulas-experimentais/",
    label: "AULAS EXPERIMENTAIS",
    beforeId: "reposicoes"
  });
  ensureProfessorDashboardCard({
    id: "marketing-acquisition",
    href: "/marketing_acquisition/",
    label: "CONVERSÃO",
    beforeId: "relatorios"
  });
}

function redirectProfessorToLogin() {
  const nextPath = window.Auth.normalizeNextPath(window.location.pathname, PROFESSOR_PATH);
  window.location.href = LOGIN_PATH + "?next=" + encodeURIComponent(nextPath);
}

function professorAuthResourcesAreReady() {
  return !!(
    window.Auth &&
    window.SUPABASE_CONFIG &&
    window.ModuleLoader &&
    typeof window.ModuleLoader.loadGlobalModule === "function" &&
    window.Auth.isConfigured()
  );
}

function waitForProfessorAuthResources() {
  if (!window.ResourceWaiter) return Promise.resolve(false);

  return window.ResourceWaiter.waitUntil(professorAuthResourcesAreReady, {
    maxAttempts: PROFESSOR_AUTH_MAX_ATTEMPTS,
    delayMs: PROFESSOR_AUTH_RETRY_DELAY_MS
  });
}

function appendProfessorMfaStyles() {
  if (document.querySelector('link[href^="/professor_mfa_gate.css"]')) return;
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = PROFESSOR_MFA_CSS;
  document.head.appendChild(stylesheet);
}

async function loadProfessorMfaGate() {
  appendProfessorMfaStyles();
  await window.ModuleLoader.loadGlobalModule(PROFESSOR_MFA_MODULES.service);
  return window.ModuleLoader.loadGlobalModule(PROFESSOR_MFA_MODULES.gate);
}

function showProfessorAccessFailure(status, menu, message) {
  if (status) status.textContent = message;
  if (menu) menu.hidden = true;
  document.body.classList.remove("auth-checking");
}

async function guardProfessorHome() {
  const status = document.getElementById("adminStatus");
  const menu = document.getElementById("professorMenuGrid");
  const resourcesReady = await waitForProfessorAuthResources();

  if (!resourcesReady) {
    showProfessorAccessFailure(
      status,
      menu,
      "Não foi possível carregar a autenticação. Atualize a página ou limpe o cache do navegador."
    );
    return;
  }

  currentProfessorSession = await window.Auth.getSession();
  if (!currentProfessorSession || !currentProfessorSession.user) {
    redirectProfessorToLogin();
    return;
  }

  try {
    const client = window.Auth.getClient();
    const response = await client.rpc("is_teacher_admin");
    if (response.error) throw response.error;

    if (response.data !== true) {
      showProfessorAccessFailure(status, menu, "Acesso negado. Esta área é exclusiva do administrador.");
      return;
    }

    const mfaGate = await loadProfessorMfaGate();
    await mfaGate.requireAal2({ client: client });

    if (status) {
      status.textContent = "Professor autenticado com verificação em duas etapas: " +
        currentProfessorSession.user.email + ".";
    }
    document.body.classList.remove("auth-checking");
  } catch (error) {
    console.error("Falha na verificação administrativa:", error);
    showProfessorAccessFailure(
      status,
      menu,
      "Não foi possível concluir a verificação de segurança da conta administrativa."
    );
  }
}

ensureDynamicProfessorCards();
guardProfessorHome();
