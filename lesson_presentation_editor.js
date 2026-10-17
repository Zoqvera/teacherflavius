(function () {
  "use strict";

  // Stage 2 of 5: source-controlled release gate. Never enable via URL,
  // localStorage, browser globals, or a missing database table.
  // Stage 5 must verify the production migration before setting this to true.
  const RELEASE_ENABLED = false;
  const TABLE = "lesson_presentations";
  const FIELDS = "id,body,revision_number,updated_at";
  const MAX_CHARACTERS = 15000;
  const PAGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function lessonIdentity(lessonNumber, pageId) {
    if (lessonNumber !== null && lessonNumber !== undefined && lessonNumber !== "") {
      const number = Number(lessonNumber);
      if (!Number.isSafeInteger(number) || number < 1) {
        throw new Error("Identificador de lição inválido.");
      }
      return Object.freeze({
        key: "lesson:" + number,
        columns: { lesson_number: number }
      });
    }

    if (!PAGE_ID_PATTERN.test(String(pageId || ""))) {
      throw new Error("Identificador da página de lição inválido.");
    }

    const id = String(pageId).toLowerCase();
    return Object.freeze({
      key: "page:" + id,
      columns: { lesson_page_id: id }
    });
  }

  function normalizedBody(value) {
    const body = String(value || "").trim();
    if (!body) throw new Error("Escreva sua apresentação antes de enviar.");
    if (Array.from(body).length > MAX_CHARACTERS) {
      throw new Error("Sua apresentação pode conter até 15.000 caracteres.");
    }
    return body;
  }

  function formatSavedAt(value) {
    if (!value || Number.isNaN(Date.parse(value))) return "";
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "America/Sao_Paulo"
    }).format(new Date(value));
  }

  function create(dependencies) {
    const deps = dependencies || {};
    const elements = deps.elements;
    if (typeof deps.getClient !== "function" || !elements ||
        !elements.section || !elements.form || !elements.input ||
        !elements.button || !elements.status || !elements.counter) {
      throw new Error("O editor de apresentações não foi inicializado.");
    }

    let studentId = null;
    let identity = null;
    let saved = null;
    let busy = false;

    function status(message, tone) {
      elements.status.textContent = message;
      if (tone) elements.status.dataset.tone = tone;
      else delete elements.status.dataset.tone;
    }

    function render() {
      const body = String(elements.input.value || "").trim();
      const length = Array.from(body).length;
      elements.counter.textContent = length + " / " + MAX_CHARACTERS;
      elements.button.textContent = saved ? "EDITAR APRESENTAÇÃO" : "ENVIAR APRESENTAÇÃO";
      elements.button.disabled = busy || !body || length > MAX_CHARACTERS ||
        (saved !== null && body === saved.body);
      elements.input.disabled = busy;
    }

    function query() {
      const client = deps.getClient();
      if (!client) throw new Error("Sua sessão não está disponível. Entre novamente.");
      return client.from(TABLE);
    }

    async function load(context) {
      const userId = String(context && context.studentId || "");
      if (!PAGE_ID_PATTERN.test(userId)) {
        throw new Error("A identidade do aluno não está disponível.");
      }

      identity = lessonIdentity(context.lessonNumber, context.pageId);
      studentId = userId;
      elements.section.hidden = true;
      busy = true;
      render();

      try {
        const response = await query()
          .select(FIELDS)
          .eq("student_id", studentId)
          .eq("lesson_key", identity.key)
          .maybeSingle();

        if (response.error) throw response.error;
        saved = response.data || null;
        elements.input.value = saved ? saved.body : "";
        elements.section.hidden = false;
        const lastUpdate = saved && formatSavedAt(saved.updated_at);
        status(saved
          ? ("Apresentação já enviada." + (lastUpdate ? " Última edição: " + lastUpdate + "." : ""))
          : "Escreva sua apresentação para enviar ao professor.");
        return true;
      } finally {
        busy = false;
        render();
      }
    }

    async function save() {
      if (busy || !studentId || !identity) return false;
      let body;
      try {
        body = normalizedBody(elements.input.value);
      } catch (error) {
        status(error.message, "error");
        return false;
      }
      if (saved && saved.body === body) return false;

      busy = true;
      render();
      status("Salvando apresentação...");
      try {
        let response;
        if (saved) {
          response = await query()
            .update({ body: body })
            .eq("id", saved.id)
            .eq("student_id", studentId)
            .eq("revision_number", saved.revision_number)
            .select(FIELDS)
            .maybeSingle();
        } else {
          response = await query()
            .insert(Object.assign({
              student_id: studentId,
              body: body
            }, identity.columns))
            .select(FIELDS)
            .single();
        }

        if (response.error) throw response.error;
        if (!response.data) {
          throw new Error("A apresentação mudou em outra sessão. Recarregue a lição antes de editar.");
        }

        saved = response.data;
        elements.input.value = saved.body;
        status("Apresentação enviada ao professor.", "success");
        return true;
      } catch (error) {
        // Preserve the draft when a network, policy or concurrency check fails.
        status(error && error.message
          ? error.message : "Não foi possível salvar sua apresentação. Tente novamente.", "error");
        return false;
      } finally {
        busy = false;
        render();
      }
    }

    function bind() {
      elements.input.addEventListener("input", function () {
        status("");
        render();
      });
      elements.form.addEventListener("submit", function (event) {
        event.preventDefault();
        void save();
      });
      render();
    }

    bind();
    return Object.freeze({ load: load, save: save });
  }

  async function mount(context) {
    if (!RELEASE_ENABLED) return false;
    if (!context || typeof context.getClient !== "function") return false;

    const elements = {
      section: document.getElementById("lessonPresentationSection"),
      form: document.getElementById("lessonPresentationForm"),
      input: document.getElementById("lessonPresentationBody"),
      button: document.getElementById("lessonPresentationSubmit"),
      status: document.getElementById("lessonPresentationStatus"),
      counter: document.getElementById("lessonPresentationCount")
    };

    try {
      return await create({ getClient: context.getClient, elements: elements }).load(context);
    } catch (error) {
      console.error("Falha ao abrir editor de apresentação da lição:", error);
      return false;
    }
  }

  window.LessonPresentationEditor = Object.freeze({
    enabled: RELEASE_ENABLED,
    create: create,
    lessonIdentity: lessonIdentity,
    normalizedBody: normalizedBody,
    mount: mount
  });
})();
