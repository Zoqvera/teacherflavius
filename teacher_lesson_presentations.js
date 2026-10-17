(function () {
  "use strict";

  // Etapa 3/5. Ativar somente após homologação da migração em produção.
  // Esta constante não é configurável pela URL ou pelo navegador.
  const RELEASE_ENABLED = false;
  const PRESENTATIONS_TABLE = "lesson_presentations";
  const RECEIPTS_TABLE = "lesson_presentation_views";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const MAX_ROSTER_ITEMS = 300;

  function rosterKey(studentId, lessonNumber) {
    const number = Number(lessonNumber);
    if (!UUID.test(String(studentId || "")) || !Number.isSafeInteger(number) ||
        number < 1) return null;
    return String(studentId).toLowerCase() + "|lesson:" + number;
  }

  function receiptKey(presentationId, revisionNumber) {
    return presentationId + "|" + revisionNumber;
  }

  function dateTime(value) {
    if (!value || Number.isNaN(Date.parse(value))) return "";
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      dateStyle: "short",
      timeStyle: "short"
    }).format(new Date(value));
  }

  function node(tag, className, content) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (content !== undefined && content !== null) el.textContent = content;
    return el;
  }

  function create(dependencies) {
    const deps = dependencies || {};
    if (typeof deps.getClient !== "function" ||
        typeof deps.getTeacherId !== "function") {
      throw new Error("Dependências da visualização de apresentações inválidas.");
    }

    const seen = new Set();
    const pending = new Set();

    function table(name) {
      const client = deps.getClient();
      if (!client) throw new Error("Sessão do professor indisponível.");
      return client.from(name);
    }

    async function load(items) {
      if (!Array.isArray(items) || items.length > MAX_ROSTER_ITEMS) {
        throw new Error("Roteiro excede o limite de consulta de apresentações.");
      }

      const keys = new Set();
      const studentIds = new Set();
      const lessonKeys = new Set();

      items.forEach(function (item) {
        const key = rosterKey(item.student_id, item.lesson_number);
        if (!key) return;
        keys.add(key);
        studentIds.add(String(item.student_id).toLowerCase());
        lessonKeys.add("lesson:" + Number(item.lesson_number));
      });

      const byRosterKey = new Map();
      if (!keys.size) return byRosterKey;

      const presentations = await table(PRESENTATIONS_TABLE)
        .select("id,student_id,lesson_key,body,revision_number,updated_at")
        .in("student_id", Array.from(studentIds))
        .in("lesson_key", Array.from(lessonKeys));

      if (presentations.error) throw presentations.error;
      const rows = Array.isArray(presentations.data) ? presentations.data : [];
      rows.forEach(function (row) {
        const key = String(row.student_id).toLowerCase() + "|" + row.lesson_key;
        if (keys.has(key)) byRosterKey.set(key, Object.assign({}, row, { viewedAt: null }));
      });

      const ids = Array.from(new Set(Array.from(byRosterKey.values()).map(function (row) {
        return row.id;
      })));
      if (!ids.length) return byRosterKey;

      const receipts = await table(RECEIPTS_TABLE)
        .select("presentation_id,revision_number,viewed_at")
        .in("presentation_id", ids);

      if (receipts.error) throw receipts.error;
      const viewed = new Map();
      (Array.isArray(receipts.data) ? receipts.data : []).forEach(function (receipt) {
        const key = receiptKey(receipt.presentation_id, receipt.revision_number);
        if (!viewed.has(key) || Date.parse(viewed.get(key)) > Date.parse(receipt.viewed_at)) {
          viewed.set(key, receipt.viewed_at);
        }
      });

      byRosterKey.forEach(function (row) {
        row.viewedAt = viewed.get(receiptKey(row.id, row.revision_number)) || null;
      });
      return byRosterKey;
    }

    async function markViewed(presentation) {
      if (!presentation || !UUID.test(String(presentation.id || "")) ||
          !Number.isSafeInteger(presentation.revision_number) ||
          presentation.revision_number < 1) {
        throw new Error("Apresentação inválida para registrar visualização.");
      }
      const teacherId = deps.getTeacherId();
      if (!UUID.test(String(teacherId || ""))) {
        throw new Error("Professor não autenticado.");
      }
      const key = receiptKey(presentation.id, presentation.revision_number);
      if (presentation.viewedAt || seen.has(key)) return presentation.viewedAt || true;
      if (pending.has(key)) return false;

      pending.add(key);
      try {
        const result = await table(RECEIPTS_TABLE).insert({
          presentation_id: presentation.id,
          revision_number: presentation.revision_number,
          teacher_id: teacherId
        });
        if (result.error && result.error.code !== "23505") throw result.error;
        seen.add(key);
        presentation.viewedAt = new Date().toISOString();
        return presentation.viewedAt;
      } finally {
        pending.delete(key);
      }
    }

    function render(item, records) {
      const section = node("section", "academic-presentation-section");
      const heading = node("h4", "academic-presentation-heading", "APRESENTAÇÃO DO ALUNO");
      section.appendChild(heading);
      const key = rosterKey(item.student_id, item.lesson_number);
      const presentation = key && records.get(key);

      if (!presentation) {
        section.appendChild(node("p", "academic-muted", "APRESENTAÇÃO NÃO ENVIADA"));
        return section;
      }

      const badge = node("p", "academic-presentation-status");
      const received = node("span", "academic-presentation-received", "RECEBIDA");
      const viewStatus = node("span", "academic-presentation-view-state",
        presentation.viewedAt ? "VISUALIZADA" : "NÃO VISUALIZADA");
      badge.appendChild(received);
      badge.appendChild(viewStatus);
      section.appendChild(badge);

      const dateLabel = dateTime(presentation.updated_at);
      section.appendChild(node(
        "p", "academic-presentation-meta",
        "Versão " + presentation.revision_number +
        (dateLabel ? " · Enviada em " + dateLabel : "")
      ));

      const details = node("details", "academic-presentation-details");
      details.appendChild(node("summary", "academic-presentation-summary", "LER APRESENTAÇÃO"));
      details.appendChild(node("p", "academic-presentation-body", presentation.body));
      const message = node("p", "academic-presentation-feedback");
      message.setAttribute("role", "status");
      details.appendChild(message);

      details.addEventListener("toggle", async function () {
        if (!details.open || presentation.viewedAt) return;
        try {
          await markViewed(presentation);
          viewStatus.textContent = "VISUALIZADA";
          message.textContent = "Visualização registrada.";
        } catch (error) {
          console.error("Não foi possível registrar visualização:", error);
          message.textContent = "Não foi possível registrar a visualização. Abra novamente para tentar.";
        }
      });
      section.appendChild(details);
      return section;
    }

    return Object.freeze({ load: load, markViewed: markViewed, render: render });
  }

  async function loadPlan(items, getClient, teacherId) {
    // Production cannot query either table before controlled activation.
    if (!RELEASE_ENABLED) return null;
    const service = create({
      getClient: getClient,
      getTeacherId: function () { return teacherId; }
    });
    return Object.freeze({ service: service, records: await service.load(items) });
  }

  window.TeacherLessonPresentations = Object.freeze({
    enabled: RELEASE_ENABLED,
    create: create,
    rosterKey: rosterKey,
    loadPlan: loadPlan
  });
})();
