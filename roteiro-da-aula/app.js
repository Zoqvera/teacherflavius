(function () {
  "use strict";

  const WAIT_OPTIONS = Object.freeze({ maxAttempts: 30, delayMs: 120 });
  const RATING_LABELS = Object.freeze({
    good: "BOM",
    medium: "MÉDIO",
    improve: "MELHORAR"
  });

  let service = null;
  let currentItems = [];

  function resourcesReady() {
    return !!(
      window.Auth &&
      window.ResourceWaiter &&
      window.AcademicWorkflowService &&
      window.ConversationQuestionCardRenderer &&
      window.SUPABASE_CONFIG &&
      window.Auth.isConfigured()
    );
  }

  function element(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function setStatus(message, tone) {
    const status = document.getElementById("teacherPlanStatus");
    status.textContent = message;
    if (tone) status.dataset.tone = tone;
    else delete status.dataset.tone;
  }

  function saoPauloDate() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());
    const values = {};
    parts.forEach(function (part) {
      if (part.type !== "literal") values[part.type] = part.value;
    });
    return values.year + "-" + values.month + "-" + values.day;
  }

  function formatTime(value) {
    if (!value) return "";
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));
  }

  function redirectToLogin() {
    window.location.href = "/login/?next=" + encodeURIComponent("/roteiro-da-aula/");
  }

  function lessonStatus(item) {
    if (item.lesson_status === "presented") return "APRESENTADA";
    if (item.lesson_status === "prepared") return "ALUNO PREPARADO";
    return "PREVISTA";
  }

  function attendanceLabel(status) {
    if (status === "present") return "PRESENTE";
    if (status === "absent") return "NÃO COMPARECEU";
    return "AGUARDANDO";
  }

  function pill(text, className) {
    return element("span", "academic-pill " + (className || ""), text);
  }

  function actionButton(label, className, handler, disabled) {
    const button = element("button", "academic-button " + (className || ""), label);
    button.type = "button";
    button.disabled = !!disabled;
    button.addEventListener("click", async function () {
      if (button.disabled) return;
      button.disabled = true;
      try {
        await handler();
      } catch (error) {
        console.error("Falha no Roteiro da Aula:", error);
        setStatus(
          error && error.message ? error.message : "Não foi possível salvar a alteração.",
          "error"
        );
        button.disabled = false;
      }
    });
    return button;
  }

  async function reloadAfter(action, successMessage) {
    await action();
    setStatus(successMessage, "success");
    await loadPlan(false);
  }

  function renderQuestionRow(question, item, classDate) {
    const row = element("div", "academic-question-row");
    const questionCard = window.ConversationQuestionCardRenderer.create(question, {
      number: question.display_order,
      className: "academic-conversation-card academic-teacher-question-card"
    });
    const actions = element("div", "academic-rating-actions");
    const canRate = item.attendance_status === "present";

    Object.keys(RATING_LABELS).forEach(function (rating) {
      actions.appendChild(actionButton(
        RATING_LABELS[rating],
        rating === "good" ? "success" : "",
        function () {
          return reloadAfter(
            function () {
              return service.rateQuestion(item, classDate, question.id, rating);
            },
            "Pergunta registrada como " + RATING_LABELS[rating] + "."
          );
        },
        !canRate
      ));
    });

    row.appendChild(questionCard);
    row.appendChild(actions);
    return row;
  }

  function renderQuestionSection(title, questions, item, classDate) {
    const section = element("section", "academic-question-section");
    section.appendChild(element("h4", "", title));

    if (!questions.length) {
      section.appendChild(element("p", "academic-muted", "Nenhuma pergunta nesta seção."));
      return section;
    }

    questions.forEach(function (question) {
      section.appendChild(renderQuestionRow(question, item, classDate));
    });
    return section;
  }

  function renderStudent(item, classDate) {
    const card = element("article", "academic-student-card");
    const header = element("div");
    const title = element("h3", "", item.student_name);
    const meta = element(
      "div",
      "academic-student-meta",
      item.lesson_kind === "makeup" ? "Reposição" : "Aula regular"
    );
    header.appendChild(title);
    header.appendChild(meta);

    const pills = element("div", "academic-pills");
    const lessonNumber = item.lesson_number ? "L" + item.lesson_number : "LIÇÕES CONCLUÍDAS";
    pills.appendChild(pill(lessonNumber, item.lesson_status === "presented" ? "presented" : ""));
    pills.appendChild(pill(
      lessonStatus(item),
      item.lesson_status === "prepared" ? "prepared" : item.lesson_status
    ));
    pills.appendChild(pill(
      attendanceLabel(item.attendance_status),
      item.attendance_status
    ));

    const actions = element("div", "academic-actions");
    actions.appendChild(actionButton(
      "PRESENTE",
      "success",
      function () {
        return reloadAfter(
          function () {
            return service.setAttendance(item, classDate, "present");
          },
          "Presença registrada."
        );
      },
      item.attendance_status === "present"
    ));

    actions.appendChild(actionButton(
      "APRESENTOU",
      "primary",
      function () {
        return reloadAfter(
          function () {
            return service.markLessonPresented(item, classDate);
          },
          "Lição apresentada e progresso atualizado."
        );
      },
      !item.lesson_number ||
        item.lesson_status === "presented" ||
        item.attendance_status === "absent"
    ));

    actions.appendChild(actionButton(
      "ALUNO AUSENTE",
      "danger",
      function () {
        return reloadAfter(
          function () {
            return service.setAttendance(item, classDate, "absent");
          },
          "Ausência registrada. A lição e as perguntas permanecem pendentes."
        );
      },
      item.attendance_status === "absent"
    ));

    card.appendChild(header);
    card.appendChild(pills);
    card.appendChild(actions);
    card.appendChild(renderQuestionSection(
      "PERGUNTAS ESTUDADAS",
      Array.isArray(item.new_questions) ? item.new_questions : [],
      item,
      classDate
    ));
    card.appendChild(renderQuestionSection(
      "REVISÕES PROGRAMADAS",
      Array.isArray(item.review_questions) ? item.review_questions : [],
      item,
      classDate
    ));
    return card;
  }

  function groupItems(items) {
    const groups = new Map();
    items.forEach(function (item) {
      const key = item.class_number + "|" + item.starts_at;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    return Array.from(groups.values());
  }

  function renderClassGroup(items, classDate) {
    const block = element("section", "academic-class-block");
    const first = items[0];
    const heading = element("div", "academic-class-heading");
    const title = element(
      "h2",
      "",
      (first.class_name || "Turma " + first.class_number) + " — " + formatTime(first.starts_at)
    );
    const finalize = actionButton("FINALIZAR AULA", "", function () {
      const unresolved = items.filter(function (item) {
        return item.attendance_status === "scheduled";
      });
      if (unresolved.length) {
        setStatus(
          "Falta definir presença ou ausência de: " +
            unresolved.map(function (item) { return item.student_name; }).join(", ") + ".",
          "error"
        );
        return Promise.resolve();
      }
      setStatus(
        "Roteiro conferido: todos os alunos desta aula têm presença ou ausência definida.",
        "success"
      );
      return Promise.resolve();
    }, false);

    heading.appendChild(title);
    heading.appendChild(finalize);
    block.appendChild(heading);
    items.forEach(function (item) {
      block.appendChild(renderStudent(item, classDate));
    });
    return block;
  }

  function renderPlan(items, classDate) {
    const container = document.getElementById("teacherPlanContainer");
    container.innerHTML = "";
    currentItems = items;

    if (!items.length) {
      container.appendChild(element(
        "div",
        "academic-empty",
        "Nenhum aluno com aula ativa foi encontrado para esta data."
      ));
      return;
    }

    groupItems(items).forEach(function (group) {
      container.appendChild(renderClassGroup(group, classDate));
    });
  }

  async function loadPlan(showLoading) {
    const classDate = document.getElementById("teacherPlanDate").value;
    if (showLoading !== false) setStatus("Carregando roteiro...", "");

    try {
      const items = await service.getTeacherLessonPlan(classDate);
      renderPlan(items, classDate);
      setStatus(
        items.length
          ? items.length + " aluno(s) no roteiro desta data."
          : "Nenhum aluno previsto para esta data.",
        "success"
      );
    } catch (error) {
      console.error("Falha ao carregar roteiro da aula:", error);
      setStatus(
        error && error.message ? error.message : "Não foi possível carregar o roteiro.",
        "error"
      );
    }
  }

  async function initialize() {
    const ready = await window.ResourceWaiter.waitUntil(resourcesReady, WAIT_OPTIONS);
    if (!ready) {
      setStatus("Não foi possível carregar os recursos da página.", "error");
      document.body.classList.remove("auth-checking");
      return;
    }

    const session = await window.Auth.getSession();
    if (!session || !session.user) {
      redirectToLogin();
      return;
    }

    const client = window.Auth.getClient();
    const admin = await client.rpc("is_teacher_admin");
    if (admin.error || admin.data !== true) {
      window.location.href = "/acesso-negado/";
      return;
    }

    service = window.AcademicWorkflowService.create(client);
    const dateInput = document.getElementById("teacherPlanDate");
    dateInput.value = saoPauloDate();
    dateInput.addEventListener("change", function () { loadPlan(true); });
    document.getElementById("reloadTeacherPlan")
      .addEventListener("click", function () { loadPlan(true); });

    document.body.classList.remove("auth-checking");
    await loadPlan(true);
  }

  initialize();
})();
