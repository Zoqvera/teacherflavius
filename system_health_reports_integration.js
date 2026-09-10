(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) api.initialize({ windowRef: root, documentRef: root.document });
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const TAB_ID = "systemHealthReportTab";
  const FRAME_ID = "systemHealthFrame";
  const FRAME_SRC = "/saude-do-sistema/";

  function resizeFrame(frame, windowRef) {
    if (!frame || frame.hidden) return;
    try {
      const documentRef = frame.contentDocument;
      if (!documentRef || !documentRef.documentElement) return;
      const bodyHeight = documentRef.body ? documentRef.body.scrollHeight : 0;
      const documentHeight = documentRef.documentElement.scrollHeight || 0;
      const minimum = windowRef.innerWidth <= 720 ? 1350 : 1100;
      frame.style.height = Math.max(minimum, bodyHeight, documentHeight) + "px";
    } catch (_) {}
  }

  function activateHealthTab(documentRef, windowRef) {
    documentRef.querySelectorAll(".report-tab").forEach(function (tab) {
      const active = tab.id === TAB_ID;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
    documentRef.querySelectorAll(".report-frame").forEach(function (frame) {
      frame.hidden = frame.id !== FRAME_ID;
    });
    const frame = documentRef.getElementById(FRAME_ID);
    if (frame) windowRef.setTimeout(function () { resizeFrame(frame, windowRef); }, 30);
  }

  function bindLegacyTabs(documentRef) {
    documentRef.querySelectorAll(".report-tab:not(#" + TAB_ID + ")").forEach(function (tab) {
      if (tab.dataset.healthIntegrationBound) return;
      tab.dataset.healthIntegrationBound = "true";
      tab.addEventListener("click", function () {
        const frame = documentRef.getElementById(FRAME_ID);
        if (frame) frame.hidden = true;
      });
    });
  }

  function createTab(documentRef, windowRef) {
    const tabs = documentRef.querySelector(".report-tabs");
    const panel = documentRef.querySelector(".report-panel");
    if (!tabs || !panel || documentRef.getElementById(TAB_ID)) return false;

    const tab = documentRef.createElement("button");
    tab.id = TAB_ID;
    tab.className = "report-tab";
    tab.type = "button";
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", "false");
    tab.innerHTML = "<strong>Saúde do sistema</strong><span>Disponibilidade, erros, CSP, autenticação, jobs e alertas operacionais.</span>";

    const frame = documentRef.createElement("iframe");
    frame.id = FRAME_ID;
    frame.className = "report-frame";
    frame.src = FRAME_SRC;
    frame.title = "Saúde operacional do sistema";
    frame.hidden = true;
    frame.addEventListener("load", function () {
      resizeFrame(frame, windowRef);
      windowRef.setTimeout(function () { resizeFrame(frame, windowRef); }, 300);
      windowRef.setTimeout(function () { resizeFrame(frame, windowRef); }, 900);
    });

    tab.addEventListener("click", function () { activateHealthTab(documentRef, windowRef); });
    tabs.appendChild(tab);
    panel.appendChild(frame);
    bindLegacyTabs(documentRef);
    return true;
  }

  function initialize(dependencies) {
    const windowRef = dependencies && dependencies.windowRef;
    const documentRef = dependencies && dependencies.documentRef;
    if (!windowRef || !documentRef) return false;
    const created = createTab(documentRef, windowRef);
    if (!created) return false;
    windowRef.addEventListener("resize", function () {
      resizeFrame(documentRef.getElementById(FRAME_ID), windowRef);
    });
    return true;
  }

  return Object.freeze({
    TAB_ID: TAB_ID,
    FRAME_ID: FRAME_ID,
    FRAME_SRC: FRAME_SRC,
    createTab: createTab,
    activateHealthTab: activateHealthTab,
    initialize: initialize
  });
});
