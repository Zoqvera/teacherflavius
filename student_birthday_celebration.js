(function () {
  "use strict";

  if (window.__teacherFlaviusStudentBirthdayCelebrationLoaded) return;
  window.__teacherFlaviusStudentBirthdayCelebrationLoaded = true;

  const POPUP_DURATION_MS = 30000;
  const CONFETTI_DURATION_MS = 9000;
  const CONFETTI_PIECES = 96;
  const CONFETTI_COLORS = ["#818cf8", "#a78bfa", "#f472b6", "#facc15", "#34d399", "#60a5fa"];
  const AUTH_WAIT_OPTIONS = Object.freeze({ maxAttempts: 30, delayMs: 100 });

  function authResourcesAreReady() {
    return !!(window.Auth && Auth.getClient && Auth.getSession);
  }

  async function waitForAuth() {
    if (authResourcesAreReady()) return true;
    if (!window.ResourceWaiter) return false;
    return window.ResourceWaiter.waitUntil(authResourcesAreReady, AUTH_WAIT_OPTIONS);
  }

  function isLoginPage() {
    const path = window.location.pathname || "/";
    return path === "/login/" || path.endsWith("/login.html");
  }

  function installStyles() {
    if (document.getElementById("teacher-student-birthday-celebration-styles")) return;

    const style = document.createElement("style");
    style.id = "teacher-student-birthday-celebration-styles";
    style.textContent = [
      ".tf-student-birthday-confetti{position:fixed;inset:0;z-index:2147483300;overflow:hidden;pointer-events:none}",
      ".tf-student-birthday-confetti-piece{position:absolute;top:-24px;left:var(--tf-left);width:var(--tf-width);height:var(--tf-height);background:var(--tf-color);border-radius:2px;opacity:.96;transform:rotate(var(--tf-rotation));animation:tf-student-birthday-fall var(--tf-duration) linear var(--tf-delay) forwards}",
      "@keyframes tf-student-birthday-fall{0%{transform:translate3d(0,-4vh,0) rotate(var(--tf-rotation));opacity:1}100%{transform:translate3d(var(--tf-drift),108vh,0) rotate(calc(var(--tf-rotation) + 760deg));opacity:.9}}",
      ".tf-student-birthday-popup{position:fixed;z-index:2147483400;top:50%;left:50%;width:min(calc(100% - 36px),560px);transform:translate(-50%,-50%);padding:30px 26px;border:1px solid rgba(255,255,255,.22);border-radius:22px;background:linear-gradient(145deg,#111827,#312e81);box-shadow:0 30px 90px rgba(0,0,0,.52);color:#fff;font-family:Georgia,serif;text-align:center;cursor:pointer}",
      ".tf-student-birthday-popup:focus-visible{outline:3px solid #facc15;outline-offset:4px}",
      ".tf-student-birthday-title{display:block;margin-bottom:12px;font-size:clamp(25px,6vw,38px);font-weight:700;letter-spacing:.04em;line-height:1.1}",
      ".tf-student-birthday-message{display:block;font-size:clamp(16px,4vw,20px);line-height:1.55;color:#f8fafc}",
      ".tf-student-birthday-hint{display:block;margin-top:17px;font:700 11px/1.4 monospace;letter-spacing:.08em;text-transform:uppercase;color:#c7d2fe}",
      "@media(prefers-reduced-motion:reduce){.tf-student-birthday-confetti{display:none}}"
    ].join("");
    document.head.appendChild(style);
  }

  function randomBetween(minimum, maximum) {
    return minimum + Math.random() * (maximum - minimum);
  }

  function createConfettiPiece() {
    const piece = document.createElement("span");
    piece.className = "tf-student-birthday-confetti-piece";
    piece.style.setProperty("--tf-left", randomBetween(0, 100).toFixed(2) + "vw");
    piece.style.setProperty("--tf-width", randomBetween(6, 11).toFixed(1) + "px");
    piece.style.setProperty("--tf-height", randomBetween(10, 18).toFixed(1) + "px");
    piece.style.setProperty("--tf-color", CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]);
    piece.style.setProperty("--tf-rotation", randomBetween(0, 360).toFixed(0) + "deg");
    piece.style.setProperty("--tf-drift", randomBetween(-90, 90).toFixed(0) + "px");
    piece.style.setProperty("--tf-duration", randomBetween(4.8, 8.4).toFixed(2) + "s");
    piece.style.setProperty("--tf-delay", randomBetween(0, 2.2).toFixed(2) + "s");
    return piece;
  }

  function createConfettiLayer() {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;

    const layer = document.createElement("div");
    layer.className = "tf-student-birthday-confetti";
    layer.setAttribute("aria-hidden", "true");

    const fragment = document.createDocumentFragment();
    for (let index = 0; index < CONFETTI_PIECES; index += 1) {
      fragment.appendChild(createConfettiPiece());
    }
    layer.appendChild(fragment);
    document.body.appendChild(layer);
    return layer;
  }

  function createPopup() {
    const popup = document.createElement("button");
    popup.type = "button";
    popup.className = "tf-student-birthday-popup";
    popup.setAttribute(
      "aria-label",
      "PARABENS! O teacher Flávio te deseja todo sucesso do mundo. Que Deus abençoe você e sua família!"
    );
    popup.innerHTML = [
      '<span class="tf-student-birthday-title">PARABENS!</span>',
      '<span class="tf-student-birthday-message">O teacher Flávio te deseja todo sucesso do mundo. Que Deus abençoe você e sua família!</span>',
      '<span class="tf-student-birthday-hint">Clique para fechar</span>'
    ].join("");
    document.body.appendChild(popup);
    return popup;
  }

  function showCelebration() {
    if (!document.body || document.getElementById("teacherStudentBirthdayCelebration")) return;

    installStyles();
    const container = document.createElement("div");
    container.id = "teacherStudentBirthdayCelebration";
    document.body.appendChild(container);

    const confettiLayer = createConfettiLayer();
    const popup = createPopup();
    let dismissed = false;

    function dismiss() {
      if (dismissed) return;
      dismissed = true;
      window.clearTimeout(autoDismissTimer);
      window.clearTimeout(confettiCleanupTimer);
      if (popup && popup.isConnected) popup.remove();
      if (confettiLayer && confettiLayer.isConnected) confettiLayer.remove();
      if (container.isConnected) container.remove();
    }

    popup.addEventListener("click", dismiss, { once: true });

    const autoDismissTimer = window.setTimeout(dismiss, POPUP_DURATION_MS);
    const confettiCleanupTimer = window.setTimeout(function () {
      if (confettiLayer && confettiLayer.isConnected) confettiLayer.remove();
    }, CONFETTI_DURATION_MS);

    window.setTimeout(function () { popup.focus(); }, 50);
  }

  async function claimCelebration(client) {
    const response = await client.rpc("claim_my_birthday_celebration");
    if (response.error) throw response.error;
    return response.data && response.data.show === true;
  }

  async function initialize() {
    if (isLoginPage() || !(await waitForAuth())) return;

    const session = await Auth.getSession();
    const client = Auth.getClient();
    if (!session || !session.user || !client) return;

    try {
      if (await claimCelebration(client)) showCelebration();
    } catch (error) {
      console.warn(
        "Não foi possível verificar a celebração de aniversário do aluno:",
        error && error.message ? error.message : error
      );
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
