(function () {
  "use strict";

  // Safe rollout: editing this default is a separate deployment decision.
  const enabled = false;
  const secondPartUrl = "/o-que-fazer/segunda-parte/";

  window.StudentPreparationFlow = Object.freeze({
    enabled: enabled,
    secondPartUrl: secondPartUrl
  });
})();
