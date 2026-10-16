(function () {
  "use strict";

  const PREVIEW_HOSTNAME =
    "stage6-student-preparation-preview-teacherflavius.handinhandengl.workers.dev";
  const PRODUCTION_HOSTNAMES = Object.freeze(["teacherflavius.com", "www.teacherflavius.com"]);

  // Stage 10: all actively enrolled, non-archived students are eligible.
  // RLS restricts profile reads to the authenticated identity.
  // The database master switch remains the immediate operational kill switch.
  const PRODUCTION_PILOT_ARMED = true;
  const hostname = String(window.location && window.location.hostname || "").toLowerCase();
  const isPreview = hostname === PREVIEW_HOSTNAME;
  let enabled = isPreview;
  let resolution = null;
  let resolvedUserId = null;
  const secondPartUrl = "/o-que-fazer/segunda-parte/";

  if (isPreview && window.document && window.document.head) {
    let robots = window.document.querySelector('meta[name="robots"]');
    if (!robots) {
      robots = window.document.createElement("meta");
      robots.name = "robots";
      window.document.head.appendChild(robots);
    }
    robots.content = "noindex,nofollow";
  }

  async function readActiveStudentEligibility(client, userId) {
    if (!client || !userId || !PRODUCTION_HOSTNAMES.includes(hostname) ||
        !PRODUCTION_PILOT_ARMED) {
      return false;
    }

    const settings = await client
      .from("student_preparation_pilot_settings")
      .select("enabled")
      .eq("id", true)
      .maybeSingle();

    if (settings.error || !settings.data || settings.data.enabled !== true) {
      return false;
    }

    const profile = await client
      .from("profiles")
      .select("enrolled,archived")
      .eq("id", userId)
      .maybeSingle();

    return !profile.error && !!profile.data &&
      profile.data.enrolled === true && profile.data.archived === false;
  }

  async function resolveEligibility(client, userId) {
    if (isPreview) return true;
    if (!PRODUCTION_PILOT_ARMED || !PRODUCTION_HOSTNAMES.includes(hostname) ||
        !client || !userId) {
      enabled = false;
      resolvedUserId = null;
      resolution = null;
      return false;
    }

    if (resolvedUserId !== userId) {
      enabled = false;
      resolvedUserId = userId;
      resolution = readActiveStudentEligibility(client, userId)
        .catch(function (error) {
          console.error("Falha ao verificar elegibilidade da preparação:", error);
          return false;
        })
        .then(function (allowed) {
          // A previous account's asynchronous response must not unlock a new session.
          if (resolvedUserId !== userId) return false;
          enabled = allowed === true;
          return enabled;
        });
    }

    return resolution;
  }

  const TRACKED_EVENTS = Object.freeze([
    "preparation_welcome_view",
    "preparation_lesson_view",
    "preparation_next_part",
    "preparation_conversation_view",
    "preparation_roadmap_view",
    "preparation_next_lesson"
  ]);

  function track(eventName) {
    const privacy = window.TeacherFlaviusPrivacy;
    if (!enabled || !TRACKED_EVENTS.includes(eventName) ||
        !privacy || typeof privacy.hasAnalyticsConsent !== "function" ||
        !privacy.hasAnalyticsConsent() || typeof window.gtag !== "function") return;

    window.gtag("event", eventName, { event_category: "student_preparation" });
  }

  window.StudentPreparationFlow = Object.freeze({
    get enabled() { return enabled; },
    secondPartUrl: secondPartUrl,
    resolveEligibility: resolveEligibility,
    track: track
  });
})();
