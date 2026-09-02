let currentProfessorSession = null;

const PROFESSOR_CARD_ORDER_KEY = "teacherFlavius.professorCardOrder.v1";
const PROFESSOR_AUTH_MAX_ATTEMPTS = 10;
const PROFESSOR_AUTH_RETRY_DELAY_MS = 150;
const PROFESSOR_PATH = "/professor/";
const LOGIN_PATH = "/login/";

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

function setupAcquisitionCardDragging(grid, card) {
  if (!grid || !card) return;

  let draggingAcquisitionCard = false;
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
    draggingAcquisitionCard = true;
    dragStarted = true;
    card.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", card.dataset.cardId);
  });

  card.addEventListener("dragend", () => {
    draggingAcquisitionCard = false;
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
    if (!draggingAcquisitionCard) return;
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
    if (!draggingAcquisitionCard) return;
    event.preventDefault();
    clearDragOverState();
    saveProfessorCardOrder(grid);
  });
}

function ensureAcquisitionDashboardCard() {
  const grid = document.getElementById("professorMenuGrid");
  if (!grid || grid.querySelector('[data-card-id="marketing-acquisition"]')) return;

  const card = document.createElement("a");
  card.className = "menu-button";
  card.href = "/marketing_acquisition/";
  card.draggable = true;
  card.dataset.cardId = "marketing-acquisition";
  card.innerHTML = '<span><span class="icon" aria-hidden="true"></span>AQUISIÇÃO E IA</span><span class="arrow">›</span>';

  const reportsCard = grid.querySelector('[data-card-id="relatorios"]');
  if (reportsCard) {
    grid.insertBefore(card, reportsCard);
  } else {
    grid.appendChild(card);
  }

  applyProfessorCardOrder(grid);
  setupAcquisitionCardDragging(grid, card);
}

function redirectProfessorToLogin() {
  const nextPath = window.Auth.normalizeNextPath(window.location.pathname, PROFESSOR_PATH);
  window.location.href = LOGIN_PATH + "?next=" + encodeURIComponent(nextPath);
}

function professorAuthResourcesAreReady() {
  return !!(window.Auth && window.SUPABASE_CONFIG && window.Auth.isConfigured());
}

function waitForProfessorAuthResources() {
  if (!window.ResourceWaiter) return Promise.resolve(false);

  return window.ResourceWaiter.waitUntil(professorAuthResourcesAreReady, {
    maxAttempts: PROFESSOR_AUTH_MAX_ATTEMPTS,
    delayMs: PROFESSOR_AUTH_RETRY_DELAY_MS
  });
}

async function guardProfessorHome() {
  const status = document.getElementById("adminStatus");
  const menu = document.getElementById("professorMenuGrid");
  const resourcesReady = await waitForProfessorAuthResources();

  if (!resourcesReady) {
    if (status) status.textContent = "Não foi possível carregar a autenticação. Atualize a página ou limpe o cache do navegador.";
    if (menu) menu.hidden = true;
    document.body.classList.remove("auth-checking");
    return;
  }

  currentProfessorSession = await window.Auth.getSession();
  if (!currentProfessorSession || !currentProfessorSession.user) {
    redirectProfessorToLogin();
    return;
  }

  try {
    const response = await window.Auth.getClient().rpc("is_teacher_admin");
    if (response.error) throw response.error;

    if (response.data !== true) {
      if (status) status.textContent = "Acesso negado. Esta área é exclusiva do administrador.";
      if (menu) menu.hidden = true;
      document.body.classList.remove("auth-checking");
      return;
    }

    if (status) status.textContent = "Professor autenticado: " + currentProfessorSession.user.email + ".";
    document.body.classList.remove("auth-checking");
  } catch (error) {
    if (status) status.textContent = "Não foi possível confirmar as credenciais administrativas. Reexecute supabase_professor_admin.sql no Supabase.";
    if (menu) menu.hidden = true;
    document.body.classList.remove("auth-checking");
  }
}

ensureAcquisitionDashboardCard();
guardProfessorHome();
