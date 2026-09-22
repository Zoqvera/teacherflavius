const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("individual lessons page identifies every static marketing CTA", function () {
  const html = read("aulas-individuais/index.html");
  const expectedCtas = [
    "individual_hero_whatsapp",
    "individual_hero_details",
    "individual_ebook",
    "individual_instagram",
    "individual_availability_whatsapp",
    "individual_final_whatsapp"
  ];

  expectedCtas.forEach(function (ctaId) {
    assert.match(html, new RegExp('data-marketing-cta="' + ctaId + '"'));
  });

  const matches = html.match(/data-marketing-cta="/g) || [];
  assert.equal(matches.length, expectedCtas.length);
});

test("acquisition collector accepts CTA click events with link positions", function () {
  const source = read("supabase/functions/marketing-acquisition-event/index.ts");
  assert.match(source, /ALLOWED_EVENTS[^\n]+cta_click/);
  assert.match(source, /eventName === "generate_lead" \|\| eventName === "cta_click"/);
});

test("database migration exposes an MFA-protected individual CTA summary", function () {
  const sql = read("supabase/migrations/20260922024500_track_individual_lesson_cta_clicks.sql");
  assert.match(sql, /event_name in \('page_view', 'generate_lead', 'cta_click'\)/i);
  assert.match(sql, /function public\.get_teacher_individual_cta_summary\(period_days integer default 30\)/i);
  assert.match(sql, /if not public\.is_teacher_admin_mfa\(\) then/i);
  assert.match(sql, /revoke all on function public\.get_teacher_individual_cta_summary\(integer\) from public, anon, authenticated;/i);
});

test("conversion dashboard requests and renders the individual CTA summary", function () {
  const script = read("marketing_acquisition.js");
  const html = read("marketing_acquisition/index.html");

  assert.match(script, /get_teacher_individual_cta_summary/);
  assert.match(script, /renderIndividualCtas/);
  assert.match(html, /id="metricIndividualCtaClicks"/);
  assert.match(html, /id="individualCtaTableBody"/);
});


test("ebook CTA is explicitly excluded from commercial lead attribution", function () {
  const html = read("aulas-individuais/index.html");
  const tracker = read("marketing_whatsapp_tracker.js");
  const attribution = read("analytics_attribution.js");

  assert.match(
    html,
    /data-marketing-cta="individual_ebook"[^>]*data-commercial-lead="false"/
  );
  assert.match(tracker, /function isCommercialLeadLink\(link\)/);
  assert.match(tracker, /data-commercial-lead/);
  assert.match(attribution, /function isCommercialLeadTarget\(target\)/);
  assert.match(attribution, /data-commercial-lead/);
});
