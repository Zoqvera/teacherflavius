(function () {
  "use strict";

  const DEFAULT_RETRY_PATH = "/area-do-estudante/";
  const ERROR_MESSAGES = Object.freeze({
    connection: Object.freeze({
      title: "Conexão indisponível",
      description: "Não foi possível conectar ao Supabase para confirmar seu acesso. Isso não significa que sua matrícula esteja inativa. Verifique a conexão e tente novamente."
    }),
    verification: Object.freeze({
      title: "Não foi possível verificar seu acesso",
      description: "O sistema não conseguiu concluir a verificação do cadastro neste momento. Por segurança, o acesso permanece protegido. Tente novamente."
    })
  });

  function getSafeRetryPath(value) {
    const path = String(value || "");
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") ||
        /[\u0000-\u001f\u007f]/.test(path)) {
      return DEFAULT_RETRY_PATH;
    }

    const pathname = path.split(/[?#]/, 1)[0];
    if (pathname === "/acesso-negado" || pathname === "/acesso-negado/") {
      return DEFAULT_RETRY_PATH;
    }

    return path;
  }

  function renderError() {
    const params = new URLSearchParams(window.location.search);
    const reason = params.get("reason");
    if (!Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, reason)) return;
    const message = ERROR_MESSAGES[reason];

    const heading = document.getElementById("access-status-title");
    const description = document.getElementById("access-status-message");
    const retry = document.getElementById("access-status-primary");
    if (!heading || !description || !retry) return;

    heading.textContent = message.title;
    description.textContent = message.description;
    retry.textContent = "TENTAR NOVAMENTE";
    retry.href = getSafeRetryPath(params.get("next"));
    document.title = message.title + " - Teacher Flávio";
  }

  renderError();
})();
