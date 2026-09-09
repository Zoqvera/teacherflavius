(function () {
  "use strict";

  let started = false;

  async function enforceAccess() {
    if (started) return;
    started = true;

    if (!window.Auth || typeof Auth.requireAuth !== "function") {
      window.location.replace("/login/?next=" + encodeURIComponent("/area-do-estudante/"));
      return;
    }

    try {
      await Auth.requireAuth();
    } catch (error) {
      console.error("Não foi possível validar o acesso à Área do Estudante:", error);
      window.location.replace("/acesso-negado/");
    }
  }

  enforceAccess();
})();
