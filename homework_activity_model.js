(function (root) {
  "use strict";

  const ACTIVITY_TYPES = Object.freeze(["reading", "writing", "grammar"]);
  const TYPE_LABELS = Object.freeze({
    reading: "Reading",
    writing: "Writing",
    grammar: "Grammar"
  });
  const DEFAULT_PREVIEW_COUNT = 9;
  const MAX_PREVIEW_COUNT = 60;

  function validateActivityNumber(number) {
    if (!Number.isSafeInteger(number) || number < 1) {
      throw new RangeError("O número da atividade deve ser um inteiro positivo.");
    }
  }

  function getActivityType(number) {
    validateActivityNumber(number);
    return ACTIVITY_TYPES[(number - 1) % ACTIVITY_TYPES.length];
  }

  function createBlueprint(number) {
    const type = getActivityType(number);
    return Object.freeze({
      number: number,
      type: type,
      title: "ATIVIDADE " + number + " — " + TYPE_LABELS[type],
      route: "/atividade_" + number + "/",
      status: "draft",
      published: false
    });
  }

  function listDrafts(count) {
    const requestedCount = count === undefined ? DEFAULT_PREVIEW_COUNT : count;
    if (!Number.isSafeInteger(requestedCount) || requestedCount < 0 || requestedCount > MAX_PREVIEW_COUNT) {
      throw new RangeError("Quantidade inválida de atividades para pré-visualização.");
    }

    return Object.freeze(Array.from({ length: requestedCount }, function (_, index) {
      return createBlueprint(index + 1);
    }));
  }

  root.HomeworkActivityModel = Object.freeze({
    getActivityType: getActivityType,
    createBlueprint: createBlueprint,
    listDrafts: listDrafts
  });
})(window);
