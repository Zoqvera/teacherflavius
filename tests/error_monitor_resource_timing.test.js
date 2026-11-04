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
