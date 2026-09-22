const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ACQUISITION_SESSION_KEY = "tf_acquisition_session_v1";

function createStorage(values) {
  const data = new Map(Object.entries(values || {}));
  return {
    getItem: function (key) { return data.has(key) ? data.get(key) : null; },
    setItem: function (key, value) { data.set(key, String(value)); }
  };
}

function runTracker(options) {
  const settings = options || {};
  const source = fs.readFileSync(path.join(__dirname, "..", "marketing_whatsapp_tracker.js"), "utf8");
  const sessionStorage = settings.sessionStorage || createStorage();
  const localStorage = settings.localStorage || createStorage();
  const sentPayloads = [];
  let clickHandler = null;

  const location = {
    pathname: settings.pathname || "/",
    search: settings.search || "",
    hostname: "teacherflavius.com",
    href: "https://teacherflavius.com" + (settings.pathname || "/") + (settings.search || "")
  };

  const windowRef = {
    location: location,
    sessionStorage: sessionStorage,
    localStorage: localStorage,
    fetch: function (_url, request) {
      sentPayloads.push(JSON.parse(request.body));
      return Promise.resolve({ ok: true });
    }
  };
  if (settings.teacherCroAttribution) windowRef.TeacherCroAttribution = settings.teacherCroAttribution;

  const documentRef = {
    referrer: settings.referrer || "",
    addEventListener: function (eventName, handler) {
      if (eventName === "click") clickHandler = handler;
    }
  };

  const context = {
    window: windowRef,
    document: documentRef,
    navigator: { sendBeacon: function () { return false; } },
    URL: URL,
    URLSearchParams: URLSearchParams,
    Uint8Array: Uint8Array,
    Date: Date,
    Math: Math,
    JSON: JSON
  };

  vm.runInNewContext(source, context);

  function clickLink(linkOptions) {
    const linkSettings = linkOptions || {};
    const containers = new Set(linkSettings.containers || []);
    const link = {
      id: linkSettings.id || "",
      textContent: linkSettings.textContent || "",
      getAttribute: function (name) {
        if (name === "href") return linkSettings.href || "#";
        if (name === "data-marketing-cta") return linkSettings.marketingCta || "";
        if (name === "data-commercial-lead") return linkSettings.commercialLead || "";
        if (name === "aria-label") return linkSettings.ariaLabel || "";
        return "";
      },
      closest: function (selector) {
        if (selector === "a[href]") return link;
        return containers.has(selector) ? {} : null;
      }
    };
    clickHandler({ target: link });
  }

  return {
    sessionStorage: sessionStorage,
    sentPayloads: sentPayloads,
    clickLink: clickLink,
    clickWhatsapp: function () {
      clickLink({ href: "https://wa.me/5511999999999" });
    }
  };
}

test("preserves ChatGPT acquisition across internal navigation before WhatsApp lead", async function () {
  const sessionStorage = createStorage();

  runTracker({
    pathname: "/recursos/como-escolher-curso-de-ingles-online/",
    referrer: "https://chatgpt.com/",
    sessionStorage: sessionStorage
  });

  const capturedEntry = JSON.parse(sessionStorage.getItem(ACQUISITION_SESSION_KEY));
  assert.equal(capturedEntry.source, "chatgpt");
  assert.equal(capturedEntry.ai_assistant, "chatgpt");
  assert.equal(capturedEntry.traffic_channel, "ai_assistant");
  assert.equal(capturedEntry.landing_page, "/recursos/como-escolher-curso-de-ingles-online/");

  const secondPage = runTracker({
    pathname: "/curso-de-ingles-online/",
    referrer: "https://teacherflavius.com/recursos/como-escolher-curso-de-ingles-online/",
    sessionStorage: sessionStorage
  });

  secondPage.clickWhatsapp();
  await Promise.resolve();

  assert.equal(secondPage.sentPayloads.length, 1);
  const lead = secondPage.sentPayloads[0];
  assert.equal(lead.event_name, "generate_lead");
  assert.equal(lead.source, "chatgpt");
  assert.equal(lead.ai_assistant, "chatgpt");
  assert.equal(lead.traffic_channel, "ai_assistant");
  assert.equal(lead.landing_page, "/recursos/como-escolher-curso-de-ingles-online/");
  assert.equal(lead.page_path, "/curso-de-ingles-online/");
});

test("captures ChatGPT UTM on page entry even without an external referrer", function () {
  const sessionStorage = createStorage();

  runTracker({
    pathname: "/curso-de-ingles-online/",
    search: "?utm_source=chatgpt.com&utm_medium=referral",
    sessionStorage: sessionStorage
  });

  const capturedEntry = JSON.parse(sessionStorage.getItem(ACQUISITION_SESSION_KEY));
  assert.equal(capturedEntry.source, "chatgpt");
  assert.equal(capturedEntry.medium, "referral");
  assert.equal(capturedEntry.ai_assistant, "chatgpt");
  assert.equal(capturedEntry.landing_page, "/curso-de-ingles-online/");
});


test("tracks a non-WhatsApp CTA on the individual lessons page without creating a lead", function () {
  const tracker = runTracker({ pathname: "/aulas-individuais/" });

  tracker.clickLink({
    href: "#como-funciona",
    marketingCta: "individual_hero_details",
    containers: [".hero"]
  });

  assert.equal(tracker.sentPayloads.length, 1);
  assert.equal(tracker.sentPayloads[0].event_name, "cta_click");
  assert.equal(tracker.sentPayloads[0].link_position, "individual_hero_details");
  assert.equal(tracker.sentPayloads[0].page_path, "/aulas-individuais/");
});

test("tracks an individual lessons WhatsApp CTA separately from the commercial lead", function () {
  const tracker = runTracker({ pathname: "/aulas-individuais/" });

  tracker.clickLink({
    href: "https://wa.me/5511999999999",
    marketingCta: "individual_hero_whatsapp",
    containers: [".hero"]
  });

  assert.equal(tracker.sentPayloads.length, 2);
  assert.equal(tracker.sentPayloads[0].event_name, "cta_click");
  assert.equal(tracker.sentPayloads[0].link_position, "individual_hero_whatsapp");
  assert.equal(tracker.sentPayloads[1].event_name, "generate_lead");
  assert.equal(tracker.sentPayloads[1].link_position, "hero");
});

test("tracks the dynamically injected WhatsApp button on the individual lessons page", function () {
  const tracker = runTracker({ pathname: "/aulas-individuais/" });

  tracker.clickLink({
    id: "teacher-flavius-whatsapp-float",
    href: "https://wa.me/5511999999999"
  });

  assert.equal(tracker.sentPayloads.length, 2);
  assert.equal(tracker.sentPayloads[0].event_name, "cta_click");
  assert.equal(tracker.sentPayloads[0].link_position, "individual_floating_whatsapp");
  assert.equal(tracker.sentPayloads[1].event_name, "generate_lead");
  assert.equal(tracker.sentPayloads[1].link_position, "floating_button");
});

test("does not track individual CTA clicks on other pages", function () {
  const tracker = runTracker({ pathname: "/aulas-em-grupo/" });

  tracker.clickLink({
    href: "#como-funciona",
    marketingCta: "individual_hero_details",
    containers: [".hero"]
  });

  assert.equal(tracker.sentPayloads.length, 0);
});

test("keeps CTA monitoring active when consent analytics owns WhatsApp lead tracking", function () {
  const tracker = runTracker({
    pathname: "/aulas-individuais/",
    teacherCroAttribution: {}
  });

  tracker.clickLink({
    href: "https://wa.me/5511999999999",
    marketingCta: "individual_final_whatsapp",
    containers: [".final-cta"]
  });

  assert.equal(tracker.sentPayloads.length, 1);
  assert.equal(tracker.sentPayloads[0].event_name, "cta_click");
  assert.equal(tracker.sentPayloads[0].link_position, "individual_final_whatsapp");
});


test("ebook CTA never creates a commercial lead even if its destination becomes WhatsApp", function () {
  const tracker = runTracker({ pathname: "/aulas-individuais/" });

  tracker.clickLink({
    href: "https://wa.me/5511999999999",
    marketingCta: "individual_ebook",
    commercialLead: "false"
  });

  assert.equal(tracker.sentPayloads.length, 1);
  assert.equal(tracker.sentPayloads[0].event_name, "cta_click");
  assert.equal(tracker.sentPayloads[0].link_position, "individual_ebook");
});
