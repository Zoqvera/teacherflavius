(function () {
  "use strict";

  const HOMEWORK_PATH = "/area-do-estudante/homeworks/";
  const LOGIN_PATH = "/login/";
  const AUTH_MAX_ATTEMPTS = 40;
  const AUTH_RETRY_DELAY_MS = 100;
  const PREVIEW_ACTIVITY_COUNT = 9;

  function showStatus(message) {
    const status = document.getElementById("homeworkStatus");
    if (status) status.textContent = message;
  }

  function authIsReady() {
    return !!(window.Auth && window.SUPABASE_CONFIG &&
      window.HomeworkAccessService && window.HomeworkActivityModel &&
      window.Auth.isConfigured());
  }

  function createActivityItem(blueprint) {
    const item = document.createElement("li");
    item.className = "homework-activity";

    const title = document.createElement("strong");
    title.textContent = blueprint.title;

    const details = document.createElement("span");
    details.textContent = "Rascunho — não publicado";

    item.appendChild(title);
    item.appendChild(details);
    return item;
  }

  function showTeacherPreview() {
    const preview = document.getElementById("homeworkPreview");
    const list = document.getElementById("homeworkActivityList");
    if (!preview || !list) {
      showStatus("A estrutura da pré-visualização está indisponível.");
      return;
    }

    const drafts = window.HomeworkActivityModel.listDrafts(PREVIEW_ACTIVITY_COUNT);
    const fragment = document.createDocumentFragment();
    drafts.forEach(function (draft) {
      fragment.appendChild(createActivityItem(draft));
    });

    list.replaceChildren(fragment);
    preview.hidden = false;
    showStatus("Acesso de professor confirmado. Nenhuma atividade foi publicada.");
  }

  async function initialize() {
    if (!window.ResourceWaiter) {
      showStatus("Não foi possível iniciar a verificação de acesso.");
      return;
    }

    const ready = await window.ResourceWaiter.waitUntil(authIsReady, {
      maxAttempts: AUTH_MAX_ATTEMPTS,
      delayMs: AUTH_RETRY_DELAY_MS
    });
    if (!ready) {
      showStatus("A autenticação está indisponível. Atualize a página.");
      return;
    }

    const access = await window.HomeworkAccessService.resolveAccess(window.Auth);
    if (access === window.HomeworkAccessService.ACCESS.UNAUTHENTICATED) {
      window.location.replace(LOGIN_PATH + "?next=" + encodeURIComponent(HOMEWORK_PATH));
      return;
    }
    if (access !== window.HomeworkAccessService.ACCESS.TEACHER) {
      showStatus(access === window.HomeworkAccessService.ACCESS.FORBIDDEN
        ? "Acesso restrito ao professor. O recurso não está disponível para alunos."
        : "Não foi possível validar a permissão administrativa. Acesso bloqueado.");
      return;
    }

    showTeacherPreview();
  }

  initialize().catch(function (error) {
    console.error("Falha na inicialização de TAREFAS PARA CASA:", error);
    showStatus("Não foi possível abrir a pré-visualização. Acesso bloqueado.");
  });
})();
