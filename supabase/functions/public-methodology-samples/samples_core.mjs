// Curadoria explícita: alterar esta lista exige revisão de código.
// Nunca expor automaticamente novos conteúdos integrais cadastrados no Roteiro.
export const CURATED_LESSON_NUMBERS = Object.freeze([1, 15, 30]);
export const CURATED_QUESTION_NUMBERS = Object.freeze([1, 4, 10, 17, 25, 38, 50, 62, 76, 90, 112, 145]);
const ANSWER_INDICES = Object.freeze([0, 2]);

const ALLOWED_ORIGINS = new Set([
  "https://teacherflavius.com",
  "https://www.teacherflavius.com"
]);

function allowedOrigin(candidate) {
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (ALLOWED_ORIGINS.has(url.origin)) return url.origin;
    if (["localhost", "127.0.0.1"].includes(url.hostname) && url.protocol === "http:") {
      return url.origin;
    }
  } catch {
    // Invalid origins are rejected without disclosing server details.
  }
  return null;
}

function headers(origin) {
  const values = {
    "Cache-Control": "no-store, max-age=0",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff"
  };
  if (origin) {
    values["Access-Control-Allow-Origin"] = origin;
    values["Access-Control-Allow-Methods"] = "GET, HEAD, OPTIONS";
  }
  return values;
}

function textValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getCuratedLessons(rows) {
  const indexed = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const number = row?.roadmap_lesson_number;
    if (!CURATED_LESSON_NUMBERS.includes(number) || indexed.has(number)) continue;
    const title = textValue(row.title);
    const example = textValue(row.example);
    if (!title || !example) continue;
    indexed.set(number, {
      number,
      title,
      objective: textValue(row.objective),
      example,
      translation: textValue(row.translation),
      practical_exercise: textValue(row.practical_exercise),
      useful_vocabulary: textValue(row.useful_vocabulary)
    });
  }
  return CURATED_LESSON_NUMBERS.filter(number => indexed.has(number)).map(number => indexed.get(number));
}

function getCuratedQuestions(rows) {
  const indexed = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const number = row?.display_order;
    if (!CURATED_QUESTION_NUMBERS.includes(number) || indexed.has(number)) continue;
    const question = textValue(row.question_text);
    if (!question || !Array.isArray(row.answer_examples)) continue;
    const examples = ANSWER_INDICES.map(index => row.answer_examples[index])
      .filter(example => example && typeof example === "object")
      .map(example => ({
        answer: textValue(example.answer),
        translation: textValue(example.translation),
        note: textValue(example.note)
      }))
      .filter(example => example.answer);

    if (examples.length === 0) continue;
    indexed.set(number, {
      number,
      question,
      translation: textValue(row.question_translation),
      examples
    });
  }
  return CURATED_QUESTION_NUMBERS.filter(number => indexed.has(number)).map(number => indexed.get(number));
}

export function createPublicSamples(lessonRows, questionRows) {
  return {
    lessons: getCuratedLessons(lessonRows),
    questions: getCuratedQuestions(questionRows)
  };
}

export async function servePublicSamples(request, loadSamples) {
  const originalOrigin = request.headers.get("origin");
  const origin = allowedOrigin(originalOrigin);
  const responseHeaders = headers(origin);

  if (originalOrigin && !origin) {
    return new Response(null, { status: 403, headers: responseHeaders });
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: responseHeaders });
  }

  if (!["GET", "HEAD"].includes(request.method)) {
    return new Response(null, {
      status: 405,
      headers: { ...responseHeaders, Allow: "GET, HEAD, OPTIONS" }
    });
  }

  try {
    const { lessons, questions } = await loadSamples();
    const samples = createPublicSamples(lessons, questions);
    return new Response(request.method === "HEAD" ? null : JSON.stringify(samples), {
      status: 200,
      headers: { ...responseHeaders, "Content-Type": "application/json; charset=utf-8" }
    });
  } catch {
    return new Response(request.method === "HEAD" ? null : JSON.stringify({
      error: "Não foi possível consultar as demonstrações."
    }), {
      status: 503,
      headers: { ...responseHeaders, "Content-Type": "application/json; charset=utf-8" }
    });
  }
}
