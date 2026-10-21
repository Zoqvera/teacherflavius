(function () {
  "use strict";

  function readInviteToken(search) {
    const raw = new URLSearchParams(String(search || "")).get("convite");
    const token = String(raw || "").trim().toLowerCase();
    return /^[0-9a-f]{48}$/.test(token) ? token : null;
  }

  function buildInviteUrl(token) {
    const normalized = String(token || "").trim().toLowerCase();
    if (!/^[0-9a-f]{48}$/.test(normalized)) {
      throw new Error("O identificador do link de matrícula é inválido.");
    }
    return "https://teacherflavius.com/complete-cadastro/?convite=" + normalized;
  }

  window.EnrollmentInviteClient = Object.freeze({
    readInviteToken: readInviteToken,
    buildInviteUrl: buildInviteUrl
  });
})();
