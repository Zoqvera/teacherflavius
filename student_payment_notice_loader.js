(function () {
  "use strict";

  const PAYMENT_NOTICE_SCRIPT_ID = "teacher-flavius-payment-notice-script";
  const PAYMENT_NOTICE_SCRIPT_SRC = "/student_payment_notice.js?v=20260819-1";
  const SUPABASE_AUTH_STORAGE_KEY = "sb-wnigzpvgsbpjdxvjzugt-auth-token";
  const IDLE_CALLBACK_TIMEOUT_MS = 1800;
  const FALLBACK_DELAY_MS = 600;
  let paymentNoticeScheduled = false;

  function currentPath() {
    return (window.location.pathname || "/").toLowerCase();
  }

  function getLegacyHtmlBasePath(path) {
    const extensionSeparator = path.lastIndexOf(".");
    if (extensionSeparator < 0 || path.slice(extensionSeparator + 1) !== "html") return null;
    return path.slice(0, extensionSeparator);
  }

  function isPublicMarketingPage() {
    const path = currentPath();
    const legacyBasePath = getLegacyHtmlBasePath(path);

    return path === "/" ||
      legacyBasePath === "/index" ||
      path === "/quero_conhecer" ||
      legacyBasePath === "/quero_conhecer" ||
      path === "/quero-conhecer" ||
      path === "/quero-conhecer/" ||
      path.indexOf("/curso-de-ingles-online") === 0 ||
      path.indexOf("/recursos") === 0 ||
      path.indexOf("/sobre") === 0 ||
      path.indexOf("/landing-page") === 0;
  }

  function hasCachedSupabaseSession() {
    try {
      return !!(window.localStorage && window.localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY));
    } catch (_error) {
      return false;
    }
  }

  function appendPaymentNoticeScript() {
    if (!document.body || document.getElementById(PAYMENT_NOTICE_SCRIPT_ID)) return;

    const script = document.createElement("script");
    script.id = PAYMENT_NOTICE_SCRIPT_ID;
    script.src = PAYMENT_NOTICE_SCRIPT_SRC;
    script.async = true;
    document.body.appendChild(script);
  }

  function scheduleOnIdle() {
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(appendPaymentNoticeScript, { timeout: IDLE_CALLBACK_TIMEOUT_MS });
      return;
    }
    window.setTimeout(appendPaymentNoticeScript, FALLBACK_DELAY_MS);
  }

  function schedule() {
    if (paymentNoticeScheduled || document.getElementById(PAYMENT_NOTICE_SCRIPT_ID)) return;

    if (isPublicMarketingPage()) {
      if (!hasCachedSupabaseSession()) return;
      paymentNoticeScheduled = true;
      scheduleOnIdle();
      return;
    }

    paymentNoticeScheduled = true;
    appendPaymentNoticeScript();
  }

  window.StudentPaymentNoticeLoader = Object.freeze({
    schedule: schedule
  });

  schedule();
})();
