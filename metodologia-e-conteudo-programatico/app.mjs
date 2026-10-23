import {
  filterLessons,
  groupLessons,
  loadPublicCatalog
} from "./catalog_service.mjs";

const REFRESH_INTERVAL_MS = 120000;
const REQUEST_TIMEOUT_MS = 12000;

const nodes = {
  heroCount: document.getElementById("catalogHeroCount"),
  totalCount: document.getElementById("catalogTotalCount"),
  search: document.getElementById("catalogSearch"),
  clearSearch: document.getElementById("catalogClearSearch"),
  stages: document.getElementById("catalogStages"),
  status: document.getElementById("catalogStatus"),
  resultCount: document.getElementById("catalogResultCount"),
  retry: document.getElementById("catalogRetry")
};

const state = {
  lessons: [],
  hasLoaded: false,
  isLoading: false,
  lastLoadedAt: 0
};

function setMessage(message, type = "") {
  nodes.status.textContent = message;
  nodes.status.dataset.state = type;
}

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
  const heading = element("h3", "catalog-lesson-heading", "Apresentação " + lesson.number + " — " + lesson.title);
  content.appendChild(heading);

  if (lesson.objective) {
    content.appendChild(element("p", "catalog-lesson-objective", lesson.objective));
  }

  item.append(number, content);
  return item;
}

function createStage(stage, position, isSearching) {
  const card = element("details", "catalog-stage");
  card.open = isSearching || position === 0;

  const summary = element("summary", "catalog-stage-summary");
  const titleBlock = element("span", "catalog-stage-heading");
  titleBlock.append(
    element("span", "catalog-stage-eyebrow", stage.range),
    element("span", "catalog-stage-title", stage.title)
  );
  summary.append(
    titleBlock,
    element("span", "catalog-stage-count", stage.lessons.length + (stage.lessons.length === 1 ? " lição" : " lições"))
  );

  const list = element("ol", "catalog-lesson-list");
  for (const lesson of stage.lessons) {
    list.appendChild(createLesson(lesson));
  }

  card.append(summary, list);
  return card;
}

function renderCatalog() {
  const query = nodes.search.value.trim();
  const matches = filterLessons(state.lessons, query);
  const stages = groupLessons(state.lessons)
    .map((stage) => ({ ...stage, lessons: filterLessons(stage.lessons, query) }))
    .filter((stage) => stage.lessons.length > 0);

  nodes.clearSearch.hidden = !query;
  nodes.resultCount.textContent = query
    ? matches.length + " de " + state.lessons.length + " lições encontradas"
    : "Explore o conteúdo organizado por objetivos comunicativos.";

  const fragment = document.createDocumentFragment();
  if (matches.length === 0) {
    const empty = element("p", "catalog-empty",
      query ? "Nenhuma lição corresponde à pesquisa. Experimente outro termo."
        : "Ainda não há lições vinculadas ao Roteiro de Estudos.");
    fragment.appendChild(empty);
  } else {
    stages.forEach((stage, index) => fragment.appendChild(createStage(stage, index, Boolean(query))));
  }

  nodes.stages.replaceChildren(fragment);
}

function setCatalogCounts(total) {
  nodes.heroCount.textContent = String(total);
  nodes.totalCount.textContent = String(total);
}

async function refreshCatalog() {
  if (state.isLoading) return;

  state.isLoading = true;
  nodes.stages.setAttribute("aria-busy", "true");
  nodes.retry.hidden = true;

  if (!state.hasLoaded) {
    setMessage("Consultando as lições do Roteiro de Estudos...");
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const lessons = await loadPublicCatalog(window.fetch.bind(window), { signal: controller.signal });
    const hadLoaded = state.hasLoaded;
    const previousCount = state.lessons.length;

    state.lessons = lessons;
    state.hasLoaded = true;
    state.lastLoadedAt = Date.now();

    setCatalogCounts(lessons.length);
    renderCatalog();

    if (hadLoaded && lessons.length > previousCount) {
      setMessage("O conteúdo programático foi atualizado com novas lições.", "success");
    } else {
      setMessage("Conteúdo programático sincronizado com o Roteiro de Estudos.", "success");
    }
  } catch {
    if (!state.hasLoaded) {
      setCatalogCounts(0);
      nodes.stages.replaceChildren();
    }
    setMessage(
      state.hasLoaded
        ? "Não foi possível conferir atualizações. O último conteúdo carregado continua disponível."
        : "Não foi possível carregar as lições agora. Tente novamente.",
      "error"
    );
    nodes.retry.hidden = false;
  } finally {
    window.clearTimeout(timeout);
    state.isLoading = false;
    nodes.stages.removeAttribute("aria-busy");
  }
}

function refreshIfNeeded() {
  if (document.visibilityState !== "visible") return;
  if (Date.now() - state.lastLoadedAt < REFRESH_INTERVAL_MS) return;
  void refreshCatalog();
}

nodes.search.addEventListener("input", () => {
  if (state.hasLoaded) renderCatalog();
});

nodes.clearSearch.addEventListener("click", () => {
  nodes.search.value = "";
  nodes.search.focus();
  if (state.hasLoaded) renderCatalog();
});

nodes.retry.addEventListener("click", () => {
  void refreshCatalog();
});

document.addEventListener("visibilitychange", refreshIfNeeded);
window.setInterval(refreshIfNeeded, REFRESH_INTERVAL_MS);

void refreshCatalog();
