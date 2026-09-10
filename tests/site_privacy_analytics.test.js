const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const MEASUREMENT_ID = "G-11V3W5B6TG";

function createAssets() {
  return {
    privacyConsent: { name: "privacy" },
    analyticsAttribution: { name: "attribution" },
    analytics: { name: "analytics" },
    cro: { name: "cro" }
  };
}

function loadModule(options) {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "site_privacy_analytics.js"),
    "utf8"
  );
  const events = {};
  const gtagCalls = [];
  const window = {
    TeacherFlaviusPrivacy: options && options.privacy,
    addEventListener: function (name, callback) {
      events[name] = callback;
    },
    gtag: function () {
      gtagCalls.push(Array.from(arguments));
    }
  };
  const context = { window: window };

  vm.runInNewContext(source, context);
  return {
    api: window.SitePrivacyAnalytics,
    events: events,
    gtagCalls: gtagCalls,
    window: window
  };
}

function initialize(runtime, consentCallback) {
  const calls = [];
  const assets = createAssets();

  runtime.api.initialize({
    measurementId: MEASUREMENT_ID,
    assets: assets,
    loadScriptAsset: function (asset, callback) {
      calls.push(asset.name);
      if (callback && (!consentCallback || consentCallback(asset))) callback();
    }
  });

  return calls;
}

test("denies analytics when consent is unavailable", function () {
  const runtime = loadModule();
  const calls = initialize(runtime);

  assert.deepEqual(calls, ["privacy"]);
  assert.equal(runtime.window["ga-disable-" + MEASUREMENT_ID], true);
  assert.equal(runtime.gtagCalls.length, 1);
  assert.equal(runtime.gtagCalls[0][0], "consent");
  assert.equal(runtime.gtagCalls[0][1], "update");
  assert.equal(runtime.gtagCalls[0][2].analytics_storage, "denied");
  assert.equal(runtime.gtagCalls[0][2].ad_storage, "denied");
});

test("loads analytics in the preserved sequence when consent is granted", function () {
  const runtime = loadModule({
    privacy: {
      hasAnalyticsConsent: function () { return true; }
    }
  });
  const calls = initialize(runtime);

  assert.deepEqual(calls, ["privacy", "attribution", "analytics", "cro"]);
  assert.equal(runtime.window["ga-disable-" + MEASUREMENT_ID], false);
  assert.equal(runtime.gtagCalls.length, 0);
});

test("reacts to later privacy consent changes", function () {
  const runtime = loadModule({
    privacy: {
      hasAnalyticsConsent: function () { return false; }
    }
  });
  const calls = initialize(runtime, function (asset) {
    return asset.name !== "privacy";
  });

  assert.equal(typeof runtime.events["tf:privacy-consent-changed"], "function");
  runtime.window.TeacherFlaviusPrivacy.hasAnalyticsConsent = function () { return true; };
  runtime.events["tf:privacy-consent-changed"]();

  assert.deepEqual(calls, ["privacy", "attribution", "analytics", "cro"]);
  assert.equal(runtime.window["ga-disable-" + MEASUREMENT_ID], false);
});
