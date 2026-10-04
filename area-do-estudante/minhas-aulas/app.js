(function () {
  "use strict";

  const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";
  const LOGIN_PATH = "/login/?next=" + encodeURIComponent("/area-do-estudante/minhas-aulas/");

  let overview = null;
  let lessonCredits = [];
  let replacementOptions = [];

  function sleep(milliseconds) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, milliseconds);
    });
  }

  async function waitForAuth() {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      if (window.Auth && window.SUPABASE_CONFIG && Auth.isConfigured()) return true;
      await sleep(150);
    }
    return Boolean(window.Auth && window.SUPABASE_CONFIG && Auth.isConfigured());
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function setPageMessage(message, type) {
    const element = document.getElementById("pageMessage");
    if (!element) return;
    element.hidden = !message;
    element.className = "page-message" + (type ? " " + type : "");
    element.textContent = message || "";
  }

  function formatDateTime(value) {
    if (!value) return "Horário não definido";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Horário não definido";
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: SAO_PAULO_TIME_ZONE,
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function formatDeadline(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: SAO_PAULO_TIME_ZONE,
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function getClassDisplayNames(classes) {
    return (classes || [])
      .map(function (item) { return String(item.class_name || ("Turma " + item.class_number)); })
      .filter(Boolean);
  }

  function joinClassNames(classNames) {
    if (classNames.length <= 1) return classNames[0] || "";
    if (classNames.length === 2) return classNames[0] + " e " + classNames[1];
    return classNames.slice(0, -1).join(", ") + " e " + classNames[classNames.length - 1];
  }

  function buildUnpaidNotice(classes) {
    const classNames = getClassDisplayNames(classes);
    if (!classNames.length) return "Você ainda não está matriculado em uma turma.";
    return "Você está matriculado em nosso sistema, na turma " + joinClassNames(classNames) + ". Como você ainda não pagou pelas aulas, caso você não possa comparecer na aula, cancele a aula aqui no sistema e avise a Júlia no whatsapp. O professor poderá passar sua vaga para outro aluno e para continuar no curso você terá que escolher outra turma.";
  }

  async function rpc(functionName, parameters) {
    const response = await Auth.getClient().rpc(functionName, parameters || {});
    if (response.error) throw response.error;
    return response.data;
  }

  async function loadPageState() {
    overview = await rpc("get_my_lessons_overview");
    lessonCredits = overview && overview.is_paid
      ? (await rpc("get_my_lesson_credits") || [])
      : [];
    replacementOptions = overview && Number(overview.available_credits) > 0
      ? (await rpc("get_my_replacement_options") || [])
      : [];
  }

  function renderClassCards(classes, allowCancellation) {
    const list = classes || [];
    if (!list.length) {
      return '<div class="empty-state">Nenhuma turma vinculada ao seu cadastro.</div>';
    }

    return '<div class="class-list">' + list.map(function (item) {
      const className = item.class_name || ("Turma " + item.class_number);
      const scheduleParts = [];
      if (item.class_start_time) scheduleParts.push(String(item.class_start_time).slice(0, 5));
      const action = allowCancellation
        ? '<div class="action-row"><button class="secondary-button unpaid-cancel-button" type="button" data-class-number="' + Number(item.class_number) + '" data-class-name="' + escapeHtml(className) + '">CANCELAR AULA</button></div>'
        : '';
      return '<article class="class-card">' +
        '<div class="class-topline"><h3>' + escapeHtml(className) + '</h3></div>' +
        (scheduleParts.length ? '<div class="class-meta">Horário: ' + escapeHtml(scheduleParts.join(" · ")) + '</div>' : '') +
        action +
      '</article>';
    }).join("") + '</div>';
  }

  function getLessonStatusMetadata(status) {
    if (status === "available") return { label: "CRÉDITO DISPONÍVEL", className: "available" };
    if (status === "used") return { label: "REPOSIÇÃO CONFIRMADA", className: "used" };
    return { label: "CONFIRMADA", className: "" };
  }

  function renderLessonCards() {
    if (!lessonCredits.length) {
      return '<div class="empty-state">Nenhuma aula foi gerada para este período.</div>';
    }

    return '<div class="lesson-list">' + lessonCredits.map(function (credit) {
      const metadata = getLessonStatusMetadata(credit.status);
      const className = credit.class_name || credit.original_class_name || "Crédito de aula";
      const dateText = credit.status === "available"
        ? "Disponível para marcar reposição"
        : formatDateTime(credit.starts_at);
      const deadline = formatDeadline(credit.cancellation_deadline);
      const canCancel = credit.can_cancel === true;
      const hasScheduledLesson = credit.status === "scheduled" || credit.status === "used";
      let deadlineText = "";
      if (hasScheduledLesson && deadline) {
        deadlineText = canCancel
          ? '<p class="deadline-note">Cancelamento disponível até ' + escapeHtml(deadline) + '.</p>'
          : '<p class="deadline-note closed">O prazo de cancelamento desta aula foi encerrado.</p>';
      }

      const actions = [];
      if (canCancel && credit.status === "scheduled") {
        actions.push('<button class="secondary-button regular-cancel-button" type="button" data-credit-id="' + escapeHtml(credit.credit_id) + '">CANCELAR AULA</button>');
      }
      if (canCancel && credit.status === "used") {
        actions.push('<button class="secondary-button replacement-cancel-button" type="button" data-credit-id="' + escapeHtml(credit.credit_id) + '">CANCELAR REPOSIÇÃO</button>');
      }
      if (credit.status !== "available" && /^https?:\/\//i.test(String(credit.meeting_url || ""))) {
        actions.push('<a class="link-button" href="' + escapeHtml(credit.meeting_url) + '" target="_blank" rel="noopener noreferrer">ACESSAR AULA</a>');
      }

      return '<article class="lesson-card">' +
        '<div class="lesson-topline">' +
          '<h3>' + escapeHtml(className) + '</h3>' +
          '<span class="status-pill ' + metadata.className + '">' + metadata.label + '</span>' +
        '</div>' +
        '<div class="lesson-meta">' + escapeHtml(dateText) + '</div>' +
        deadlineText +
        (actions.length ? '<div class="action-row">' + actions.join("") + '</div>' : '') +
      '</article>';
    }).join("") + '</div>';
  }

  function renderReplacementOptions() {
    const availableCredits = lessonCredits.filter(function (credit) {
      return credit.status === "available";
    });

    if (!availableCredits.length) {
      return '<div class="empty-state">Você não possui crédito disponível para reposição. Ao cancelar uma aula dentro do prazo, o crédito ficará disponível aqui.</div>';
    }

    if (!replacementOptions.length) {
      return '<div class="empty-state">Nenhuma turma quinteto com vaga foi encontrada nos próximos 30 dias.</div>';
    }

    const nextCreditId = availableCredits[0].credit_id;
    return '<div class="replacement-list">' + replacementOptions.map(function (option) {
      const className = option.class_name || ("Turma " + option.class_number);
      const vacancyLabel = Number(option.available_spots) === 1 ? "1 vaga" : Number(option.available_spots) + " vagas";
      return '<article class="replacement-card">' +
        '<div class="replacement-topline">' +
          '<h3>' + escapeHtml(className) + '</h3>' +
          '<span class="vacancy-badge">' + escapeHtml(vacancyLabel) + '</span>' +
        '</div>' +
        '<div class="replacement-meta">' + escapeHtml(formatDateTime(option.starts_at)) + '</div>' +
        '<div class="action-row"><button class="action-button replacement-book-button" type="button" data-credit-id="' + escapeHtml(nextCreditId) + '" data-class-number="' + Number(option.class_number) + '" data-starts-at="' + escapeHtml(option.starts_at) + '">MARCAR REPOSIÇÃO</button></div>' +
      '</article>';
    }).join("") + '</div>';
  }

  function renderUnpaidState() {
    const classes = overview.classes || [];
    return '<section class="surface-card">' +
      '<h2>Minhas turmas</h2>' +
      '<p class="card-description">Confira as turmas atualmente vinculadas ao seu cadastro.</p>' +
      renderClassCards(classes, classes.length > 0) +
      '<div class="unpaid-notice">' + escapeHtml(buildUnpaidNotice(classes)) + '</div>' +
    '</section>';
  }

  function renderPaidState() {
    const classesPerMonth = Number(overview.classes_per_month || 0);
    const availableCredits = Number(overview.available_credits || 0);
    const configurationPending = classesPerMonth < 1;

    return '<section class="summary-grid" aria-label="Resumo das aulas">' +
      '<div class="summary-card"><strong>' + (configurationPending ? "—" : classesPerMonth) + '</strong><span>Aulas contratadas no mês</span></div>' +
      '<div class="summary-card"><strong>' + availableCredits + '</strong><span>Créditos para reposição</span></div>' +
    '</section>' +
    '<section class="surface-card">' +
      '<h2>Minhas aulas</h2>' +
      '<p class="card-description">Aulas confirmadas podem ser canceladas até 12 horas antes do início.</p>' +
      (configurationPending
        ? '<div class="config-note">O professor ainda precisa definir a quantidade de aulas contratadas por mês no seu perfil.</div>'
        : renderLessonCards()) +
    '</section>' +
    '<section class="surface-card">' +
      '<h2>Marcar reposição</h2>' +
      '<p class="card-description">Use um crédito disponível para escolher uma vaga em outra turma quinteto.</p>' +
      (configurationPending
        ? '<div class="empty-state">As reposições serão liberadas após a configuração da quantidade de aulas contratadas.</div>'
        : renderReplacementOptions()) +
    '</section>';
  }

  function renderPage() {
    const content = document.getElementById("myClassesContent");
    if (!content || !overview) return;
    content.innerHTML = overview.is_paid ? renderPaidState() : renderUnpaidState();
    attachActionHandlers();
  }

  function setButtonBusy(button, busyText) {
    if (!button) return;
    if (!button.dataset.defaultText) button.dataset.defaultText = button.textContent;
    button.disabled = true;
    button.textContent = busyText;
  }

  function restoreButton(button) {
    if (!button) return;
    button.disabled = false;
    button.textContent = button.dataset.defaultText || button.textContent;
  }

  async function refreshAfterAction(successMessage) {
    await loadPageState();
    renderPage();
    setPageMessage(successMessage, "success");
  }

  async function cancelRegularLesson(button) {
    const confirmed = window.confirm("Cancelar esta aula? O cancelamento dentro do prazo transformará a aula em um crédito para reposição.");
    if (!confirmed) return;

    setButtonBusy(button, "CANCELANDO...");
    setPageMessage("", "");
    try {
      await rpc("cancel_my_regular_lesson", { target_credit_id: button.dataset.creditId });
      await refreshAfterAction("Aula cancelada. Um crédito de reposição foi liberado.");
    } catch (error) {
      setPageMessage(error.message || "Não foi possível cancelar a aula.", "error");
      restoreButton(button);
    }
  }

  async function cancelReplacement(button) {
    const confirmed = window.confirm("Cancelar esta reposição? O crédito voltará a ficar disponível para outra marcação.");
    if (!confirmed) return;

    setButtonBusy(button, "CANCELANDO...");
    setPageMessage("", "");
    try {
      await rpc("cancel_my_lesson_replacement", { target_credit_id: button.dataset.creditId });
      await refreshAfterAction("Reposição cancelada. O crédito voltou a ficar disponível.");
    } catch (error) {
      setPageMessage(error.message || "Não foi possível cancelar a reposição.", "error");
      restoreButton(button);
    }
  }

  async function bookReplacement(button) {
    const confirmed = window.confirm("Usar um crédito para marcar esta reposição?");
    if (!confirmed) return;

    setButtonBusy(button, "MARCANDO...");
    setPageMessage("", "");
    try {
      await rpc("book_my_lesson_replacement", {
        target_credit_id: button.dataset.creditId,
        target_class_number: Number(button.dataset.classNumber),
        target_starts_at: button.dataset.startsAt
      });
      await refreshAfterAction("Reposição marcada com sucesso.");
    } catch (error) {
      setPageMessage(error.message || "Não foi possível marcar a reposição.", "error");
      restoreButton(button);
    }
  }

  async function cancelUnpaidClass(button) {
    const className = button.dataset.className || "esta turma";
    const confirmed = window.confirm("Cancelar sua vaga em " + className + "? Você será retirado desta turma e precisará escolher outra turma para continuar no curso.");
    if (!confirmed) return;

    setButtonBusy(button, "CANCELANDO...");
    setPageMessage("", "");
    try {
      await rpc("cancel_my_unpaid_class", { target_class_number: Number(button.dataset.classNumber) });
      await refreshAfterAction("Sua vaga nesta turma foi cancelada. Avise a Júlia no whatsapp.");
    } catch (error) {
      setPageMessage(error.message || "Não foi possível cancelar sua vaga na turma.", "error");
      restoreButton(button);
    }
  }

  function attachActionHandlers() {
    document.querySelectorAll(".regular-cancel-button").forEach(function (button) {
      button.addEventListener("click", function () { cancelRegularLesson(button); });
    });
    document.querySelectorAll(".replacement-cancel-button").forEach(function (button) {
      button.addEventListener("click", function () { cancelReplacement(button); });
    });
    document.querySelectorAll(".replacement-book-button").forEach(function (button) {
      button.addEventListener("click", function () { bookReplacement(button); });
    });
    document.querySelectorAll(".unpaid-cancel-button").forEach(function (button) {
      button.addEventListener("click", function () { cancelUnpaidClass(button); });
    });
  }

  async function initialize() {
    const loginStatus = document.getElementById("loginStatus");
    const ready = await waitForAuth();
    if (!ready) {
      if (loginStatus) loginStatus.textContent = "Não foi possível carregar a autenticação.";
      document.body.classList.remove("auth-checking");
      return;
    }

    const session = await Auth.getSession();
    if (!session || !session.user) {
      window.location.href = LOGIN_PATH;
      return;
    }

    if (loginStatus) loginStatus.textContent = "Aluno autenticado: " + (session.user.email || "acesso confirmado") + ".";
    document.body.classList.remove("auth-checking");

    try {
      await loadPageState();
      renderPage();
    } catch (error) {
      const content = document.getElementById("myClassesContent");
      if (content) content.innerHTML = '<section class="surface-card empty-state">Não foi possível carregar suas aulas.</section>';
      setPageMessage(error.message || "Não foi possível carregar suas aulas.", "error");
    }
  }

  initialize();
})();
