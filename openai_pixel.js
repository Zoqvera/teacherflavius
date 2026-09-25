(function (window, document) {
  "use strict";

  const PIXEL_ID = "LaRJuEgBCtVnHSv4Ca4uur";
  const SDK_URL = "https://bzrcdn.openai.com/sdk/oaiq.min.js";

  if (window.oaiq) return;

  const queue = function () {
    queue.q.push(arguments);
  };
  queue.q = [];
  window.oaiq = queue;

  const sdk = document.createElement("script");
  sdk.async = true;
  sdk.src = SDK_URL;

  const firstScript = document.getElementsByTagName("script")[0];
  if (firstScript && firstScript.parentNode) {
    firstScript.parentNode.insertBefore(sdk, firstScript);
  } else {
    document.head.appendChild(sdk);
  }

  window.oaiq("init", {
    pixelId: PIXEL_ID,
    debug: true
  });
})(window, document);
