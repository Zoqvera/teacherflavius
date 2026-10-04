(function () {
  "use strict";

  const CALLBACK_SCHEME = "com.teacherflavius.app:";
  const CALLBACK_HOST = "login-callback";
  const LOGIN_PATH = "/login/";
  let initialized = false;
  let lastHandledUrl = "";

  function capacitorRef(windowRef) {
    return (windowRef || window).Capacitor || null;
  }

  function isNativeApp(windowRef) {
    const capacitor = capacitorRef(windowRef);
    return Boolean(
      capacitor &&
      typeof capacitor.isNativePlatform === "function" &&
      capacitor.isNativePlatform()
    );
  }

  function resolvePlugin(name, windowRef) {
    const capacitor = capacitorRef(windowRef);
    if (!capacitor) return null;

    if (capacitor.Plugins && capacitor.Plugins[name]) {
      return capacitor.Plugins[name];
    }

    if (typeof capacitor.registerPlugin === "function") {
      return capacitor.registerPlugin(name);
    }

    return null;
  }

  function normalizeNextPath(value) {
    const text = String(value || "/area-do-estudante/").trim();
    if (!text.startsWith("/") || text.startsWith("//")) {
      return "/area-do-estudante/index.html";
    }

    try {
      const parsed = new URL(text, "https://native.teacherflavius.invalid");
      let pathname = parsed.pathname || "/";
      if (pathname.endsWith("/")) pathname += "index.html";
      return pathname + parsed.search + parsed.hash;
    } catch (_) {
      return "/area-do-estudante/index.html";
    }
  }

  function parseCallbackUrl(value) {
    if (!value) return null;

    let parsed;
    try {
      parsed = new URL(value);
    } catch (_) {
      return null;
    }

    if (parsed.protocol !== CALLBACK_SCHEME || parsed.hostname !== CALLBACK_HOST) {
      return null;
    }

    return Object.freeze({
      code: String(parsed.searchParams.get("code") || ""),
      error: String(parsed.searchParams.get("error") || ""),
      errorDescription: String(parsed.searchParams.get("error_description") || ""),
      nextPath: normalizeNextPath(parsed.searchParams.get("next"))
    });
  }

  function buildLocalLoginUrl(callback) {
    const params = new URLSearchParams();
    params.set("next", callback.nextPath);

    if (callback.code) params.set("native_code", callback.code);
    if (callback.error) params.set("native_error", callback.error);
    if (callback.errorDescription) {
      params.set("native_error_description", callback.errorDescription);
    }

    return LOGIN_PATH + "?" + params.toString();
  }

  async function closeBrowser(windowRef) {
    const browser = resolvePlugin("Browser", windowRef);
    if (!browser || typeof browser.close !== "function") return;

    try {
      await browser.close();
    } catch (_) {}
  }

  async function handleCallbackUrl(value, windowRef) {
    const targetWindow = windowRef || window;
    const callback = parseCallbackUrl(value);
    if (!callback || value === lastHandledUrl) return false;

    lastHandledUrl = value;
    await closeBrowser(targetWindow);
    targetWindow.location.replace(buildLocalLoginUrl(callback));
    return true;
  }

  async function openOAuthUrl(url, windowRef) {
    const targetWindow = windowRef || window;
    const value = String(url || "").trim();
    if (!value) throw new Error("URL de autenticação inválida.");

    const browser = resolvePlugin("Browser", targetWindow);
    if (browser && typeof browser.open === "function") {
      await browser.open({ url: value });
      return;
    }

    targetWindow.location.assign(value);
  }

  async function initialize(windowRef) {
    const targetWindow = windowRef || window;
    if (initialized || !isNativeApp(targetWindow)) return;

    const app = resolvePlugin("App", targetWindow);
    if (!app) return;

    initialized = true;

    if (typeof app.addListener === "function") {
      await app.addListener("appUrlOpen", function (event) {
        handleCallbackUrl(event && event.url, targetWindow);
      });
    }

    if (typeof app.getLaunchUrl === "function") {
      const launch = await app.getLaunchUrl();
      if (launch && launch.url) {
        await handleCallbackUrl(launch.url, targetWindow);
      }
    }
  }

  window.TeacherFlaviusNativeAuth = Object.freeze({
    callbackHost: CALLBACK_HOST,
    callbackScheme: CALLBACK_SCHEME,
    handleCallbackUrl: handleCallbackUrl,
    initialize: initialize,
    isNativeApp: isNativeApp,
    normalizeNextPath: normalizeNextPath,
    openOAuthUrl: openOAuthUrl,
    parseCallbackUrl: parseCallbackUrl
  });

  initialize(window).catch(function (error) {
    console.warn("Não foi possível inicializar o retorno de autenticação do aplicativo.", error);
  });
})();
