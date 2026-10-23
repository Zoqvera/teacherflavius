(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) {
    root.TrialMeetAccess = api;
    root.document.addEventListener("DOMContentLoaded", function () {
      api.initialize(root.document, root);
    }, { once: true });
  }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const ENDPOINT = "https://wnigzpvgsbpjdxvjzugt.supabase.co/functions/v1/trial-meet-access";
  const MEET_LINKS = Object.freeze({
    monday_18: "https://meet.google.com/hxv-giye-but",
    tuesday_10: "https://meet.google.com/vqj-ufhs-rzt",
    tuesday_15: "https://meet.google.com/ccv-yotk-iwh",
    thursday_20: "https://meet.google.com/rma-wrwu-nry",
    friday_15: "https://meet.google.com/hck-hqqk-wnt"
  });

  function getMeetUrl(slot) {
    return Object.prototype.hasOwnProperty.call(MEET_LINKS, slot) ? MEET_LINKS[slot] : "";
  }

  function isValidContact(name, whatsapp) {
    const cleanName = String(name || "").replace(/\s+/g, " ").trim();
    const digits = String(whatsapp || "").replace(/\D/g, "");
    return cleanName.length >= 2 && cleanName.length <= 120 &&
      digits.length >= 10 && digits.length <= 15;
  }

  function setMessage(element, message) {
    element.textContent = message;
    element.hidden = !message;
  }

  async function submitEntry(windowRef, payload) {
    const controller = new AbortController();
    const timeout = windowRef.setTimeout(function () { controller.abort(); }, 15000);
    try {
      const response = await windowRef.fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal: controller.signal
      });
      const data = await response.json().catch(function () { return {}; });
      if (!response.ok || data.ok !== true) {
        throw new Error(data.error || "Não foi possível registrar seu acesso. Tente novamente.");
      }
      return true;
    } finally {
      windowRef.clearTimeout(timeout);
    }
  }

  function initialize(documentRef, windowRef) {
    const form = documentRef.getElementById("trialMeetForm");
    if (!form) return;
    const submit = documentRef.getElementById("trialMeetSubmit");
    const errorMessage = documentRef.getElementById("trialMeetError");
    const name = documentRef.getElementById("visitorName");
    const whatsapp = documentRef.getElementById("visitorWhatsapp");
    let requestId = null;
    let busy = false;

    form.addEventListener("input", function () { requestId = null; });
    form.addEventListener("change", function () { requestId = null; });

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (busy) return;
      setMessage(errorMessage, "");

      const selected = form.querySelector('input[name="lesson_slot"]:checked');
      const slot = selected ? selected.value : "";
      const meetUrl = getMeetUrl(slot);
      if (!isValidContact(name.value, whatsapp.value)) {
        setMessage(errorMessage, "Informe seu nome e um número de WhatsApp válido, com DDD.");
        return;
      }
      if (!meetUrl) {
        setMessage(errorMessage, "Selecione a aula experimental de que você vai participar.");
        return;
      }
      const honeypot = form.elements.namedItem("website");
      if (honeypot && honeypot.value) return;

      if (!requestId) requestId = windowRef.crypto.randomUUID();
      busy = true;
      submit.disabled = true;
      submit.querySelector("span").textContent = "REGISTRANDO ACESSO...";
      try {
        await submitEntry(windowRef, {
          request_id: requestId,
          name: name.value,
          whatsapp: whatsapp.value,
          lesson_slot: slot
        });
        windowRef.location.assign(meetUrl);
      } catch (error) {
        const message = error && error.name === "AbortError"
          ? "O registro demorou a responder. Verifique sua conexão e tente novamente."
          : (error && error.message) || "Não foi possível registrar seu acesso.";
        setMessage(errorMessage, message);
      } finally {
        busy = false;
        submit.disabled = false;
        submit.querySelector("span").textContent = "PARTICIPAR DA AULA";
      }
    });
  }

  return Object.freeze({ getMeetUrl, isValidContact, submitEntry, initialize });
});
