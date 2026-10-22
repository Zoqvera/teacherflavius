(function () {
  "use strict";

  const TIME_ZONE = "America/Sao_Paulo";
  const WAIT_OPTIONS = Object.freeze({ maxAttempts: 30, delayMs: 120 });
  const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
  const timeFormatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit"
  });

  function setStatus(message, tone) {
    const element = document.getElementById("studiedQuestionsStatus");
    element.textContent = message;
    if (tone) element.dataset.tone = tone;
    else delete element.dataset.tone;
  }

  function studyTimestamp(question) {
    const milliseconds = Date.parse(question && question.studied_at || "");
    return Number.isFinite(milliseconds) ? milliseconds : null;
  }

  function studyDay(question) {
    const timestamp = studyTimestamp(question);
    return timestamp === null
      ? "Data de estudo não registrada"
      : dateFormatter.format(new Date(timestamp));
  }

  function groupQuestionsByDay(questions) {
    const groups = new Map();
    const ordered = questions.slice().sort(function (first, second) {
      const firstTime = studyTimestamp(first);
      const secondTime = studyTimestamp(second);
      if (firstTime === null && secondTime !== null) return 1;
      if (secondTime === null && firstTime !== null) return -1;
      if (firstTime !== null && secondTime !== null && firstTime !== secondTime) {
        return secondTime - firstTime;
      }
      return Number(first.display_order || 0) - Number(second.display_order || 0);
    });

    ordered.forEach(function (question) {
      const day = studyDay(question);
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day).push(question);
    });
    return groups;
  }

  function renderStudyCard(question) {
    const wrapper = document.createElement("div");
    wrapper.className = "studied-question-entry";
    const number = Number(question.display_order);
    const validNumber = Number.isInteger(number) && number > 0 ? number : null;

    wrapper.appendChild(window.ConversationQuestionCardRenderer.create(question, {
      number: validNumber,
      className: "academic-conversation-card"
    }));

    const timestamp = studyTimestamp(question);
    if (timestamp !== null) {
      const studiedTime = document.createElement("time");
      studiedTime.className = "studied-question-time";
      studiedTime.dateTime = new Date(timestamp).toISOString();
      studiedTime.textContent = "Estudada às " + timeFormatter.format(new Date(timestamp));
      wrapper.appendChild(studiedTime);
    }
    return wrapper;
  }

  function renderHistory(questions) {
    const container = document.getElementById("studiedQuestionGroups");
    container.textContent = "";
    const groups = groupQuestionsByDay(questions);

    document.getElementById("studiedQuestionCount").textContent = String(questions.length);
    document.getElementById("studiedDayCount").textContent = String(
      Array.from(groups.keys()).filter(function (day) {
        return day !== "Data de estudo não registrada";
      }).length
    );

    if (!questions.length) {
      const empty = document.createElement("p");
      empty.className = "academic-empty";
      empty.textContent = "Você ainda não marcou nenhuma pergunta como estudada.";
      container.appendChild(empty);
      setStatus("", "");
      return;
    }

    groups.forEach(function (entries, day) {
      const section = document.createElement("section");
      section.className = "academic-panel studied-question-day";

      const heading = document.createElement("h2");
      heading.textContent = day + " — " + entries.length +
        (entries.length === 1 ? " pergunta" : " perguntas");
      section.appendChild(heading);

      const list = document.createElement("div");
      list.className = "academic-question-card-list";
      entries.forEach(function (question) {
        list.appendChild(renderStudyCard(question));
      });
      section.appendChild(list);
      container.appendChild(section);
    });
    setStatus("", "");
  }

  function resourcesReady() {
    return !!(
      window.Auth &&
      window.Auth.isConfigured() &&
      window.ResourceWaiter &&
      window.AcademicWorkflowService &&
      window.ConversationQuestionCardRenderer
    );
  }

  async function initialize() {
    try {
      const ready = await window.ResourceWaiter.waitUntil(resourcesReady, WAIT_OPTIONS);
      if (!ready) throw new Error("Recursos de autenticação indisponíveis.");

      const session = await window.Auth.getSession();
      if (!session || !session.user) {
        window.location.replace(
          "/login/?next=" + encodeURIComponent("/conversation-questions/estudadas/")
        );
        return;
      }

      const service = window.AcademicWorkflowService.create(window.Auth.getClient());
      if (!(await service.isActiveStudent(session.user.id))) {
        setStatus("Esta página está disponível apenas para alunos ativos.", "error");
        return;
      }

      const questions = await service.getMyStudiedQuestions();
      renderHistory(questions);
    } catch (error) {
      console.error("Falha ao carregar o histórico de perguntas:", error);
      setStatus("Não foi possível carregar seu histórico. Atualize a página e tente novamente.", "error");
    } finally {
      document.body.classList.remove("auth-checking");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
