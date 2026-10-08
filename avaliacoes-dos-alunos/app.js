(function () {
  "use strict";

  const PAGE_PATH = "/avaliacoes-dos-alunos/";
  const LOGIN_PATH = "/login/";
  const STAR_PATH = "m12 2.5 2.9 5.88 6.49.94-4.7 4.58 1.11 6.47L12 17.32l-5.8 3.05 1.11-6.47-4.7-4.58 6.49-.94Z";
  const ui = {};

  function cacheUi() {
    ui.filter = document.getElementById("reviewStatusFilter");
    ui.refresh = document.getElementById("reviewRefreshButton");
    ui.status = document.getElementById("reviewAdminStatus");
    ui.list = document.getElementById("reviewAdminList");
  }

  function setStatus(message, tone) {
    ui.status.hidden = false;
    ui.status.textContent = message;
    ui.status.dataset.tone = tone || "neutral";
  }

  function clearStatus() {
    ui.status.hidden = true;
    ui.status.textContent = "";
    delete ui.status.dataset.tone;
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms);
    });
  }

  async function waitForAuth() {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (
        window.Auth &&
        typeof window.Auth.getSession === "function" &&
        typeof window.Auth.isTeacherAdmin === "function"
      ) {
        return true;
      }
      await sleep(100);
    }
    return false;
  }

  function redirectToLogin() {
    window.location.href = LOGIN_PATH + "?next=" + encodeURIComponent(PAGE_PATH);
  }

  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function lessonTypeLabel(value) {
    return value === "individual" ? "Aulas individuais" : "Aulas em grupo";
  }

  function statusLabel(value) {
    if (value === "approved") return "APROVADA";
    if (value === "rejected") return "REJEITADA";
    return "PENDENTE";
  }

  function createSvgStar(empty) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    if (empty) svg.dataset.empty = "true";
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", STAR_PATH);
    svg.appendChild(path);
    return svg;
  }

  function createStars(rating) {
    const wrapper = document.createElement("span");
    wrapper.className = "review-admin-stars";
    wrapper.setAttribute("aria-label", String(rating) + " de 5 estrelas");
    for (let index = 1; index <= 5; index += 1) {
      wrapper.appendChild(createSvgStar(index > Number(rating)));
    }
    return wrapper;
  }

  function createReviewCard(review) {
    const article = document.createElement("article");
    article.className = "review-admin-card";
    article.dataset.reviewId = review.review_id;

    const head = document.createElement("div");
    head.className = "review-admin-card-head";

    const student = document.createElement("div");
    student.className = "review-admin-student";
    const studentName = document.createElement("strong");
    studentName.textContent = review.student_name || "Aluno";
    const publicName = document.createElement("small");
    publicName.textContent = "Nome público: " + (review.display_name || "—");
    student.appendChild(studentName);
    student.appendChild(publicName);

    const badge = document.createElement("span");
    badge.className = "review-admin-badge";
    badge.dataset.status = review.status || "pending";
    badge.textContent = statusLabel(review.status);

    head.appendChild(student);
    head.appendChild(badge);

    const stars = createStars(review.rating);

    const comment = document.createElement("p");
    comment.className = "review-admin-comment";
    comment.textContent = review.comment || "";

    const meta = document.createElement("p");
    meta.className = "review-admin-meta";
    const metaParts = [
      lessonTypeLabel(review.lesson_type),
      "Enviada em " + formatDate(review.submitted_at),
      "Consentimento em " + formatDate(review.publication_consent_at)
    ];
    meta.textContent = metaParts.join(" · ");

    const noteLabel = document.createElement("label");
    noteLabel.className = "review-admin-note";
    const noteTitle = document.createElement("span");
    noteTitle.textContent = "Observação interna opcional";
    const note = document.createElement("textarea");
    note.maxLength = 1000;
    note.value = review.moderation_note || "";
    note.placeholder = "Use apenas se precisar registrar o motivo da decisão.";
    noteLabel.appendChild(noteTitle);
    noteLabel.appendChild(note);

    const actions = document.createElement("div");
    actions.className = "review-admin-actions";

    ["approved", "rejected"].forEach(function (action) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "review-admin-action";
      button.dataset.action = action;
      button.textContent = action === "approved" ? "APROVAR" : "REJEITAR";
      button.addEventListener("click", function () {
        moderateReview(review.review_id, action, note.value, button);
      });
      actions.appendChild(button);
    });

    article.appendChild(head);
    article.appendChild(stars);
    article.appendChild(comment);
    article.appendChild(meta);
    article.appendChild(noteLabel);
    article.appendChild(actions);
    return article;
  }

  function renderReviews(rows) {
    ui.list.textContent = "";

    if (!Array.isArray(rows) || rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "review-admin-empty";
      empty.textContent = "Nenhuma avaliação encontrada para este filtro.";
      ui.list.appendChild(empty);
      return;
    }

    rows.forEach(function (review) {
      ui.list.appendChild(createReviewCard(review));
    });
  }

  async function loadReviews() {
    ui.refresh.disabled = true;
    setStatus("Carregando avaliações...", "neutral");

    try {
      const response = await window.Auth.getClient().rpc("get_teacher_student_reviews", {
        target_status: ui.filter.value || null
      });
      if (response.error) throw response.error;
      renderReviews(response.data || []);
      clearStatus();
    } catch (error) {
      setStatus(error && error.message ? error.message : "Não foi possível carregar as avaliações.", "error");
    } finally {
      ui.refresh.disabled = false;
    }
  }

  async function moderateReview(reviewId, status, note, button) {
    const actionLabel = status === "approved" ? "aprovar" : "rejeitar";
    const confirmed = window.confirm("Deseja " + actionLabel + " esta avaliação?");
    if (!confirmed) return;

    button.disabled = true;
    setStatus("Salvando moderação...", "neutral");

    try {
      const response = await window.Auth.getClient().rpc("moderate_teacher_student_review", {
        target_review_id: reviewId,
        target_status: status,
        target_moderation_note: String(note || "").trim() || null
      });
      if (response.error) throw response.error;
      await loadReviews();
    } catch (error) {
      setStatus(error && error.message ? error.message : "Não foi possível salvar a moderação.", "error");
    } finally {
      button.disabled = false;
    }
  }

  async function initialize() {
    cacheUi();
    ui.filter.addEventListener("change", loadReviews);
    ui.refresh.addEventListener("click", loadReviews);

    try {
      const ready = await waitForAuth();
      if (!ready) throw new Error("Recursos de autenticação indisponíveis.");

      const session = await window.Auth.getSession();
      if (!session || !session.user) {
        redirectToLogin();
        return;
      }

      const isTeacher = await window.Auth.isTeacherAdmin();
      if (!isTeacher) {
        window.location.href = "/acesso-negado/";
        return;
      }

      document.body.classList.remove("auth-checking");
      await loadReviews();
    } catch (error) {
      document.body.classList.remove("auth-checking");
      setStatus(error && error.message ? error.message : "Não foi possível carregar a página.", "error");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
