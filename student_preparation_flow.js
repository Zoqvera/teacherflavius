(function () {
  "use strict";

  // Stage 6 preview only. Never enable the public production hostname.
  const PREVIEW_HOSTNAME =
    "stage6-student-preparation-preview-teacherflavius.handinhandengl.workers.dev";
  const hostname = String(window.location && window.location.hostname || "").toLowerCase();
  const enabled = hostname === PREVIEW_HOSTNAME;
  const secondPartUrl = "/o-que-fazer/segunda-parte/";

  // Search engines must not index any preparation pages on the preview host.
  if (enabled && window.document && window.document.head) {
    let robots = window.document.querySelector('meta[name="robots"]');
    if (!robots) {
      robots = window.document.createElement("meta");
      robots.name = "robots";
      window.document.head.appendChild(robots);
    }
    robots.content = "noindex,nofollow";
  }

  window.StudentPreparationFlow = Object.freeze({
    enabled: enabled,
    secondPartUrl: secondPartUrl
  });
})();
