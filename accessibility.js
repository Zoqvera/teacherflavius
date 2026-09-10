(function () {
  "use strict";

  if (window.__teacherFlaviusAccessibilityLoaded) return;
  window.__teacherFlaviusAccessibilityLoaded = true;

  var SKIP_LINK_ID = "tf-skip-link";
  var MAIN_ID = "tf-main-content";
  var refreshTimer = null;

  function currentPath() {
    return (window.location.pathname || "/").toLowerCase();
  }

  function isHomePage() {
    var path = currentPath();
    return path === "/" || path === "/index.html";
  }

  function isAuthPage() {
    var path = currentPath();
    return path === "/login" || path === "/login.html" || path === "/login/" ||
      path === "/complete-cadastro" || path === "/complete-cadastro.html" || path === "/complete-cadastro/";
  }

  function ensureLanguage() {
    if (!document.documentElement.getAttribute("lang")) {
      document.documentElement.setAttribute("lang", "pt-BR");
    }
  }

  function findMainLandmark() {
    var main = document.querySelector("main,[role='main']");
    if (!main && isAuthPage()) {
      main = document.querySelector(".box");
      if (main) main.setAttribute("role", "main");
    }
    return main;
  }

  function installSkipLink() {
    if (!document.body || document.getElementById(SKIP_LINK_ID)) return;
    var main = findMainLandmark();
    if (!main) return;

    if (!main.id) main.id = MAIN_ID;
    if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");

    var link = document.createElement("a");
    link.id = SKIP_LINK_ID;
    link.className = "tf-skip-link";
    link.href = "#" + main.id;
    link.textContent = "Pular para o conteúdo principal";
    document.body.insertBefore(link, document.body.firstChild);
  }

  function addRootClasses() {
    document.documentElement.classList.add("tf-a11y");
    if (isAuthPage()) document.documentElement.classList.add("tf-a11y-auth-page");
  }

  function enhanceLiveRegions() {
    var alertIds = ["message", "loginError", "linkAccountError"];
    alertIds.forEach(function (id) {
      var node = document.getElementById(id);
      if (!node) return;
      node.setAttribute("role", "alert");
      node.setAttribute("aria-live", "assertive");
      node.setAttribute("aria-atomic", "true");
    });

    var statusIds = ["loginNotice", "paymentPageMessage", "paymentBrickLoading"];
    statusIds.forEach(function (id) {
      var node = document.getElementById(id);
      if (!node) return;
      if (!node.hasAttribute("role")) node.setAttribute("role", "status");
      node.setAttribute("aria-live", "polite");
      node.setAttribute("aria-atomic", "true");
    });
  }

  function appendDescription(controlId, noteSelector, noteId) {
    var control = document.getElementById(controlId);
    if (!control) return;
    var note = control.parentElement && control.parentElement.querySelector(noteSelector);
    if (!note) {
      var sibling = control.nextElementSibling;
      if (sibling && sibling.matches(noteSelector)) note = sibling;
    }
    if (!note) return;
    if (!note.id) note.id = noteId;

    var describedBy = (control.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
    if (!describedBy.includes(note.id)) describedBy.push(note.id);
    control.setAttribute("aria-describedby", describedBy.join(" "));
  }

  function enhanceFieldNotes() {
    appendDescription("birthDate", ".field-note", "birthDateHelp");
    appendDescription("pixKey", ".field-note", "pixKeyHelp");
  }

  function enhanceAvailabilityGrid() {
    var grid = document.getElementById("availabilityGrid");
    if (!grid) return;
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-label", "Disponibilidade semanal para aulas");

    grid.querySelectorAll('input[name="availability"]').forEach(function (input) {
      var label = input.closest("label");
      var title = label && label.getAttribute("title");
      if (title) input.setAttribute("aria-label", "Disponibilidade: " + title.replace(" - ", " às "));
      var visualBox = input.nextElementSibling;
      if (visualBox && visualBox.classList.contains("slot-box")) visualBox.setAttribute("aria-hidden", "true");
    });
  }

  function enhanceCurrentNavigation() {
    var path = currentPath().replace(/\/$/, "") || "/";
    document.querySelectorAll("nav a[href]").forEach(function (link) {
      if (link.hasAttribute("aria-current")) return;
      try {
        var url = new URL(link.getAttribute("href"), window.location.href);
        if (url.origin !== window.location.origin) return;
        var linkPath = url.pathname.toLowerCase().replace(/\/$/, "") || "/";
        if (linkPath === path) link.setAttribute("aria-current", "page");
      } catch (error) {
        /* Ignore malformed links. */
      }
    });
  }

  function enhanceUntitledControls() {
    document.querySelectorAll("button,[role='button']").forEach(function (control) {
      var text = String(control.textContent || "").replace(/\s+/g, " ").trim();
      if (text || control.getAttribute("aria-label") || control.getAttribute("aria-labelledby")) return;
      var title = control.getAttribute("title");
      if (title) control.setAttribute("aria-label", title);
    });
  }

  function auditImageAlternatives() {
    document.querySelectorAll("img:not([alt])").forEach(function (image) {
      if (image.getAttribute("aria-hidden") === "true" || image.getAttribute("role") === "presentation") {
        image.setAttribute("alt", "");
        return;
      }
      image.setAttribute("data-tf-a11y-missing-alt", "true");
    });
  }

  function isElementVisible(node) {
    if (!node || node.hidden) return false;
    if (node.getAttribute("aria-hidden") === "true") return false;
    var style = window.getComputedStyle(node);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function activeModal() {
    var dialogs = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]'));
    return dialogs.find(function (dialog) {
      if (!isElementVisible(dialog)) return false;
      var hiddenAncestor = dialog.closest('[aria-hidden="true"],[hidden]');
      return !hiddenAncestor || hiddenAncestor === dialog;
    }) || null;
  }

  function focusableElements(root) {
    if (!root) return [];
    var selector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled]):not([type="hidden"])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])'
    ].join(",");
    return Array.from(root.querySelectorAll(selector)).filter(function (node) {
      return isElementVisible(node) && !node.closest("[inert]");
    });
  }

  function trapModalFocus(event) {
    if (event.key !== "Tab") return;
    var dialog = activeModal();
    if (!dialog) return;
    var focusable = focusableElements(dialog);
    if (!focusable.length) {
      event.preventDefault();
      if (!dialog.hasAttribute("tabindex")) dialog.setAttribute("tabindex", "-1");
      dialog.focus();
      return;
    }

    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    var active = document.activeElement;

    if (!dialog.contains(active)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function enhanceAll() {
    ensureLanguage();
    addRootClasses();
    installSkipLink();
    enhanceLiveRegions();
    enhanceFieldNotes();
    enhanceAvailabilityGrid();
    enhanceCurrentNavigation();
    enhanceUntitledControls();
    auditImageAlternatives();
  }

  function scheduleRefresh() {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(enhanceAll, 80);
  }

  function installObserver() {
    if (!document.documentElement || isHomePage()) return;
    var observer = new MutationObserver(function (mutations) {
      var relevant = mutations.some(function (mutation) {
        return mutation.type === "childList" && (mutation.addedNodes.length || mutation.removedNodes.length);
      });
      if (relevant) scheduleRefresh();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  document.addEventListener("keydown", trapModalFocus, true);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      enhanceAll();
      installObserver();
    }, { once: true });
  } else {
    enhanceAll();
    installObserver();
  }
})();
