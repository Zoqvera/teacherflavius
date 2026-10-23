export const SAMPLES_ENDPOINT =
  "https://wnigzpvgsbpjdxvjzugt.supabase.co/functions/v1/public-methodology-samples";

const ALLOWED_LESSONS = new Set([1, 15, 30]);
const ALLOWED_QUESTIONS = new Set([1, 4, 10, 17, 25, 38, 50, 62, 76, 90, 112, 145]);

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanLesson(record) {
  if (!record || !ALLOWED_LESSONS.has(record.number)) return null;
  const title = cleanText(record.title);
  const example = cleanText(record.example);
  if (!title || !example) return null;

  return {
    number: record.number,
    title,
    objective: cleanText(record.objective),
    example,
    translation: cleanText(record.translation),
    practicalExercise: cleanText(record.practical_exercise),
    usefulVocabulary: cleanText(record.useful_vocabulary)
  };
}

function cleanQuestion(record) {
  if (!record || !ALLOWED_QUESTIONS.has(record.number)) return null;
  const question = cleanText(record.question);
  if (!question || !Array.isArray(record.examples)) return null;

  const examples = record.examples.slice(0, 2)
    .map(example => ({
      answer: cleanText(example?.answer),
      translation: cleanText(example?.translation),
      note: cleanText(example?.note)
    }))
    .filter(example => example.answer);

  return examples.length
    ? { number: record.number, question, translation: cleanText(record.translation), examples }
    : null;
}

export function validatePublicSamples(payload) {
  if (!payload || !Array.isArray(payload.lessons) || !Array.isArray(payload.questions)) {
    throw new Error("A demonstração retornou um formato inválido.");
  }

  const lessons = payload.lessons.map(cleanLesson).filter(Boolean);
  const questions = payload.questions.map(cleanQuestion).filter(Boolean);
  const lessonNumbers = new Set(lessons.map(item => item.number));
  const questionNumbers = new Set(questions.map(item => item.number));

  if (lessons.length !== lessonNumbers.size || questions.length !== questionNumbers.size) {
    throw new Error("Há itens repetidos na demonstração.");
  }

  if (lessons.length === 0 || questions.length === 0) {
    throw new Error("Nenhuma demonstração autorizada está disponível.");
  }

  return { lessons, questions };
}

export async function loadPublicSamples(fetcher, options = {}) {
  if (typeof fetcher !== "function") throw new TypeError("A consulta precisa de uma função de rede.");

  const response = await fetcher(SAMPLES_ENDPOINT, {
    method: "GET",
    mode: "cors",
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal: options.signal
  });

  if (!response.ok) throw new Error("Não foi possível carregar as demonstrações.");
  return validatePublicSamples(await response.json());
}
