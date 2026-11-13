/** Shared validation for the presentation translation assistant. */
export const MAX_SOURCE_CHARACTERS = 3000;
export const LEVELS = Object.freeze(["A1", "A2", "B1", "B2"]);
const MAX_ITEMS = 5;
const MAX_EXPLANATION_CHARACTERS = 600;

function requiredText(value, label, limit) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} é obrigatório.`);
  const text = value.trim();
  if (Array.from(text).length > limit) throw new Error(`${label} excede o limite permitido.`);
  return text;
}

export function validateRequest(source, level) {
  const text = requiredText(source, "Texto em português", MAX_SOURCE_CHARACTERS);
  if (!LEVELS.includes(level)) throw new Error("Nível de inglês inválido.");
  return { text, level };
}

function validateItems(value, label, fields) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ITEMS) {
    throw new Error(`${label} deve conter de 1 a ${MAX_ITEMS} itens.`);
  }
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`${label} inválido.`);
    return Object.fromEntries(fields.map(([field, description]) => [
      field, requiredText(item[field], description, MAX_EXPLANATION_CHARACTERS)
    ]));
  });
}

export function validateResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Resposta do assistente inválida.");
  return {
    translation: requiredText(value.translation, "Tradução", 6000),
    expressions: validateItems(value.expressions, "Expressões", [["english", "Expressão em inglês"], ["portuguese", "Significado"]]),
    comparisons: validateItems(value.comparisons, "Comparações", [["portuguese", "Trecho em português"], ["english", "Trecho em inglês"], ["explanation", "Explicação"]]),
    practice: validateItems(value.practice, "Prática", [["prompt", "Enunciado"], ["example", "Resposta possível"]])
  };
}
