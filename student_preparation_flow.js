(function () {
  "use strict";

  // Stage 6 preview only. Never enable the public production hostname.
  const PREVIEW_HOSTNAME =
    "stage6-student-preparation-preview-teacherflavius.handinhandengl.workers.dev";
  const hostname = String(window.location && window.location.hostname || "").toLowerCase();
  const enabled = hostname === PREVIEW_HOSTNAME;
  const secondPartUrl = "/o-que-fazer/segunda-parte/";

  window.StudentPreparationFlow = Object.freeze({
    enabled: enabled,
    secondPartUrl: secondPartUrl
  });
})();
