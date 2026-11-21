(function () {
  "use strict";

  async function loadConsent(auth, authorizationId) {
    if (!authorizationId || authorizationId.length > 512 || !/^[A-Za-z0-9_-]+$/.test(authorizationId)) {
      throw new Error("Solicitação de autorização inválida.");
    }
    const user = await auth.requireAuth({ skipProfileCheck: true });
    if (!user) return null;
    if (!await auth.isTeacherAdmin()) throw new Error("Acesso restrito ao professor administrador.");
    const response = await auth.getClient().auth.oauth.getAuthorizationDetails(authorizationId);
    if (response.error || !response.data) throw new Error("Não foi possível verificar a solicitação.");
    return response.data;
  }

  async function decideConsent(auth, authorizationId, decision) {
    const oauth = auth.getClient().auth.oauth;
    const response = decision === "approve"
      ? await oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
      : await oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
    if (response.error || !response.data?.redirect_url) throw new Error("Não foi possível concluir a solicitação.");
    return response.data.redirect_url;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { loadConsent, decideConsent };
    return;
  }

  const authorizationId = new URLSearchParams(window.location.search).get("authorization_id");
  const status = document.getElementById("status");
  const details = document.getElementById("details");
  const approve = document.getElementById("approve");
  const deny = document.getElementById("deny");

  function showError(error) { status.textContent = error.message || "Não foi possível verificar a solicitação."; }
  function redirect(url) {
    const target = new URL(url);
    if (target.protocol !== "https:") throw new Error("Destino de autorização inválido.");
    window.location.assign(target.href);
  }
  async function decide(decision) {
    approve.disabled = true;
    deny.disabled = true;
    try { redirect(await decideConsent(window.Auth, authorizationId, decision)); }
    catch (error) { showError(error); approve.disabled = false; deny.disabled = false; }
  }

  approve.addEventListener("click", () => decide("approve"));
  deny.addEventListener("click", () => decide("deny"));
  loadConsent(window.Auth, authorizationId).then(data => {
    if (!data) return;
    if (data.redirect_url) { redirect(data.redirect_url); return; }
    if (!data.client?.id || !data.client?.name || !data.redirect_uri) throw new Error("Solicitação de autorização incompleta.");
    document.getElementById("client-name").textContent = data.client.name;
    document.getElementById("client-id").textContent = data.client.id;
    document.getElementById("client-uri").textContent = data.client.uri || "Não informado";
    document.getElementById("scopes").textContent = data.scope || "Nenhuma";
    document.getElementById("redirect-uri").textContent = data.redirect_uri;
    status.textContent = "Solicitação pronta para análise.";
    details.hidden = false;
  }).catch(showError);
})();
