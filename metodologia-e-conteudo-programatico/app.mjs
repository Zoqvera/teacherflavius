import { groupLessons, loadPublicCatalog } from "./catalog_service.mjs";

const REFRESH_INTERVAL_MS = 120000;
const REQUEST_TIMEOUT_MS = 12000;

const nodes = {
  heroCount: document.getElementById("catalogHeroCount"),
  stages: document.getElementById("catalogStages"),
  status: document.getElementById("catalogStatus"),
  retry: document.getElementById("catalogRetry")
};

const state = {
  isLoading: false,
  hasLoaded: false,
  lastLoadedAt: 0
};

function element(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function createLesson(lesson) {
  const item = element("li", "catalog-lesson");
  const number = element("span", "catalog-lesson-number", String(lesson.number).padStart(2, "0"));
  number.setAttribute("aria-hidden", "true");

  const content = element("div", "catalog-lesson-content");
  content.appendChild(element("h3", "catalog-lesson-heading", "Apresentação " + lesson.number + " — " + lesson.title));

  if (lesson.objective) {
    content.appendChild(element("p", "catalog-lesson-objective", lesson.objective));
  }

  item.append(number, content);
  return item;
}

function createStage(stage, expanded) {
  const card = element("details", "catalog-stage");
  card.dataset.stageKey = stage.key;
  card.open = expanded;

  const heading = element("span", "catalog-stage-heading");
  heading.append(
    element("span", "catalog-stage-eyebrow", stage.range),
    element("span", "catalog-stage-title", stage.title)
  );

  const summary = element("summary", "catalog-stage-summary");
  summary.append(
    heading,
    element("span", "catalog-stage-count", stage.lessons.length + (stage.lessons.length === 1 ? " lição" : " lições"))
  );

  const lessons = element("ol", "catalog-lesson-list");
  stage.lessons.forEach(lesson => lessons.appendChild(createLesson(lesson)));
  card.append(summary, lessons);
  return card;
}

function renderStages(lessons) {
  const groups = groupLessons(lessons);
  const expandedKeys = new Set(
    Array.from(nodes.stages.querySelectorAll(".catalog-stage[open]"))
      .map(card => card.dataset.stageKey)
  );

  const fragment = document.createDocumentFragment();
  if (groups.length === 0) {
    fragment.appendChild(element("p", "catalog-empty", "Ainda não há lições disponíveis."));
  } else {
    groups.forEach((stage, index) => {
      const expanded = state.hasLoaded ? expandedKeys.has(stage.key) : index === 0;
      fragment.appendChild(createStage(stage, expanded));
    });
  }

  nodes.stages.replaceChildren(fragment);
}

function displayError(message) {
  nodes.status.textContent = message;
  nodes.status.hidden = false;
  nodes.retry.hidden = false;
}

async function refreshCatalog() {
  if (state.isLoading || !nodes.stages) return;

  state.isLoading = true;
  nodes.stages.setAttribute("aria-busy", "true");
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const lessons = await loadPublicCatalog(window.fetch.bind(window), { signal: controller.signal });
    renderStages(lessons);
    if (nodes.heroCount) nodes.heroCount.textContent = String(lessons.length);
    state.hasLoaded = true;
    state.lastLoadedAt = Date.now();
    nodes.status.textContent = "";
    nodes.status.hidden = true;
    nodes.retry.hidden = true;
  } catch {
    displayError(
      state.hasLoaded
        ? "Não foi possível conferir as atualizações das lições."
        : "Não foi possível carregar as lições agora."
    );
  } finally {
    window.clearTimeout(timeout);
    nodes.stages.removeAttribute("aria-busy");
    state.isLoading = false;
  }
}

function refreshIfNeeded() {
  if (document.visibilityState !== "visible") return;
  if (Date.now() - state.lastLoadedAt < REFRESH_INTERVAL_MS) return;
  void refreshCatalog();
}

if (nodes.stages) {
  nodes.retry.addEventListener("click", () => void refreshCatalog());
  document.addEventListener("visibilitychange", refreshIfNeeded);
  window.setInterval(refreshIfNeeded, REFRESH_INTERVAL_MS);
  void refreshCatalog();
}
