import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CATALOG_URL,
  validateCatalog,
  loadPublicCatalog,
  filterLessons,
  groupLessons
} from "../metodologia-e-conteudo-programatico/catalog_service.mjs";

const lesson = (number, title, objective = "") => ({ number, title, objective });

test("valida, ordena e restringe os dados aos campos públicos", () => {
  const result = validateCatalog({
    total: 2,
    lessons: [
      { ...lesson(41, "  Futuro  ", "  Novas  situações "), translation: "privado" },
      { ...lesson(1, "Apresentação pessoal", "Falar sobre você"), example: "privado" }
    ]
  });

  assert.deepEqual(result, [
    lesson(1, "Apresentação pessoal", "Falar sobre você"),
    lesson(41, "Futuro", "Novas situações")
  ]);
  assert.equal(JSON.stringify(result).includes("privado"), false);
});

test("recusa respostas inconsistentes ou malformadas", () => {
  assert.throws(() => validateCatalog(null), /inválido/);
  assert.throws(() => validateCatalog({ total: 2, lessons: [lesson(1, "A")] }), /inconsistente/);
  assert.throws(() => validateCatalog({ total: 2, lessons: [lesson(1, "A"), lesson(1, "B")] }), /inválida/);
  assert.throws(() => validateCatalog({ total: 1, lessons: [lesson(0, "A")] }), /inválida/);
});

test("consulta a função publicada sem cache e incorpora nova lição na próxima requisição", async () => {
  const rows = [lesson(1, "Introdução")];
  const observed = [];

  const fetcher = async (url, options) => {
    observed.push({ url, options });
    return { ok: true, json: async () => ({ total: rows.length, lessons: [...rows] }) };
  };

  assert.equal((await loadPublicCatalog(fetcher)).length, 1);
  rows.push(lesson(41, "Novo conteúdo"));
  assert.equal((await loadPublicCatalog(fetcher)).length, 2);
  assert.equal(observed[0].url, CATALOG_URL);
  assert.equal(observed[0].options.cache, "no-store");
  assert.equal(observed[1].options.method, "GET");
});

test("pesquisa por número, título ou objetivo, ignorando acentos e caixa", () => {
  const lessons = [
    lesson(1, "Informações pessoais", "Falar de si"),
    lesson(2, "Rotina", "Descrever horários")
  ];
  assert.deepEqual(filterLessons(lessons, "INFORMAÇÕES"), [lessons[0]]);
  assert.deepEqual(filterLessons(lessons, "horarios"), [lessons[1]]);
  assert.deepEqual(filterLessons(lessons, "2 Rotina"), [lessons[1]]);
  assert.deepEqual(filterLessons(lessons, ""), lessons);
  assert.deepEqual(filterLessons(lessons, "sem correspondência"), []);
});

test("as etapas acomodam automaticamente lições acima do número 40", () => {
  const stages = groupLessons([
    lesson(1, "A"),
    lesson(12, "B"),
    lesson(13, "C"),
    lesson(27, "D"),
    lesson(28, "E"),
    lesson(41, "F")
  ]);

  assert.deepEqual(stages.map((stage) => stage.lessons.length), [2, 2, 2]);
  assert.equal(stages[2].range, "Lições 28 a 41");
  assert.equal(stages[2].lessons[1].title, "F");
});
