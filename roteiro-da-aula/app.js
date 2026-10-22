(function () {
  "use strict";

  const WAIT_OPTIONS = Object.freeze({ maxAttempts: 30, delayMs: 120 });
  const PLAN_REFRESH_INTERVAL_MS = 30000;
  const RATING_LABELS = Object.freeze({
    good: "BOM",
    medium: "MÉDIO",
    improve: "MELHORAR"
  });

  let service = null;
  let currentItems = [];
  let currentTeacherId = null;
  let presentationBundle = null;

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

  function isCancelled(item) {
    return item.attendance_status === "cancelled" ||
      item.attendance_status === "cancelled_finalized";
  }

  function attendanceLabel(status) {
    if (status === "cancelled_finalized") return "CANCELADA — AULA FINALIZADA";
    if (status === "cancelled") return "AULA CANCELADA";
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
        const result = await handler();
        if (result === false) button.disabled = false;
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

  function changePlannedLesson(item, classDate) {
    const response = window.prompt(
      "Qual apresentação " + item.student_name + " apresentará nesta aula? (1 a 74)",
      String(item.lesson_number || 1)
    );
    if (response === null) return Promise.resolve(false);

    const number = Number(response.trim());
    if (!Number.isInteger(number) || number < 1 || number > 74) {
      setStatus("Informe um número de apresentação de 1 a 74.", "error");
      return Promise.resolve(false);
    }
    return reloadAfter(
      function () { return service.setPlannedLesson(item, classDate, number); },
      "Apresentação " + number + " programada para " + item.student_name +
        ". O histórico de apresentações não foi alterado."
    );
  }

  function restoreAutomaticLesson(item, classDate) {
    const confirmed = window.confirm(
      "Restaurar a sequência automática para " + item.student_name +
      "? Nenhuma apresentação apresentada será alterada."
    );
    if (!confirmed) return Promise.resolve(false);
    return reloadAfter(
      function () { return service.setPlannedLesson(item, classDate, null); },
      "Sequência automática restaurada para " + item.student_name + "."
    );
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
    const lessonNumber = item.lesson_number ? "APRESENTAÇÃO " + item.lesson_number : "APRESENTAÇÕES CONCLUÍDAS";
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
    if (isCancelled(item)) {
      actions.appendChild(actionButton(
        "DESCANCELAR AULA",
        "primary",
        async function () {
          const confirmed = window.confirm(
            "Descancelar a aula de " + item.student_name +
            "? Caso exista um crédito de reposição disponível para esta aula, ele será devolvido à aula regular."
          );
          if (!confirmed) return false;
          await reloadAfter(
            function () {
              return service.restoreCancelledRegularLesson(item, classDate);
            },
            "Cancelamento revertido. O crédito correspondente foi reconciliado."
          );
          return true;
        },
        item.attendance_status === "cancelled_finalized"
      ));
    }

    actions.appendChild(actionButton(
      "ALTERAR APRESENTAÇÃO",
      "",
      function () { return changePlannedLesson(item, classDate); },
      item.lesson_status === "presented" ||
        item.attendance_status === "absent" || isCancelled(item)
    ));
    actions.appendChild(actionButton(
      "USAR SEQUÊNCIA AUTOMÁTICA",
      "",
      function () { return restoreAutomaticLesson(item, classDate); },
      item.lesson_status === "presented" ||
        item.attendance_status === "absent" || isCancelled(item)
    ));

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
      item.attendance_status === "present" || isCancelled(item)
    ));

    actions.appendChild(actionButton(
      "APRESENTOU",
      "primary",
      function () {
        return reloadAfter(
          function () {
            return service.markLessonPresented(item, classDate);
          },
          "Apresentação apresentada e progresso atualizado."
        );
      },
      !item.lesson_number ||
        item.lesson_status === "presented" ||
        item.attendance_status === "absent" ||
        isCancelled(item)
    ));

    actions.appendChild(actionButton(
      "ALUNO AUSENTE",
      "danger",
      function () {
        return reloadAfter(
          function () {
            return service.setAttendance(item, classDate, "absent");
          },
          "Ausência registrada. A apresentação e as perguntas permanecem pendentes."
        );
      },
      item.attendance_status === "absent" || isCancelled(item)
    ));

    card.appendChild(header);
    card.appendChild(pills);
    if (item.attendance_status === "cancelled_finalized") {
      card.appendChild(element(
        "p", "academic-muted",
        "Aula já finalizada. O cancelamento pode ser consultado, mas não revertido aqui."
      ));
    }
    card.appendChild(actions);
    if (presentationBundle && presentationBundle.records && presentationBundle.service) {
      card.appendChild(presentationBundle.service.render(item, presentationBundle.records));
    }
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

      return reloadAfter(
        function () {
          return service.finalizeTeacherLessonSession(
            first.class_number,
            first.starts_at,
            classDate
          );
        },
        "Aula finalizada. A turma foi removida do roteiro desta ocorrência."
      );
    }, false);

    heading.appendChild(title);
    if (!items.every(function (item) {
      return item.attendance_status === "cancelled_finalized";
    })) {
      heading.appendChild(finalize);
    }
    block.appendChild(heading);

    const regularItems = items.filter(function (item) { return !isCancelled(item); });
    const cancelledItems = items.filter(isCancelled);
    regularItems.forEach(function (item) {
      block.appendChild(renderStudent(item, classDate));
    });
    if (cancelledItems.length) {
      block.appendChild(element("h3", "academic-muted", "AULAS CANCELADAS"));
      cancelledItems.forEach(function (item) {
        block.appendChild(renderStudent(item, classDate));
      });
    }
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
      // The teacher module returns before any network call while the release is locked.
      const presentationService = window.TeacherLessonPresentations;
      const bundle = presentationService
        ? await presentationService.loadPlan(
          items, function () { return window.Auth.getClient(); }, currentTeacherId
        ) : null;
      presentationBundle = bundle;
      renderPlan(items, classDate);
      setStatus(
        items.length
          ? items.length + " aluno(s) no roteiro desta data, incluindo " +
            items.filter(isCancelled).length + " cancelamento(s)."
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

    currentTeacherId = session.user.id;
    service = window.AcademicWorkflowService.create(client);
    const dateInput = document.getElementById("teacherPlanDate");
    dateInput.value = saoPauloDate();
    dateInput.addEventListener("change", function () { loadPlan(true); });
    document.getElementById("reloadTeacherPlan")
      .addEventListener("click", function () { loadPlan(true); });

    // Update preparation labels while the teacher keeps the roster open.
    if (typeof window.setInterval === "function") {
      window.setInterval(function () {
        if (document.visibilityState === "visible") loadPlan(false);
      }, PLAN_REFRESH_INTERVAL_MS);
    }

    document.body.classList.remove("auth-checking");
    await loadPlan(true);
  }

  initialize();
})();
