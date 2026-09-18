(function () {
  "use strict";

  const TABLE_NAME = "study_lesson_pages";
  const EXISTING_ROADMAP_CARD_COUNT = 24;
  const NEW_ROADMAP_CARD_SENTINEL = 0;
  const PAGE_FIELDS = "id,lesson_number_label,title,objective,example,translation,practical_exercise,useful_vocabulary,roadmap_lesson_number,created_at,updated_at";
  const MAX_LENGTHS = Object.freeze({
    lesson_number_label: 50,
    title: 200,
    objective: 500,
    example: 1000,
    translation: 1000,
    practical_exercise: 500,
    useful_vocabulary: 1000
  });

  function assertDependencies(dependencies) {
    if (!dependencies || typeof dependencies.getClient !== "function") {
      throw new Error("Dependência inválida do serviço de lições: getClient.");
    }
  }

  function normalizeText(value, fieldName) {
    const text = String(value || "").trim();
    const maxLength = MAX_LENGTHS[fieldName];

    if (!text) {
      throw new Error("Preencha todos os campos da lição.");
    }
    if (text.length > maxLength) {
      throw new Error("O campo excede o limite de " + maxLength + " caracteres.");
    }
    return text;
  }

  function normalizeLessonNumber(value) {
    if (value === null || value === undefined || value === "") return null;

    const lessonNumber = Number(value);
    if (!Number.isInteger(lessonNumber) || lessonNumber < NEW_ROADMAP_CARD_SENTINEL) {
      throw new Error("Selecione um card válido do roteiro de estudos.");
    }
    return lessonNumber;
  }

  function normalizePayload(payload) {
    const source = payload || {};
    return {
      lesson_number_label: normalizeText(source.lesson_number_label, "lesson_number_label"),
      title: normalizeText(source.title, "title"),
      objective: normalizeText(source.objective, "objective"),
      example: normalizeText(source.example, "example"),
      translation: normalizeText(source.translation, "translation"),
      practical_exercise: normalizeText(source.practical_exercise, "practical_exercise"),
      useful_vocabulary: normalizeText(source.useful_vocabulary, "useful_vocabulary"),
      roadmap_lesson_number: normalizeLessonNumber(source.roadmap_lesson_number)
    };
  }

  function isValidPageId(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
  }

  function lessonPageUrl(pageId) {
    if (!isValidPageId(pageId)) throw new Error("Identificador de página de lição inválido.");
    return "/licao/?id=" + encodeURIComponent(pageId);
  }

  function friendlyDatabaseError(error, payload) {
    if (error && error.code === "23505" && payload && payload.roadmap_lesson_number) {
      return new Error("A Lição " + payload.roadmap_lesson_number + " já está vinculada a outra página.");
    }
    return error;
  }

  function create(dependencies) {
    const deps = dependencies || {};
    assertDependencies(deps);

    function requireClient() {
      const client = deps.getClient();
      if (!client) throw new Error("O cliente Supabase não está disponível.");
      return client;
    }

    async function listAllPages() {
      const response = await requireClient()
        .from(TABLE_NAME)
        .select(PAGE_FIELDS)
        .order("created_at", { ascending: false });

      if (response.error) throw response.error;
      return Array.isArray(response.data) ? response.data : [];
    }

    async function listLinkedPages() {
      const response = await requireClient()
        .from(TABLE_NAME)
        .select("id,title,objective,roadmap_lesson_number")
        .not("roadmap_lesson_number", "is", null)
        .order("roadmap_lesson_number", { ascending: true });

      if (response.error) throw response.error;
      return Array.isArray(response.data) ? response.data : [];
    }

    async function getPage(pageId) {
      if (!isValidPageId(pageId)) return null;

      const response = await requireClient()
        .from(TABLE_NAME)
        .select(PAGE_FIELDS)
        .eq("id", pageId)
        .maybeSingle();

      if (response.error) throw response.error;
      return response.data || null;
    }

    async function createPage(payload) {
      const normalized = normalizePayload(payload);
      const response = await requireClient()
        .from(TABLE_NAME)
        .insert(normalized)
        .select(PAGE_FIELDS)
        .single();

      if (response.error) throw friendlyDatabaseError(response.error, normalized);
      return response.data;
    }

    async function updatePage(pageId, payload) {
      if (!isValidPageId(pageId)) throw new Error("Identificador de página de lição inválido.");

      const normalized = normalizePayload(payload);
      const response = await requireClient()
        .from(TABLE_NAME)
        .update(normalized)
        .eq("id", pageId)
        .select(PAGE_FIELDS)
        .single();

      if (response.error) throw friendlyDatabaseError(response.error, normalized);
      return response.data;
    }

    async function deletePage(pageId) {
      if (!isValidPageId(pageId)) throw new Error("Identificador de página de lição inválido.");

      const response = await requireClient()
        .from(TABLE_NAME)
        .delete()
        .eq("id", pageId);

      if (response.error) throw response.error;
    }

    return Object.freeze({
      listAllPages: listAllPages,
      listLinkedPages: listLinkedPages,
      getPage: getPage,
      createPage: createPage,
      updatePage: updatePage,
      deletePage: deletePage
    });
  }

  window.StudyLessonService = Object.freeze({
    create: create,
    MAX_LENGTHS: MAX_LENGTHS,
    EXISTING_ROADMAP_CARD_COUNT: EXISTING_ROADMAP_CARD_COUNT,
    NEW_ROADMAP_CARD_SENTINEL: NEW_ROADMAP_CARD_SENTINEL,
    isValidPageId: isValidPageId,
    lessonPageUrl: lessonPageUrl
  });
})();