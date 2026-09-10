(function () {
  "use strict";

  const PRIVACY_CONSENT_CHANGED_EVENT = "tf:privacy-consent-changed";
  const DENIED_CONSENT = Object.freeze({
    analytics_storage: "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied"
  });

  let settings = null;

  function loadAnalyticsSequence() {
    settings.loadScriptAsset(settings.assets.analyticsAttribution, function () {
      settings.loadScriptAsset(settings.assets.analytics, function () {
        settings.loadScriptAsset(settings.assets.cro);
      });
    });
  }

  function disableAnalytics() {
    window["ga-disable-" + settings.measurementId] = true;
    if (typeof window.gtag === "function") {
      window.gtag("consent", "update", DENIED_CONSENT);
    }
  }

  function hasAnalyticsConsent() {
    const privacy = window.TeacherFlaviusPrivacy;
    return !!(
      privacy &&
      typeof privacy.hasAnalyticsConsent === "function" &&
      privacy.hasAnalyticsConsent()
    );
  }

  function applyPrivacyChoice() {
    if (!settings) return;

    if (hasAnalyticsConsent()) {
      window["ga-disable-" + settings.measurementId] = false;
      loadAnalyticsSequence();
      return;
    }

    disableAnalytics();
  }

  function initialize(options) {
    settings = options;
    window.addEventListener(PRIVACY_CONSENT_CHANGED_EVENT, applyPrivacyChoice);
    settings.loadScriptAsset(settings.assets.privacyConsent, applyPrivacyChoice);
  }

  window.SitePrivacyAnalytics = Object.freeze({
    initialize: initialize,
    applyPrivacyChoice: applyPrivacyChoice
  });
})();
