(function () {
  "use strict";

  var TRACKING_EXCLUDED_KEY = "tf_marketing_tracking_excluded_v1";
  var AUTH_WAIT_ATTEMPTS = 30;
  var AUTH_WAIT_INTERVAL_MS = 100;

  function sleep(ms) {
    return new Promise(function (resolve) { window.setTimeout(resolve, ms); });
  }

  function safeSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (error) {
      return false;
    }
  }

  async function waitForAuth() {
    for (var attempt = 0; attempt < AUTH_WAIT_ATTEMPTS; attempt += 1) {
      if (window.Auth && Auth.getClient && Auth.getSession && Auth.isConfigured && Auth.isConfigured()) return true;
      await sleep(AUTH_WAIT_INTERVAL_MS);
    }
    return !!(window.Auth && Auth.getClient && Auth.getSession && Auth.isConfigured && Auth.isConfigured());
  }

  async function hasTeacherAccess() {
    if (!(await waitForAuth())) return false;

    var session = await Auth.getSession();
    if (!session || !session.user) return false;

    var response = await Auth.getClient().rpc("get_teacher_acquisition_summary", { period_days: 7 });
    return !response.error;
  }

  async function excludeCurrentDevice() {
    if (!(await hasTeacherAccess())) return;
    safeSet(TRACKING_EXCLUDED_KEY, "1");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", excludeCurrentDevice, { once: true });
  } else {
    excludeCurrentDevice();
  }
})();
