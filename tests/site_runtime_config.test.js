const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadConfig() {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "site_runtime_config.js"),
    "utf8"
  );
  const context = { window: {} };
  vm.runInNewContext(source, context);
  return context.window.SiteRuntimeConfig;
}

const EXPECTED_SCRIPT_ASSETS = {
  whatsappLeadForm: ["teacher-flavius-whatsapp-lead-form", "/whatsapp_lead_form.js?v=20260902-direct-2"],
  siteWhatsapp: ["teacher-flavius-site-whatsapp", "/site_whatsapp.js?v=20260902-1"],
  accessibility: ["teacher-flavius-accessibility", "/accessibility.js?v=20260820-1"],
  cro: ["teacher-flavius-cro", "/cro.js?v=20260820-1"],
  analytics: ["teacher-flavius-analytics", "/analytics.js?v=20260820-1"],
  analyticsAttribution: ["teacher-flavius-analytics-attribution", "/analytics_attribution.js?v=20260902-leadfix-1"],
  privacyConsent: ["teacher-flavius-privacy-consent", "/privacy_consent.js?v=20260820-2"],
  sitePrivacyAnalytics: ["teacher-flavius-site-privacy-analytics", "/site_privacy_analytics.js?v=20260902-1"],
  sitePageRuntime: ["teacher-flavius-site-page-runtime", "/site_page_runtime.js?v=20260905-online-copy-1"],
  mobileTopNavigation: ["teacher-flavius-mobile-top-navigation", "/mobile_top_navigation.js?v=20260820-desktop-menu-1"],
  footerCore: ["teacher-flavius-site-footer-core", "/site_footer_core.js?v=20260820-privacy-1"],
  cleanUrls: ["teacher-flavius-clean-urls", "/clean_urls.js?v=20260819-1"],
  googleOnlyAccess: ["teacher-flavius-google-only-access", "/google_only_access.js?v=20260819-1"],
  studentBirthdays: ["teacher-flavius-student-birthdays", "/student_birthdays.js?v=20260819-1"],
  sitePageContext: ["teacher-flavius-site-page-context", "/site_page_context.js?v=20260902-1"],
  siteBranding: ["teacher-flavius-site-branding", "/site_branding.js?v=20260902-1"],
  siteEnrollmentGuard: ["teacher-flavius-site-enrollment-guard", "/site_enrollment_guard.js?v=20260902-1"],
  marketingTrackingControl: ["teacher-flavius-marketing-tracking-control", "/marketing_tracking_control.js?v=20260904-1"],
  marketingWhatsappTracker: ["teacher-flavius-marketing-whatsapp-tracker", "/marketing_whatsapp_tracker.js?v=20260904-1"]
};

test("preserves measurement id and public script timeout", function () {
  const config = loadConfig();
  assert.equal(config.googleMeasurementId, "G-11V3W5B6TG");
  assert.equal(config.publicScriptsIdleTimeoutMs, 1200);
});

test("preserves every script asset id and source", function () {
  const config = loadConfig();
  assert.deepEqual(Object.keys(config.scriptAssets), Object.keys(EXPECTED_SCRIPT_ASSETS));

  Object.entries(EXPECTED_SCRIPT_ASSETS).forEach(function ([name, expected]) {
    assert.equal(config.scriptAssets[name].id, expected[0]);
    assert.equal(config.scriptAssets[name].src, expected[1]);
  });
});

test("preserves stylesheet and privacy analytics asset contracts", function () {
  const config = loadConfig();
  assert.equal(config.stylesheetAssets.accessibility.id, "teacher-flavius-accessibility-styles");
  assert.equal(config.stylesheetAssets.accessibility.href, "/accessibility.css?v=20260820-1");
  assert.equal(config.privacyAnalyticsAssets.privacyConsent, config.scriptAssets.privacyConsent);
  assert.equal(config.privacyAnalyticsAssets.analyticsAttribution, config.scriptAssets.analyticsAttribution);
  assert.equal(config.privacyAnalyticsAssets.analytics, config.scriptAssets.analytics);
  assert.equal(config.privacyAnalyticsAssets.cro, config.scriptAssets.cro);
});

test("exposes deeply frozen runtime configuration", function () {
  const config = loadConfig();
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.scriptAssets), true);
  assert.equal(Object.isFrozen(config.stylesheetAssets), true);
  assert.equal(Object.isFrozen(config.privacyAnalyticsAssets), true);
  Object.values(config.scriptAssets).forEach(function (asset) {
    assert.equal(Object.isFrozen(asset), true);
  });
  Object.values(config.stylesheetAssets).forEach(function (asset) {
    assert.equal(Object.isFrozen(asset), true);
  });
});
