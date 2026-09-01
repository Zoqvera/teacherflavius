(function () {
  "use strict";

  var FLOATING_BUTTON_ID = "teacher-flavius-whatsapp-float";
  var BYPASS_ATTRIBUTE = "data-tf-whatsapp-form-bypass";
  var BASE_MESSAGE = "Olá, Teacher! Vim pelo site e gostaria de conversar sobre as aulas de inglês.";
  var activeLink = null;
  var previousFocus = null;

  function isWhatsappHref(href) {
    if (!href) return false;
    try {
      var url = new URL(href, window.location.href);
      return url.hostname === "wa.me" || url.hostname === "api.whatsapp.com" || /(^|\.)whatsapp\.com$/.test(url.hostname);
    } catch (error) {
      return false;
    }
  }

  function shouldUseForm(link) {
    if (!link || link.id === FLOATING_BUTTON_ID) return false;
    if (link.hasAttribute(BYPASS_ATTRIBUTE)) return false;
    return isWhatsappHref(link.getAttribute("href"));
  }

  function whatsappNumber(link) {
    try {
      var url = new URL(link.getAttribute("href"), window.location.href);
      if (url.hostname === "wa.me") return url.pathname.replace(/\D/g, "");
      if (url.hostname === "api.whatsapp.com") return (url.searchParams.get("phone") || "").replace(/\D/g, "");
      return "";
    } catch (error) {
      return "";
    }
  }

  function installStyles() {
    if (document.getElementById("teacher-whatsapp-lead-form-styles")) return;
    var style = document.createElement("style");
    style.id = "teacher-whatsapp-lead-form-styles";
    style.textContent = [
      ".tf-wa-form-backdrop{position:fixed;inset:0;z-index:10050;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(1,8,25,.74);backdrop-filter:blur(5px)}",
      ".tf-wa-form-backdrop[hidden]{display:none}",
      ".tf-wa-form-dialog{position:relative;width:min(100%,520px);max-height:calc(100vh - 40px);overflow:auto;border:1px solid rgba(255,255,255,.16);border-radius:22px;background:#071a3b;color:#fff;box-shadow:0 24px 70px rgba(0,0,0,.45);font-family:Arial,Helvetica,sans-serif}",
      ".tf-wa-form-content{padding:28px}",
      ".tf-wa-form-close{position:absolute;top:14px;right:14px;width:40px;height:40px;border:0;border-radius:50%;background:rgba(255,255,255,.1);color:#fff;font-size:25px;line-height:1;cursor:pointer}",
      ".tf-wa-form-close:hover{background:rgba(255,255,255,.17)}",
      ".tf-wa-form-close:focus-visible,.tf-wa-form-input:focus-visible,.tf-wa-form-select:focus-visible,.tf-wa-form-submit:focus-visible{outline:3px solid #7cc7ff;outline-offset:2px}",
      ".tf-wa-form-kicker{margin:0 44px 8px 0;color:#76d99b;font-size:12px;font-weight:900;letter-spacing:.12em;text-transform:uppercase}",
      ".tf-wa-form-title{margin:0 44px 8px 0;font-size:clamp(24px,5vw,34px);line-height:1.05}",
      ".tf-wa-form-intro{margin:0 0 22px;color:#c9d6ee;font-size:15px;line-height:1.55}",
      ".tf-wa-form-grid{display:grid;gap:16px}",
      ".tf-wa-form-field{display:grid;gap:7px}",
      ".tf-wa-form-label{font-size:14px;font-weight:800}",
      ".tf-wa-form-input,.tf-wa-form-select{box-sizing:border-box;width:100%;min-height:48px;border:1px solid rgba(255,255,255,.2);border-radius:12px;background:#fff;color:#07142d;padding:11px 13px;font:inherit}",
      ".tf-wa-form-submit{min-height:50px;margin-top:4px;border:0;border-radius:12px;background:#25d366;color:#07140c;padding:13px 18px;font:inherit;font-weight:900;cursor:pointer}",
      ".tf-wa-form-submit:hover{background:#31df72}",
      ".tf-wa-form-note{margin:13px 0 0;color:#9fb0cd;font-size:12px;line-height:1.45}",
      ".tf-wa-form-error{margin:0;color:#ffb7b7;font-size:13px;font-weight:700}",
      "@media(max-width:560px){.tf-wa-form-backdrop{align-items:flex-end;padding:0}.tf-wa-form-dialog{width:100%;max-height:92vh;border-radius:22px 22px 0 0}.tf-wa-form-content{padding:26px 20px 24px}}",
      "@media(prefers-reduced-motion:reduce){.tf-wa-form-backdrop{backdrop-filter:none}}"
    ].join("");
    document.head.appendChild(style);
  }

  function ensureDialog() {
    var backdrop = document.getElementById("teacher-whatsapp-lead-form");
    if (backdrop) return backdrop;

    installStyles();
    backdrop = document.createElement("div");
    backdrop.id = "teacher-whatsapp-lead-form";
    backdrop.className = "tf-wa-form-backdrop";
    backdrop.hidden = true;
    backdrop.innerHTML = [
      '<div class="tf-wa-form-dialog" role="dialog" aria-modal="true" aria-labelledby="tf-wa-form-title" aria-describedby="tf-wa-form-intro">',
      '<button class="tf-wa-form-close" type="button" aria-label="Fechar formulário">×</button>',
      '<div class="tf-wa-form-content">',
      '<p class="tf-wa-form-kicker">Antes de falar comigo</p>',
      '<h2 class="tf-wa-form-title" id="tf-wa-form-title">Conte um pouco sobre você</h2>',
      '<p class="tf-wa-form-intro" id="tf-wa-form-intro">Preencha três informações rápidas. Elas serão incluídas na mensagem que você enviará pelo WhatsApp.</p>',
      '<form class="tf-wa-form" novalidate>',
      '<div class="tf-wa-form-grid">',
      '<label class="tf-wa-form-field"><span class="tf-wa-form-label">Nome</span><input class="tf-wa-form-input" id="tf-wa-name" name="name" type="text" autocomplete="name" maxlength="80" required placeholder="Seu nome"></label>',
      '<label class="tf-wa-form-field"><span class="tf-wa-form-label">Idade</span><input class="tf-wa-form-input" id="tf-wa-age" name="age" type="number" inputmode="numeric" min="1" max="120" required placeholder="Sua idade"></label>',
      '<label class="tf-wa-form-field"><span class="tf-wa-form-label">Nível de inglês</span><select class="tf-wa-form-select" id="tf-wa-level" name="level" required><option value="">Selecione seu nível</option><option>Iniciante (A1)</option><option>Básico (A2)</option><option>Intermediário (B1)</option><option>Intermediário avançado (B2)</option><option>Avançado (C1/C2)</option><option>Não sei meu nível</option></select></label>',
      '<p class="tf-wa-form-error" id="tf-wa-form-error" role="alert" hidden>Preencha nome, idade e nível de inglês para continuar.</p>',
      '<button class="tf-wa-form-submit" type="submit">CONTINUAR NO WHATSAPP</button>',
      '</div>',
      '</form>',
      '<p class="tf-wa-form-note">Esses dados são usados apenas para montar sua mensagem no WhatsApp e não são enviados ao sistema de analytics do site.</p>',
      '</div>',
      '</div>'
    ].join("");

    document.body.appendChild(backdrop);

    backdrop.querySelector(".tf-wa-form-close").addEventListener("click", closeDialog);
    backdrop.addEventListener("click", function (event) {
      if (event.target === backdrop) closeDialog();
    });
    backdrop.querySelector("form").addEventListener("submit", submitForm);
    return backdrop;
  }

  function openDialog(link) {
    activeLink = link;
    previousFocus = document.activeElement;
    var backdrop = ensureDialog();
    var error = backdrop.querySelector("#tf-wa-form-error");
    if (error) error.hidden = true;
    backdrop.hidden = false;
    document.documentElement.style.overflow = "hidden";
    window.setTimeout(function () {
      var nameInput = backdrop.querySelector("#tf-wa-name");
      if (nameInput) nameInput.focus();
    }, 0);
  }

  function closeDialog() {
    var backdrop = document.getElementById("teacher-whatsapp-lead-form");
    if (!backdrop || backdrop.hidden) return;
    backdrop.hidden = true;
    document.documentElement.style.overflow = "";
    activeLink = null;
    if (previousFocus && typeof previousFocus.focus === "function") previousFocus.focus();
    previousFocus = null;
  }

  function normalizedValue(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  }

  function submitForm(event) {
    event.preventDefault();
    if (!activeLink) return;

    var form = event.currentTarget;
    var name = normalizedValue(form.elements.name.value);
    var age = normalizedValue(form.elements.age.value);
    var level = normalizedValue(form.elements.level.value);
    var ageNumber = Number(age);
    var error = form.querySelector("#tf-wa-form-error");

    if (!name || !age || !level || !Number.isFinite(ageNumber) || ageNumber < 1 || ageNumber > 120) {
      if (error) error.hidden = false;
      if (!name) form.elements.name.focus();
      else if (!age || !Number.isFinite(ageNumber) || ageNumber < 1 || ageNumber > 120) form.elements.age.focus();
      else form.elements.level.focus();
      return;
    }

    if (error) error.hidden = true;
    var number = whatsappNumber(activeLink) || "5534998349756";
    var message = [
      BASE_MESSAGE,
      "",
      "Meu nome é " + name + ".",
      "Tenho " + ageNumber + " anos.",
      "Meu nível de inglês é " + level + "."
    ].join("\n");
    var personalizedUrl = "https://wa.me/" + number + "?text=" + encodeURIComponent(message);
    var link = activeLink;
    var originalHref = link.getAttribute("href");

    closeDialog();
    form.reset();

    link.setAttribute(BYPASS_ATTRIBUTE, "1");
    link.setAttribute("href", personalizedUrl);
    try {
      link.click();
    } finally {
      window.setTimeout(function () {
        if (originalHref == null) link.removeAttribute("href");
        else link.setAttribute("href", originalHref);
        link.removeAttribute(BYPASS_ATTRIBUTE);
      }, 0);
    }
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeDialog();
  });

  document.addEventListener("click", function (event) {
    var link = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!shouldUseForm(link)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openDialog(link);
  }, true);

  window.TeacherWhatsappLeadForm = {
    manages: shouldUseForm,
    baseMessage: BASE_MESSAGE
  };
})();