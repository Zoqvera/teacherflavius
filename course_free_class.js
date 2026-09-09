(function () {
  "use strict";

  const FRAME_ID = "courseFreeClassFrame";
  const TRIGGER_ID = "courseFreeClassTrigger";
  const EMBED_URL = "https://www.youtube-nocookie.com/embed/mZ2GyKKkteI?autoplay=1&rel=0";

  function createPlayer() {
    const iframe = document.createElement("iframe");
    iframe.src = EMBED_URL;
    iframe.title = "Aula gratuita do Teacher Flávio";
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.allowFullscreen = true;
    return iframe;
  }

  function initialize() {
    const frame = document.getElementById(FRAME_ID);
    const trigger = document.getElementById(TRIGGER_ID);
    if (!frame || !trigger) return;

    trigger.addEventListener("click", function () {
      frame.replaceChildren(createPlayer());
    }, { once: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
