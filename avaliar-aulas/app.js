(function () {
  "use strict";

  const PAGE_PATH = "/avaliar-aulas/";
  const LOGIN_PATH = "/login/";
  const state = {
    profileName: "",
    lessonType: "",
    review: null
  };

  const ui = {};

  function cacheUi() {
    ui.status = document.getElementById("reviewPageStatus");
    ui.panel = document.getElementById("reviewFormPanel");
    ui.studentName = document.getElementById("reviewStudentName");
    ui.lessonType = document.getElementById("reviewLessonType");
    ui.existingStatus = document.getElementById("reviewExistingStatus");
    ui.form = document.getElementById("studentReviewForm");
    ui.comment = document.getElementById("reviewComment");
    ui.commentCount = document.getElementById("reviewCommentCount");
    ui.preview = document.getElementById("reviewDisplayNamePreview");
    ui.consent = document.getElementById("reviewPublicationConsent");
    ui.submit = document.getElementById("reviewSubmitButton");
    ui.remove = document.getElementById("reviewDeleteButton");
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
        typeof window.Auth.getClient === "function"
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

  function formatLessonType(value) {
    return value === "individual" ? "Aulas individuais" : "Aulas em grupo";
  }

  function getNameMode() {
    const checked = ui.form.querySelector('input[name="displayNameMode"]:checked');
    return checked ? checked.value : "";
  }

  function buildDisplayNamePreview() {
    const normalized = String(state.profileName || "").trim().replace(/\s+/g, " ");
    if (!normalized) return "Aluno";

    if (getNameMode() !== "first_initial") return normalized;

    const parts = normalized.split(" ");
    if (parts.length < 2) return normalized;
    return parts[0] + " " + parts[parts.length - 1].slice(0, 1).toUpperCase() + ".";
  }

  function updatePreview() {
    ui.preview.textContent = buildDisplayNamePreview();
  }

  function updateCommentCount() {
    ui.commentCount.textContent = String(ui.comment.value.length);
  }

  function selectRadio(name, value) {
    const input = ui.form.querySelector(
      'input[name="' + name + '"][value="' + CSS.escape(String(value)) + '"]'
    );
    if (input) input.checked = true;
  }

  function statusCopy(review) {
    if (!review) return "";

    if (review.status === "approved") {
      return "Sua avaliação está aprovada e pode aparecer nas páginas públicas da modalidade.";
    }
    if (review.status === "rejected") {
      return review.moderation_note
        ? "Sua avaliação não está publicada. Observação do professor: " + review.moderation_note
        : "Sua avaliação não está publicada. Você pode editar e enviar novamente.";
    }
    return "Sua avaliação foi enviada e está aguardando moderação.";
  }

  function populateReview(payload) {
    state.profileName = payload.student_name || "";
    state.lessonType = payload.lesson_type || "";
    state.review = payload.review || null;

    ui.studentName.textContent = state.profileName;
    ui.lessonType.textContent = formatLessonType(state.lessonType);

    if (state.review) {
      selectRadio("rating", state.review.rating);
      selectRadio("displayNameMode", state.review.display_name_mode);
      ui.comment.value = state.review.comment || "";
      ui.existingStatus.hidden = false;
      ui.existingStatus.dataset.status = state.review.status || "pending";
      ui.existingStatus.textContent = statusCopy(state.review);
      ui.remove.hidden = false;
    } else {
      selectRadio("displayNameMode", "first_initial");
      ui.existingStatus.hidden = true;
      ui.remove.hidden = true;
    }

    ui.consent.checked = false;
    updatePreview();
    updateCommentCount();
    ui.panel.hidden = false;
  }

  async function loadReview() {
    const response = await window.Auth.getClient().rpc("get_my_student_review");
    if (response.error) throw response.error;
    populateReview(response.data || {});
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const ratingInput = ui.form.querySelector('input[name="rating"]:checked');
    const displayMode = getNameMode();
    const comment = ui.comment.value.trim();

    if (!ratingInput) {
      setStatus("Escolha uma nota de 1 a 5 estrelas.", "error");
      return;
    }
    if (!displayMode) {
      setStatus("Escolha como seu nome será publicado.", "error");
      return;
    }
    if (comment.length < 10 || comment.length > 1000) {
      setStatus("O comentário deve ter entre 10 e 1000 caracteres.", "error");
      return;
    }
    if (!ui.consent.checked) {
      setStatus("Autorize a publicação para enviar sua avaliação.", "error");
      return;
    }

    ui.submit.disabled = true;
    setStatus("Enviando sua avaliação...", "neutral");

    try {
      const response = await window.Auth.getClient().rpc("submit_my_student_review", {
        target_rating: Number(ratingInput.value),
        target_comment: comment,
        target_display_name_mode: displayMode,
        target_publication_consent: true
      });
      if (response.error) throw response.error;

      await loadReview();
      setStatus("Avaliação enviada. Ela ficará pública depois da aprovação do professor.", "success");
    } catch (error) {
      setStatus(error && error.message ? error.message : "Não foi possível enviar sua avaliação.", "error");
    } finally {
      ui.submit.disabled = false;
    }
  }

  async function handleDelete() {
    const confirmed = window.confirm(
      "Retirar sua avaliação? Ela deixará de aparecer nas páginas públicas."
    );
    if (!confirmed) return;

    ui.remove.disabled = true;
    setStatus("Retirando sua avaliação...", "neutral");

    try {
      const response = await window.Auth.getClient().rpc("delete_my_student_review");
      if (response.error) throw response.error;

      state.review = null;
      ui.form.reset();
      selectRadio("displayNameMode", "first_initial");
      ui.existingStatus.hidden = true;
      ui.remove.hidden = true;
      updatePreview();
      updateCommentCount();
      setStatus("Sua avaliação foi retirada.", "success");
    } catch (error) {
      setStatus(error && error.message ? error.message : "Não foi possível retirar sua avaliação.", "error");
    } finally {
      ui.remove.disabled = false;
    }
  }

  async function initialize() {
    cacheUi();
    ui.comment.addEventListener("input", updateCommentCount);
    ui.form.addEventListener("change", function (event) {
      if (event.target && event.target.name === "displayNameMode") updatePreview();
    });
    ui.form.addEventListener("submit", handleSubmit);
    ui.remove.addEventListener("click", handleDelete);

    try {
      const ready = await waitForAuth();
      if (!ready) throw new Error("Recursos de autenticação indisponíveis.");

      const session = await window.Auth.getSession();
      if (!session || !session.user) {
        redirectToLogin();
        return;
      }

      await loadReview();
      clearStatus();
      document.body.classList.remove("auth-checking");
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
