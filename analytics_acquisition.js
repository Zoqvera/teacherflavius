(function () {
  "use strict";

  const FIRST_TOUCH_KEY = "tf_analytics_first_touch_v1";
  const LAST_TOUCH_KEY = "tf_analytics_last_touch_v1";

  function getUtils() {
    if (!window.TeacherAnalyticsUtils) {
      throw new Error("Analytics utilities were not initialized.");
    }
    return window.TeacherAnalyticsUtils;
  }

  function referrerHost() {
    if (!document.referrer) return "";

    try {
      return new URL(document.referrer).hostname.toLowerCase();
    } catch (_error) {
      return "";
    }
  }

  function acquisitionFromLocation() {
    const utils = getUtils();
    const params = new URLSearchParams(window.location.search || "");
    let source = utils.cleanText(params.get("utm_source"), 80);
    let medium = utils.cleanText(params.get("utm_medium"), 80);
    const campaign = utils.cleanText(params.get("utm_campaign"), 100);
    const content = utils.cleanText(params.get("utm_content"), 100);
    const term = utils.cleanText(params.get("utm_term"), 100);
    const refHost = referrerHost();

    if (!source) {
      if (refHost && refHost !== window.location.hostname.toLowerCase()) {
        source = refHost;
        medium = medium || "referral";
      } else {
        source = "direct";
        medium = medium || "none";
      }
    }

    return {
      source: source,
      medium: medium || "unknown",
      campaign: campaign || "not_set",
      content: content || "not_set",
      term: term || "not_set",
      landing_page: utils.currentPath(),
      captured_at: new Date().toISOString()
    };
  }

  function capture() {
    const utils = getUtils();
    const current = acquisitionFromLocation();
    const hasUtm = new URLSearchParams(window.location.search || "").has("utm_source");
    let first = utils.safeJsonParse(
      utils.safeStorageGet(window.localStorage, FIRST_TOUCH_KEY),
      null
    );

    if (!first) {
      first = current;
      utils.safeStorageSet(window.localStorage, FIRST_TOUCH_KEY, JSON.stringify(first));
    }

    if (hasUtm || !utils.safeStorageGet(window.sessionStorage, LAST_TOUCH_KEY)) {
      utils.safeStorageSet(window.sessionStorage, LAST_TOUCH_KEY, JSON.stringify(current));
    }

    return {
      first: first,
      last: utils.safeJsonParse(
        utils.safeStorageGet(window.sessionStorage, LAST_TOUCH_KEY),
        current
      )
    };
  }

  window.TeacherAnalyticsAcquisition = Object.freeze({
    capture: capture
  });
})();
