(function () {
  "use strict";

  if (window.__teacherFlaviusMobileTopNavigationLoaded) return;
  window.__teacherFlaviusMobileTopNavigationLoaded = true;

  var BAR_ID = "tf-mobile-top-navigation";
  var OVERLAY_ID = "tf-mobile-top-menu-overlay";
  var STYLE_ID = "tf-mobile-top-navigation-styles";
  var SOURCE_SELECTORS = [
    "[data-mobile-menu-source]",
    ".topbar-actions",
    ".top-links",
    ".header-actions",
    ".nav-actions",
    ".top"
  ];
  var currentSource = null;
  var refreshTimer = null;

  function installStudentAreaShortcut() {
    document.querySelectorAll('a.student-link[href]').forEach(function (link) {
      try {
        var url = new URL(link.getAttribute("href"), window.location.href);
        var next = url.searchParams.get("next");
        if (url.origin !== window.location.origin) return;
        if (url.pathname !== "/login/" && url.pathname !== "/login.html") return;
        if (next !== "/area-do-estudante/" && next !== "/area_do_estudante.html") return;
        link.href = "/area-do-estudante/";
      } catch (error) {
        // Keep the original link if parsing fails.
      }
    });
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function isActionElement(node) {
    return !!(node && node.nodeType === 1 && node.matches("a[href],button,[role='button']"));
  }

  function directActions(source) {
    if (!source) return [];

    var direct = Array.from(source.children || []).filter(isActionElement);
    if (direct.length >= 2) return direct;

    return Array.from(source.querySelectorAll("a[href],button,[role='button']")).filter(function (node) {
      return !(node.closest && node.closest("#" + OVERLAY_ID + ",#" + BAR_ID));
    });
  }

  function visibleActions(source) {
    return directActions(source).filter(function (action) {
      if (action.hasAttribute("hidden") || action.getAttribute("aria-hidden") === "true") return false;
      return window.getComputedStyle(action).display !== "none";
    });
  }

  function isDangerAction(action) {
    var text = normalizeText(action && action.textContent).toUpperCase();
    return text === "SAIR" ||
      text.indexOf("LOGOUT") !== -1 ||
      action.id === "globalLogoutButton" ||
      action.hasAttribute("data-auth-logout");
  }

  function candidateSources() {
    var found = [];

    SOURCE_SELECTORS.forEach(function (selector) {
      document.querySelectorAll(selector).forEach(function (source) {
        if (!found.includes(source)) found.push(source);
      });
    });

    return found.filter(function (source) {
      return visibleActions(source).length >= 2;
    });
  }

  function chooseSource() {
    var candidates = candidateSources();
    if (!candidates.length) return null;

    candidates.sort(function (a, b) {
      return a.getBoundingClientRect().top - b.getBoundingClientRect().top;
    });

    return candidates[0];
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;

    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      "#" + BAR_ID + ",#" + BAR_ID + " *,#" + OVERLAY_ID + ",#" + OVERLAY_ID + " *{box-sizing:border-box}",
      ".tf-mobile-nav-source-active{display:none!important}",
      "#" + BAR_ID + "{display:flex!important;align-items:center;justify-content:flex-end;width:100%;margin:0 0 22px;padding:0 2px;position:relative;z-index:1200;font-family:var(--tf-font-body,Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif)}",
      "#" + BAR_ID + " .tf-mobile-nav-toggle{display:inline-flex;align-items:center;justify-content:center;gap:9px;min-height:44px;padding:10px 17px;border:1px solid rgba(78,154,236,.46);border-radius:14px;background:rgba(5,66,136,.18);color:#e8f2ff;font:800 12px/1.2 var(--tf-font-display,Inter,system-ui,sans-serif);letter-spacing:.02em;box-shadow:0 8px 24px rgba(2,16,43,.16);cursor:pointer;transition:background 160ms ease,border-color 160ms ease,transform 160ms ease}",
      "#" + BAR_ID + " .tf-mobile-nav-toggle:hover{background:rgba(14,91,177,.28);border-color:rgba(78,154,236,.70);transform:translateY(-1px)}",
      "#" + BAR_ID + " .tf-mobile-nav-toggle-icon{font-size:18px;line-height:1}",
      "#" + BAR_ID + " button:focus-visible,#" + OVERLAY_ID + " a:focus-visible,#" + OVERLAY_ID + " button:focus-visible{outline:3px solid #4e9aec!important;outline-offset:3px!important}",
      "#" + OVERLAY_ID + "{display:none;position:fixed!important;inset:0!important;z-index:2147482500;padding:18px!important;background:rgba(2,6,23,.72);backdrop-filter:blur(6px)}",
      "#" + OVERLAY_ID + ".is-open{display:flex!important;align-items:center!important;justify-content:center!important}",
      "#" + OVERLAY_ID + " .tf-mobile-menu-sheet{width:min(100%,540px);max-height:min(82dvh,720px);margin:auto!important;overflow:auto;padding:20px;border:1px solid rgba(78,154,236,.30);border-radius:24px;background:linear-gradient(155deg,#071326,#0a2956);box-shadow:0 26px 80px rgba(2,6,23,.58);font-family:var(--tf-font-body,Inter,system-ui,sans-serif)}",
      "#" + OVERLAY_ID + " .tf-mobile-menu-head{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:14px;padding:2px 2px 12px;border-bottom:1px solid rgba(148,163,184,.16)}",
      "#" + OVERLAY_ID + " .tf-mobile-menu-title{margin:0;color:#fff;font:800 19px/1.2 var(--tf-font-display,Inter,system-ui,sans-serif)}",
      "#" + OVERLAY_ID + " .tf-mobile-menu-close{display:grid;place-items:center;width:42px;height:42px;flex:0 0 42px;border:1px solid rgba(148,163,184,.24);border-radius:13px;background:rgba(255,255,255,.06);color:#fff;font-size:24px;line-height:1;cursor:pointer}",
      "#" + OVERLAY_ID + " .tf-mobile-menu-list{display:grid;gap:9px}",
      "#" + OVERLAY_ID + " .tf-mobile-menu-item{display:flex;align-items:center;justify-content:space-between;width:100%;min-height:52px;padding:13px 15px;border:1px solid rgba(78,154,236,.22);border-radius:14px;background:rgba(5,66,136,.18);color:#e2e8f0;font:750 13px/1.35 var(--tf-font-display,Inter,system-ui,sans-serif);text-align:left;text-decoration:none;cursor:pointer}",
      "#" + OVERLAY_ID + " .tf-mobile-menu-item:hover{background:rgba(14,91,177,.24);border-color:rgba(78,154,236,.38)}",
      "#" + OVERLAY_ID + " .tf-mobile-menu-item::after{content:'›';margin-left:12px;color:#4e9aec;font-size:21px;line-height:1}",
      "#" + OVERLAY_ID + " .tf-mobile-menu-item.tf-mobile-menu-danger{margin-top:5px;border-color:rgba(248,113,113,.40);background:rgba(248,113,113,.10);color:#fca5a5}",
      "#" + OVERLAY_ID + " .tf-mobile-menu-item.tf-mobile-menu-danger:hover{background:rgba(248,113,113,.16);border-color:rgba(248,113,113,.58)}",
      "#" + OVERLAY_ID + " .tf-mobile-menu-item.tf-mobile-menu-danger::after{content:'';margin:0}",
      "body.tf-mobile-menu-open{overflow:hidden!important}",
      "@media(max-width:720px){#" + BAR_ID + "{margin-bottom:20px}#" + OVERLAY_ID + " .tf-mobile-menu-sheet{width:min(100%,520px);padding:18px}}",
      "@media(max-width:380px){#" + BAR_ID + " .tf-mobile-nav-toggle{min-height:42px;padding:9px 13px;font-size:11px}}",
      "@media(prefers-reduced-motion:reduce){#" + OVERLAY_ID + "{backdrop-filter:none}#" + BAR_ID + " .tf-mobile-nav-toggle{transition:none}}",
      "@media print{#" + BAR_ID + ",#" + OVERLAY_ID + "{display:none!important}.tf-mobile-nav-source-active{display:flex!important}}"
    ].join("\n");

    document.head.appendChild(style);
  }

  function closeMenu(options) {
    var overlay = document.getElementById(OVERLAY_ID);
    var toggle = document.querySelector("#" + BAR_ID + " .tf-mobile-nav-toggle");

    if (overlay) {
      overlay.classList.remove("is-open");
      overlay.setAttribute("aria-hidden", "true");
    }

    if (document.body) document.body.classList.remove("tf-mobile-menu-open");

    if (toggle) {
      toggle.setAttribute("aria-expanded", "false");
      if (!options || options.restoreFocus !== false) {
        try { toggle.focus({ preventScroll: true }); } catch (error) { toggle.focus(); }
      }
    }
  }

  function openMenu() {
    var overlay = document.getElementById(OVERLAY_ID);
    var toggle = document.querySelector("#" + BAR_ID + " .tf-mobile-nav-toggle");
    if (!overlay) return;

    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
    if (document.body) document.body.classList.add("tf-mobile-menu-open");
    if (toggle) toggle.setAttribute("aria-expanded", "true");

    var closeButton = overlay.querySelector(".tf-mobile-menu-close");
    if (closeButton) {
      try { closeButton.focus({ preventScroll: true }); } catch (error) { closeButton.focus(); }
    }
  }

  function proxyAction(original) {
    var label = normalizeText(original.textContent) || original.getAttribute("aria-label") || "Abrir";
    var proxy;

    if (original.tagName === "A" && original.getAttribute("href")) {
      proxy = document.createElement("a");
      proxy.href = original.getAttribute("href");
      if (original.target) proxy.target = original.target;
      if (original.rel) proxy.rel = original.rel;
      proxy.addEventListener("click", function () {
        closeMenu({ restoreFocus: false });
      });
    } else {
      proxy = document.createElement("button");
      proxy.type = "button";
      proxy.addEventListener("click", function () {
        closeMenu({ restoreFocus: false });
        window.setTimeout(function () { original.click(); }, 0);
      });
    }

    proxy.className = "tf-mobile-menu-item" + (isDangerAction(original) ? " tf-mobile-menu-danger" : "");
    proxy.textContent = label;
    proxy.setAttribute("data-tf-mobile-menu-proxy", "true");
    if (original.hasAttribute("aria-label")) proxy.setAttribute("aria-label", original.getAttribute("aria-label"));
    return proxy;
  }

  function buildOverlay(actions) {
    var existing = document.getElementById(OVERLAY_ID);
    if (existing) existing.remove();

    var overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = [
      '<div class="tf-mobile-menu-sheet" role="dialog" aria-modal="true" aria-labelledby="tf-mobile-menu-title">',
      '  <div class="tf-mobile-menu-head">',
      '    <h2 class="tf-mobile-menu-title" id="tf-mobile-menu-title">Menu</h2>',
      '    <button class="tf-mobile-menu-close" type="button" aria-label="Fechar menu">×</button>',
      '  </div>',
      '  <div class="tf-mobile-menu-list"></div>',
      '</div>'
    ].join("");

    var list = overlay.querySelector(".tf-mobile-menu-list");
    actions.forEach(function (action) {
      list.appendChild(proxyAction(action));
    });

    var closeButton = overlay.querySelector(".tf-mobile-menu-close");
    if (closeButton) {
      closeButton.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
      });
    }

    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) closeMenu();
    });

    document.body.appendChild(overlay);
  }

  function buildBar(source) {
    var existing = document.getElementById(BAR_ID);
    if (existing) existing.remove();

    var bar = document.createElement("nav");
    bar.id = BAR_ID;
    bar.setAttribute("aria-label", "Menu de navegação");

    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "tf-mobile-nav-toggle";
    toggle.setAttribute("aria-controls", OVERLAY_ID);
    toggle.setAttribute("aria-expanded", "false");
    toggle.innerHTML = '<span class="tf-mobile-nav-toggle-icon" aria-hidden="true">☰</span><span>Menu</span>';
    toggle.addEventListener("click", openMenu);
    bar.appendChild(toggle);

    source.parentNode.insertBefore(bar, source);
  }

  function clearEnhancement() {
    if (currentSource) currentSource.classList.remove("tf-mobile-nav-source-active");
    currentSource = null;

    var bar = document.getElementById(BAR_ID);
    var overlay = document.getElementById(OVERLAY_ID);
    if (bar) bar.remove();
    if (overlay) overlay.remove();
    if (document.body) document.body.classList.remove("tf-mobile-menu-open");
  }

  function refresh() {
    if (!document.body) return;
    installStudentAreaShortcut();
    installStyles();

    var source = chooseSource();
    if (!source) {
      clearEnhancement();
      return;
    }

    var actions = visibleActions(source);
    if (actions.length < 2) {
      clearEnhancement();
      return;
    }

    if (currentSource && currentSource !== source) currentSource.classList.remove("tf-mobile-nav-source-active");
    currentSource = source;
    source.classList.add("tf-mobile-nav-source-active");

    buildBar(source);
    buildOverlay(actions);
  }

  function scheduleRefresh() {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(refresh, 80);
  }

  function installObserver() {
    var observer = new MutationObserver(function (mutations) {
      var shouldRefresh = mutations.some(function (mutation) {
        if (mutation.type === "attributes") {
          return !(mutation.target && mutation.target.closest && mutation.target.closest("#" + BAR_ID + ",#" + OVERLAY_ID));
        }

        if (mutation.type !== "childList") return false;

        return Array.from(mutation.addedNodes || []).concat(Array.from(mutation.removedNodes || [])).some(function (node) {
          if (!node || node.nodeType !== 1) return false;
          if (node.id === BAR_ID || node.id === OVERLAY_ID || (node.closest && node.closest("#" + BAR_ID + ",#" + OVERLAY_ID))) return false;
          return true;
        });
      });

      if (shouldRefresh) scheduleRefresh();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "aria-hidden"]
    });
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeMenu();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      refresh();
      installObserver();
    }, { once: true });
  } else {
    refresh();
    installObserver();
  }
})();