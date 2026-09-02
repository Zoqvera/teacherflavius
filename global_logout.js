(function () {
  "use strict";

  if (window.teacherFlavioGlobalLogoutLoaded) return;
  window.teacherFlavioGlobalLogoutLoaded = true;

  const BUTTON_ID = "globalLogoutButton";
  const STYLE_ID = "globalLogoutStyles";
  const SCRIPT_LOAD_OPTIONS = Object.freeze({
    timeoutMs: null,
    resolveOnError: false
  });

  function loadMobileTopNavigation() {
    if (window.__teacherFlaviusMobileTopNavigationLoaded) return;
    if (document.querySelector('script[src*="mobile_top_navigation.js"]')) return;
    const script = document.createElement("script");
    script.src = "/mobile_top_navigation.js?v=20260820-desktop-menu-1";
    script.defer = true;
    document.head.appendChild(script);
  }

  function loadScript(options, callback) {
    if (!window.ResourceWaiter || typeof window.ResourceWaiter.loadScript !== "function") return;

    window.ResourceWaiter.loadScript({
      selector: options.selector,
      src: options.src,
      isReady: options.isReady,
      timeoutMs: SCRIPT_LOAD_OPTIONS.timeoutMs,
      resolveOnError: SCRIPT_LOAD_OPTIONS.resolveOnError
    }).then(function (ready) {
      if (ready) callback();
    });
  }

  function ensureAuthentication(callback) {
    if (window.Auth && window.Auth.getSession && window.Auth.signOut) {
      callback();
      return;
    }

    loadScript({
      selector: 'script[src*="@supabase/supabase-js"]',
      src: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
      isReady: function () { return !!(window.supabase && window.supabase.createClient); }
    }, function () {
      loadScript({
        selector: 'script[src*="supabase_config.js"]',
        src: "/supabase_config.js?v=20260716-logout-1",
        isReady: function () { return !!window.SUPABASE_CONFIG; }
      }, function () {
        loadScript({
          selector: 'script[src*="auth.js"]',
          src: "/auth.js?v=20260716-logout-1",
          isReady: function () { return !!(window.Auth && window.Auth.getSession && window.Auth.signOut); }
        }, callback);
      });
    });
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${BUTTON_ID}.global-logout-button {
        width: auto !important;
        min-width: 76px !important;
        min-height: 38px !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        flex: 0 0 auto !important;
        margin: 0 !important;
        padding: 9px 15px !important;
        border: 1.5px solid rgba(248, 113, 113, 0.52) !important;
        border-radius: 10px !important;
        background: rgba(248, 113, 113, 0.10) !important;
        color: #fca5a5 !important;
        font: 700 13px Georgia, serif !important;
        line-height: 1 !important;
        letter-spacing: 0.5px !important;
        text-decoration: none !important;
        cursor: pointer !important;
        box-shadow: none !important;
        position: static;
        z-index: 2147483000;
      }
      #${BUTTON_ID}.global-logout-button:hover {
        background: rgba(248, 113, 113, 0.18) !important;
        border-color: rgba(248, 113, 113, 0.82) !important;
      }
      #${BUTTON_ID}.global-logout-button:focus-visible {
        outline: 3px solid rgba(248, 113, 113, 0.35) !important;
        outline-offset: 3px !important;
      }
      #${BUTTON_ID}.global-logout-button:disabled {
        opacity: 0.6 !important;
        cursor: wait !important;
      }
      #${BUTTON_ID}.global-logout-fallback {
        position: fixed !important;
        top: 14px !important;
        right: 14px !important;
      }
      @media (max-width: 520px) {
        #${BUTTON_ID}.global-logout-fallback {
          top: 10px !important;
          right: 10px !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function findExistingButton() {
    return document.getElementById(BUTTON_ID) ||
      document.querySelector("[data-auth-logout]") ||
      document.querySelector('button[onclick*="Auth.signOut"], a[onclick*="Auth.signOut"]');
  }

  function bindButton(button) {
    if (button.dataset.authLogoutBound === "true") return;
    button.dataset.authLogoutBound = "true";
    button.removeAttribute("onclick");
    button.addEventListener("click", async function (event) {
      event.preventDefault();
      if (button.disabled) return;

      const originalText = button.textContent;
      button.disabled = true;
      button.textContent = "SAINDO...";

      try {
        await window.Auth.signOut();
      } catch (error) {
        button.disabled = false;
        button.textContent = originalText || "SAIR";
        window.alert("Não foi possível sair da conta. Verifique sua conexão e tente novamente.");
      }
    });
  }

  function getOrCreateButton() {
    let button = findExistingButton();
    const navigation = document.querySelector(".topbar-actions") || document.querySelector(".top-links") || document.querySelector(".top");

    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      if (navigation) {
        navigation.appendChild(button);
      } else {
        button.classList.add("global-logout-fallback");
        document.body.appendChild(button);
      }
    } else if (navigation && button.parentElement !== navigation) {
      navigation.appendChild(button);
    }

    if (navigation) button.classList.remove("global-logout-fallback");

    button.id = BUTTON_ID;
    button.type = "button";
    button.dataset.authLogout = "true";
    button.classList.add("global-logout-button");
    button.textContent = "SAIR";
    button.setAttribute("aria-label", "Sair da conta atual e entrar com outro e-mail");
    button.title = "Sair da conta atual";
    bindButton(button);
    return button;
  }

  function updateButton(session) {
    let button = findExistingButton();
    if (!session || !session.user) {
      if (button) button.hidden = true;
      return;
    }

    injectStyles();
    button = getOrCreateButton();
    button.hidden = false;
  }

  async function initialize() {
    loadMobileTopNavigation();
    ensureAuthentication(async function () {
      if (!window.Auth || !window.Auth.isConfigured || !window.Auth.isConfigured()) return;

      const existingButton = findExistingButton();
      if (existingButton) existingButton.hidden = true;

      try {
        updateButton(await window.Auth.getSession());
      } catch (error) {
        updateButton(null);
      }

      const client = window.Auth.getClient();
      if (client && client.auth && client.auth.onAuthStateChange) {
        client.auth.onAuthStateChange(function (_event, session) {
          updateButton(session);
        });
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
