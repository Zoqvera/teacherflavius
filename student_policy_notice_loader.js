(function () {
  "use strict";

  const SCRIPT_ID = "teacher-flavius-policy-notice-script";
  const SCRIPT_SRC = "/student_policy_notice.js?v=20261005-1";
  const SUPABASE_AUTH_STORAGE_KEY = "sb-wnigzpvgsbpjdxvjzugt-auth-token";
  let scheduled = false;

  function currentPath() {
    return (window.location.pathname || "/").toLowerCase();
  }

  function isExcludedPage() {
    const path = currentPath();
    return path === "/login/" ||
      path === "/login.html" ||
      path === "/complete-cadastro/" ||
      path === "/complete-cadastro.html" ||
      path.indexOf("/acesso-negado") === 0;
  }

  function isPublicMarketingPage() {
    const path = currentPath();
    return path === "/" ||
      path.indexOf("/quero-conhecer") === 0 ||
      path.indexOf("/quero_conhecer") === 0 ||
      path.indexOf("/curso-de-ingles") === 0 ||
      path.indexOf("/aulas-em-grupo") === 0 ||
      path.indexOf("/aulas-individuais") === 0 ||
      path.indexOf("/recursos") === 0 ||
      path.indexOf("/sobre") === 0 ||
      path.indexOf("/landing-page") === 0;
  }

  function hasCachedSession() {
    try {
      return !!(
        window.localStorage &&
        window.localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY)
      );
    } catch (_error) {
      return false;
    }
  }

  function appendScript() {
    if (!document.body || document.getElementById(SCRIPT_ID)) return;
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    document.body.appendChild(script);
  }

  function schedule() {
    if (scheduled || isExcludedPage()) return;
    if (isPublicMarketingPage() && !hasCachedSession()) return;
    scheduled = true;

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", appendScript, { once: true });
      return;
    }
    appendScript();
  }

  window.StudentPolicyNoticeLoader = Object.freeze({
    schedule: schedule
  });

  schedule();
})();
