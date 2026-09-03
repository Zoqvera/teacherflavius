const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SCRIPT_NAMES = [
  "sitePageContext",
  "siteBranding",
  "siteEnrollmentGuard",
  "accessibility",
  "mobileTopNavigation",
  "siteWhatsapp",
  "footerCore",
  "cleanUrls",
  "googleOnlyAccess",
  "studentBirthdays"
];

function createAssets() {
  return Object.fromEntries(
    SCRIPT_NAMES.map(function (name) {
      return [name, Object.freeze({ id: name, src: "/" + name + ".js" })];
    })
  );
}

function createRuntime(options) {
  const settings = options || {};
  const source = fs.readFileSync(
    path.join(__dirname, "..", "site_page_runtime.js"),
    "utf8"
  );
  const scriptCalls = [];
  const stylesheetCalls = [];
  const events = {
    branding: 0,
    enrollment: [],
    whatsapp: [],
    removedLinks: 0,
    standardizedLinks: 0,
    idleTimeouts: []
  };
  const scriptAssets = createAssets();
  const runtimeConfig = {
    publicScriptsIdleTimeoutMs: 1200,
    scriptAssets: scriptAssets,
    stylesheetAssets: {
      accessibility: Object.freeze({ id: "accessibilityStyles", href: "/accessibility.css" })
    }
  };
  const pageContext = {
    currentPath: function () {
      return settings.path || "/";
    },
    isGeoContentPage: function () {
      return settings.geo === true;
    },
    isHomePage: function () {
      return settings.home === true;
    },
    isPublicMarketingPage: function () {
      return settings.publicPage === true;
    }
  };
  const windowRef = {
    SitePageContext: pageContext,
    SiteBranding: {
      install: function () {
        events.branding += 1;
      }
    },
    SiteEnrollmentGuard: {
      initialize: function (config) {
        events.enrollment.push(config.watchDynamicLinks);
      },
      removeLinks: function () {
        events.removedLinks += 1;
      }
    },
    SiteWhatsapp: {
      initialize: function (config) {
        events.whatsapp.push(config.watchDynamicLinks);
      },
      standardizeLinks: function () {
        events.standardizedLinks += 1;
      }
    },
    setTimeout: function (callback) {
      callback();
    }
  };
  if (settings.useIdleCallback !== false) {
    windowRef.requestIdleCallback = function (callback, config) {
      events.idleTimeouts.push(config.timeout);
      callback();
    };
  }
  const documentRef = {
    readyState: "complete",
    addEventListener: function () {}
  };
  const context = { window: {} };

  vm.runInNewContext(source, context);
  const runtime = context.window.SitePageRuntime.create({
    runtimeConfig: runtimeConfig,
    loadScriptAsset: function (asset, callback) {
      scriptCalls.push(asset.id);
      if (callback) callback();
    },
    loadStylesheetAsset: function (asset) {
      stylesheetCalls.push(asset.id);
    },
    windowRef: windowRef,
    documentRef: documentRef
  });

  runtime.initialize();
  return {
    scriptCalls: scriptCalls,
    stylesheetCalls: stylesheetCalls,
    events: events
  };
}

test("loads public home runtime without clean URL script", function () {
  const result = createRuntime({
    path: "/",
    home: true,
    publicPage: true
  });

  assert.deepEqual(result.scriptCalls, [
    "sitePageContext",
    "siteBranding",
    "siteEnrollmentGuard",
    "accessibility",
    "siteWhatsapp",
    "footerCore"
  ]);
  assert.deepEqual(result.stylesheetCalls, ["accessibilityStyles"]);
  assert.deepEqual(result.events.idleTimeouts, [1200]);
  assert.deepEqual(result.events.enrollment, [false]);
  assert.deepEqual(result.events.whatsapp, [false]);
  assert.equal(result.events.removedLinks, 1);
  assert.equal(result.events.standardizedLinks, 1);
});

test("loads clean URLs before footer on regular public pages", function () {
  const result = createRuntime({
    path: "/curso/",
    publicPage: true
  });

  assert.deepEqual(result.scriptCalls.slice(-2), ["cleanUrls", "footerCore"]);
  assert.equal(result.scriptCalls.includes("mobileTopNavigation"), true);
  assert.equal(result.scriptCalls.includes("googleOnlyAccess"), false);
});

test("loads only clean URLs after UI foundations on geo pages", function () {
  const result = createRuntime({
    path: "/ingles-em-ribeirao-preto/",
    publicPage: true,
    geo: true
  });

  assert.equal(result.scriptCalls.includes("cleanUrls"), true);
  assert.equal(result.scriptCalls.includes("footerCore"), false);
  assert.equal(result.scriptCalls.includes("googleOnlyAccess"), false);
});

test("loads portal chain in the original order", function () {
  const result = createRuntime({
    path: "/area-do-estudante/",
    publicPage: false
  });

  assert.deepEqual(result.scriptCalls.slice(-4), [
    "cleanUrls",
    "googleOnlyAccess",
    "studentBirthdays",
    "footerCore"
  ]);
  assert.deepEqual(result.events.enrollment, [true]);
  assert.deepEqual(result.events.whatsapp, [true]);
  assert.deepEqual(result.events.idleTimeouts, []);
});
