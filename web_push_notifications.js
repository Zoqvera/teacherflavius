(function () {
  "use strict";

  const CARD_ID = "pwaPushCard";
  const TITLE_ID = "pwaPushTitle";
  const DESCRIPTION_ID = "pwaPushDescription";
  const BUTTON_ID = "pwaPushButton";

  function isSupported(windowRef) {
    const targetWindow = windowRef || window;
    return Boolean(
      targetWindow.Notification &&
      targetWindow.navigator &&
      targetWindow.navigator.serviceWorker &&
      targetWindow.PushManager
    );
  }

  function isInstalledPwa(windowRef) {
    const targetWindow = windowRef || window;
    const pwa = targetWindow.TeacherFlaviusPwa;
    return Boolean(
      pwa &&
      typeof pwa.isStandalone === "function" &&
      pwa.isStandalone(targetWindow) &&
      !pwa.isNativeCapacitorApp(targetWindow)
    );
  }

  function decodeBase64Url(value) {
    const padding = "=".repeat((4 - (value.length % 4)) % 4);
    const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = window.atob(base64);
    return Uint8Array.from(raw, function (character) {
      return character.charCodeAt(0);
    });
  }

  function getElements(documentRef) {
    const targetDocument = documentRef || document;
    return {
      card: targetDocument.getElementById(CARD_ID),
      title: targetDocument.getElementById(TITLE_ID),
      description: targetDocument.getElementById(DESCRIPTION_ID),
      button: targetDocument.getElementById(BUTTON_ID)
    };
  }

  function setCardState(elements, options) {
    if (!elements.card || !elements.title || !elements.description || !elements.button) return;
    elements.card.hidden = options.hidden === true;
    elements.title.textContent = options.title;
    elements.description.textContent = options.description;
    elements.button.textContent = options.buttonText;
    elements.button.disabled = options.disabled === true;
    elements.button.dataset.action = options.action || "";
  }

  async function getAuthenticatedClient() {
    if (!window.Auth || typeof Auth.getSession !== "function" || typeof Auth.getClient !== "function") {
      return null;
    }

    const session = await Auth.getSession();
    if (!session || !session.user) return null;
    return Auth.getClient();
  }

  function getSubscriptionKeys(subscription) {
    if (!subscription || typeof subscription.toJSON !== "function") return null;
    const serialized = subscription.toJSON();
    const keys = serialized && serialized.keys;
    if (!keys || !keys.p256dh || !keys.auth) return null;
    return {
      endpoint: subscription.endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth
    };
  }

  async function loadVapidPublicKey() {
    const client = await getAuthenticatedClient();
    if (!client) throw new Error("Faça login para ativar notificações.");

    const initialization = await client.functions.invoke("initialize-web-push", {
      body: {}
    });
    if (initialization.error) throw initialization.error;

    const response = await client.rpc("get_web_push_vapid_public_key");
    if (response.error) throw response.error;
    if (typeof response.data !== "string" || !response.data) {
      throw new Error("A configuração de notificações ainda não está disponível.");
    }
    return response.data;
  }

  async function persistSubscription(subscription) {
    const client = await getAuthenticatedClient();
    const keys = getSubscriptionKeys(subscription);
    if (!client || !keys) return false;

    const response = await client.rpc("upsert_my_web_push_subscription", {
      target_endpoint: keys.endpoint,
      target_p256dh: keys.p256dh,
      target_auth: keys.auth,
      target_user_agent: window.navigator.userAgent || null
    });

    if (response.error) throw response.error;
    return true;
  }

  async function removePersistedSubscription(subscription) {
    const client = await getAuthenticatedClient();
    if (!client || !subscription || !subscription.endpoint) return false;

    const response = await client.rpc("delete_my_web_push_subscription", {
      target_endpoint: subscription.endpoint
    });
    if (response.error) throw response.error;
    return response.data === true;
  }

  async function getRegistration() {
    if (window.TeacherFlaviusPwa && typeof window.TeacherFlaviusPwa.registerServiceWorker === "function") {
      await window.TeacherFlaviusPwa.registerServiceWorker(window.navigator);
    }
    return window.navigator.serviceWorker.ready;
  }

  async function getExistingSubscription() {
    const registration = await getRegistration();
    return registration.pushManager.getSubscription();
  }

  async function subscribe() {
    const permission = await window.Notification.requestPermission();
    if (permission !== "granted") {
      return { outcome: permission };
    }

    const registration = await getRegistration();
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const vapidPublicKey = await loadVapidPublicKey();
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeBase64Url(vapidPublicKey)
      });
    }

    await persistSubscription(subscription);
    return { outcome: "granted", subscription: subscription };
  }

  async function unsubscribe() {
    const subscription = await getExistingSubscription();
    if (!subscription) return { outcome: "missing" };

    await removePersistedSubscription(subscription);
    await subscription.unsubscribe();
    return { outcome: "disabled" };
  }

  function renderBlocked(elements) {
    setCardState(elements, {
      title: "Notificações bloqueadas",
      description: "Libere as notificações nas configurações do navegador para receber lembretes de aulas e mensalidades.",
      buttonText: "BLOQUEADAS",
      disabled: true,
      action: ""
    });
  }

  function renderInactive(elements) {
    setCardState(elements, {
      title: "Ativar notificações",
      description: "Receba lembretes de aulas e vencimentos de mensalidade no aplicativo.",
      buttonText: "ATIVAR NOTIFICAÇÕES",
      disabled: false,
      action: "subscribe"
    });
  }

  function renderActive(elements) {
    setCardState(elements, {
      title: "Notificações ativadas",
      description: "Este dispositivo receberá lembretes de aulas e mensalidades.",
      buttonText: "DESATIVAR",
      disabled: false,
      action: "unsubscribe"
    });
  }

  function renderBusy(elements, label) {
    if (!elements.button) return;
    elements.button.disabled = true;
    elements.button.textContent = label;
  }

  async function refresh(elements) {
    if (!isSupported(window) || !isInstalledPwa(window)) {
      if (elements.card) elements.card.hidden = true;
      return;
    }

    if (window.Notification.permission === "denied") {
      renderBlocked(elements);
      return;
    }

    const subscription = await getExistingSubscription();
    if (subscription && window.Notification.permission === "granted") {
      try {
        await persistSubscription(subscription);
      } catch (error) {
        console.warn("Não foi possível sincronizar a assinatura de notificações.", error);
      }
      renderActive(elements);
      return;
    }

    renderInactive(elements);
  }

  async function handleButton(elements) {
    const action = elements.button ? elements.button.dataset.action : "";
    if (!action) return;

    try {
      if (action === "subscribe") {
        renderBusy(elements, "ATIVANDO...");
        const result = await subscribe();
        if (result.outcome === "granted") {
          renderActive(elements);
        } else if (result.outcome === "denied") {
          renderBlocked(elements);
        } else {
          renderInactive(elements);
        }
        return;
      }

      renderBusy(elements, "DESATIVANDO...");
      await unsubscribe();
      renderInactive(elements);
    } catch (error) {
      console.error("Não foi possível atualizar as notificações Push.", error);
      renderInactive(elements);
    }
  }

  function initialize(documentRef) {
    const elements = getElements(documentRef);
    if (!elements.card || !elements.button) return;

    elements.button.addEventListener("click", function () {
      handleButton(elements);
    });

    refresh(elements).catch(function (error) {
      console.warn("Não foi possível verificar as notificações Push.", error);
      elements.card.hidden = true;
    });
  }

  window.TeacherFlaviusWebPush = Object.freeze({
    decodeBase64Url: decodeBase64Url,
    initialize: initialize,
    isInstalledPwa: isInstalledPwa,
    isSupported: isSupported
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      initialize(document);
    }, { once: true });
  } else {
    initialize(document);
  }
})();
