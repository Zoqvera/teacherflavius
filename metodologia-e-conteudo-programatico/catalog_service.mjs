export const CATALOG_URL =
  "https://wnigzpvgsbpjdxvjzugt.supabase.co/functions/v1/public-study-catalog";

const STAGE_DEFINITIONS = Object.freeze([
  Object.freeze({ key: "fundamentos", min: 1, max: 12, title: "Fundamentos da comunicação" }),
  Object.freeze({ key: "ampliacao", min: 13, max: 27, title: "Ampliação da comunicação" }),
  Object.freeze({ key: "interacao", min: 28, max: Infinity, title: "Interação e autonomia" })
]);

function normalizedText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function searchText(value) {
  return normalizedText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function validateCatalog(payload) {
  if (!payload || !Array.isArray(payload.lessons) || !Number.isSafeInteger(payload.total)) {
    throw new Error("Formato do catálogo inválido.");
  }

  const numbers = new Set();
  const lessons = [];

  for (const row of payload.lessons) {
    const number = row?.number;
    const title = normalizedText(row?.title);
    const objective = normalizedText(row?.objective);

    if (!Number.isSafeInteger(number) || number < 1 || !title || numbers.has(number)) {
      throw new Error("O catálogo retornou uma lição inválida.");
    }

    numbers.add(number);
    lessons.push({ number, title, objective });
  }

  if (payload.total !== lessons.length) {
    throw new Error("A contagem de lições está inconsistente.");
  }

  return lessons.sort((first, second) => first.number - second.number);
}

export async function loadPublicCatalog(fetcher, options = {}) {
  if (typeof fetcher !== "function") {
    throw new TypeError("A consulta ao catálogo precisa de uma função de rede.");
  }

  const response = await fetcher(CATALOG_URL, {
    method: "GET",
    mode: "cors",
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal: options.signal
  });

  if (!response.ok) {
    throw new Error("Não foi possível consultar o catálogo.");
  }

  return validateCatalog(await response.json());
}

export function filterLessons(lessons, query) {
  const terms = searchText(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return lessons;

  return lessons.filter((lesson) => {
    const haystack = searchText(lesson.number + " " + lesson.title + " " + lesson.objective);
    return terms.every((term) => haystack.includes(term));
  });
}

export function groupLessons(lessons) {
  return STAGE_DEFINITIONS.map((stage) => {
    const entries = lessons.filter(({ number }) => number >= stage.min && number <= stage.max);
    const end = stage.max === Infinity
      ? Math.max(stage.min, ...entries.map((lesson) => lesson.number))
      : stage.max;

    return {
      key: stage.key,
      title: stage.title,
      range: "Lições " + stage.min + " a " + end,
      lessons: entries
    };
  }).filter((stage) => stage.lessons.length > 0);
}
