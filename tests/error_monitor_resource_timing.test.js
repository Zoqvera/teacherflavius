"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const monitorSource = fs.readFileSync(
  path.join(__dirname, "..", "error_monitor.js"),
  "utf8"
);

function createResourceMonitor(resourceUrl, responseStatus, options = {}) {
  const reports = [];
  const listeners = new Map();
  const location = {
    href: "https://teacherflavius.com/o-que-fazer/",
    origin: "https://teacherflavius.com",
    pathname: "/o-que-fazer/"
  };
  const timingRequests = [];
  const performanceRef = {
    now: () => 0,
    getEntriesByName: (url, type) => {
      timingRequests.push({ url, type });
      return options.noTimingEntries ? [] : [{ responseStatus }];
    }
  };
  if (options.noPerformanceApi) {
    delete performanceRef.getEntriesByName;
  }

  const windowRef = {
    location,
    navigator: { onLine: true },
    performance: performanceRef,
    fetch: async (_url, init) => {
      reports.push(JSON.parse(init.body));
      return { status: 204 };
    },
    addEventListener: (type, handler) => listeners.set(type, handler)
  };
  const documentRef = {
    currentScript: { dataset: {} },
    readyState: "loading",
    addEventListener: () => {}
  };

  vm.runInNewContext(monitorSource, {
    window: windowRef,
    document: documentRef,
    navigator: windowRef.navigator,
    performance: performanceRef,
    URL,
    Error,
    ErrorEvent: class ErrorEvent {},
    Date,
    Map,
    MutationObserver: class MutationObserver {},
    console
  });

  listeners.get("error")({
    target: {
      tagName: resourceUrl.endsWith(".css") ? "LINK" : "SCRIPT",
      src: resourceUrl.endsWith(".css") ? "" : resourceUrl,
      href: resourceUrl.endsWith(".css") ? resourceUrl : ""
    }
  });

  return { reports, timingRequests };
}

test("captures same-origin resource HTTP status without a second network request", () => {
  const resource = "https://teacherflavius.com/animated_cards.js?v=20261104-1";
  const { reports, timingRequests } = createResourceMonitor(resource, 404);

  assert.equal(reports.length, 1);
  assert.equal(reports[0].event_type, "resource");
  assert.equal(reports[0].source, "https://teacherflavius.com/animated_cards.js");
  assert.equal(reports[0].http_status, 404);
  assert.equal(reports[0].metadata.phase, "resource_http_status");
  assert.equal(reports[0].metadata.resource_tag, "script");
  assert.deepEqual(timingRequests, [{ url: resource, type: "resource" }]);
});

test("records load errors even when Resource Timing provides no HTTP status", () => {
  const url = "https://teacherflavius.com/animated_cards.js";
  for (const options of [{ noPerformanceApi: true }, { noTimingEntries: true }]) {
    const { reports } = createResourceMonitor(url, undefined, options);
    assert.equal(reports.length, 1);
    assert.equal(reports[0].event_type, "resource");
    assert.equal(reports[0].http_status, null);
    assert.equal(reports[0].metadata.phase, "resource_load_error");
  }
});

test("does not infer status from cross-origin timing entries", () => {
  const { reports, timingRequests } = createResourceMonitor(
    "https://bzrcdn.openai.com/sdk/oaiq.min.js", 500
  );
  assert.equal(reports.length, 1);
  assert.equal(reports[0].http_status, null);
  assert.equal(reports[0].metadata.phase, "resource_load_error");
  assert.equal(timingRequests.length, 0);
});

test("records CSS status and treats unknown responseStatus 0 as unknown", () => {
  const url = "https://teacherflavius.com/course_tools.css";
  const { reports } = createResourceMonitor(url, 0);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].http_status, null);
  assert.equal(reports[0].metadata.resource_tag, "link");
});

test("records HTTP 200 even when the browser rejected the resource", () => {
  const { reports } = createResourceMonitor(
    "https://teacherflavius.com/student_access_tracker.js", 200
  );
  assert.equal(reports[0].http_status, 200);
  assert.equal(reports[0].metadata.phase, "resource_http_status");
});

function createAuthMonitorHarness(clock, storage) {
  const reports = [];
  const windowRef = {
    location: {
      href: "https://teacherflavius.com/area-do-estudante/minhas-aulas/",
      origin: "https://teacherflavius.com",
      pathname: "/area-do-estudante/minhas-aulas/"
    },
    sessionStorage: storage,
    navigator: { onLine: true },
    performance: { now: () => 0 },
    fetch: async (_url, options) => {
      reports.push(JSON.parse(options.body));
      return { status: 204 };
    },
    addEventListener: () => {}
  };
  const documentRef = {
    currentScript: { dataset: {} },
    readyState: "loading",
    addEventListener: () => {}
  };
  class ClockDate extends Date {
    static now() { return clock.now; }
  }
  vm.runInNewContext(monitorSource, {
    window: windowRef,
    document: documentRef,
    navigator: windowRef.navigator,
    performance: windowRef.performance,
    URL,
    Error,
    ErrorEvent: class ErrorEvent {},
    Date: ClockDate,
    Map,
    MutationObserver: class MutationObserver {},
    console
  });
  return { reports, capture: windowRef.TeacherFlaviusErrorMonitor.capture };
}

function createTabStorage() {
  const entries = new Map();
  return {
    getItem: (key) => entries.has(key) ? entries.get(key) : null,
    setItem: (key, value) => entries.set(key, String(value))
  };
}

const expiredJwtEvent = {
  event_type: "auth",
  error_code: "bad_jwt",
  http_status: 403,
  message: "token has invalid claims: token is expired",
  source: "https://wnigzpvgsbpjdxvjzugt.supabase.co/auth/v1/user"
};

test("deduplicates a single tab's repeated expired JWTs for fifteen minutes, including reloads", () => {
  const clock = { now: 1000000 };
  const storage = createTabStorage();
  const initial = createAuthMonitorHarness(clock, storage);
  initial.capture(expiredJwtEvent);
  clock.now += 60 * 1000;
  initial.capture(expiredJwtEvent);
  assert.equal(initial.reports.length, 1);

  const reloaded = createAuthMonitorHarness(clock, storage);
  reloaded.capture(expiredJwtEvent);
  assert.equal(reloaded.reports.length, 0);

  clock.now += 15 * 60 * 1000;
  reloaded.capture(expiredJwtEvent);
  assert.equal(reloaded.reports.length, 1);
});

test("preserves reports from different tabs and unrelated authentication errors", () => {
  const clock = { now: 1000000 };
  const first = createAuthMonitorHarness(clock, createTabStorage());
  const second = createAuthMonitorHarness(clock, createTabStorage());
  first.capture(expiredJwtEvent);
  second.capture(expiredJwtEvent);
  assert.equal(first.reports.length, 1);
  assert.equal(second.reports.length, 1);

  clock.now += 31 * 1000;
  const otherError = {
    event_type: "auth",
    error_code: "invalid_credentials",
    http_status: 400,
    message: "Invalid login credentials",
    source: "https://wnigzpvgsbpjdxvjzugt.supabase.co/auth/v1/token"
  };
  first.capture(otherError);
  clock.now += 31 * 1000;
  first.capture(otherError);
  assert.equal(first.reports.length, 3);
});

test("the student lesson page verifies identity and gives a recovery path", () => {
  const page = fs.readFileSync(
    path.join(__dirname, "..", "area-do-estudante/minhas-aulas/app.js"), "utf8"
  );
  assert.match(page, /Auth\.getVerifiedSession\(\)/);
  assert.match(page, /data e hora automáticas/);
  assert.match(page, /TENTAR NOVAMENTE/);
  assert.match(page, /ENTRAR NOVAMENTE/);
});

