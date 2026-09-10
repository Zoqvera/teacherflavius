(function () {
  "use strict";

  if (window.__studentAccessTrackerLoaded) return;
  window.__studentAccessTrackerLoaded = true;

  const AUTH_WAIT_OPTIONS = Object.freeze({
    maxAttempts: 20,
    delayMs: 150
  });

  let trackingStarted = false;

  function isAuthReady() {
    return !!(window.Auth && Auth.getClient && Auth.getSession);
  }

  function waitForAuth() {
    const resourceWaiter = window.ResourceWaiter;
    if (!resourceWaiter || typeof resourceWaiter.waitUntil !== "function") {
      return Promise.resolve(false);
    }
    return resourceWaiter.waitUntil(isAuthReady, AUTH_WAIT_OPTIONS);
  }

  function getTimezone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch (error) {
      return "";
    }
  }

  async function logCurrentPage() {
    if (!(await waitForAuth())) return null;

    const session = await Auth.getSession();
    const client = Auth.getClient();
    if (!session || !session.user || !client) return null;

    const response = await client.rpc("log_student_page_access", {
      target_page_path: window.location.pathname || "/",
      target_page_title: document.title || "",
      target_timezone: getTimezone()
    });

    if (response.error) {
      console.warn("Não foi possível registrar o acesso:", response.error.message);
      return null;
    }

    return response.data || null;
  }

  async function startTracking() {
    if (trackingStarted) return;
    trackingStarted = true;
    await logCurrentPage();
  }

  window.StudentAccessTracker = {
    logCurrentPage: logCurrentPage
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startTracking, { once: true });
  } else {
    startTracking();
  }

  window.addEventListener("pageshow", function (event) {
    if (event.persisted) logCurrentPage();
  });
})();