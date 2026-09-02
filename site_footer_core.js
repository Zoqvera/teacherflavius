(function () {
  "use strict";

  const FOOTER_ID = "teacher-flavius-site-footer";
  const STYLE_ID = "teacher-flavius-site-footer-styles";
  const PAYMENT_NOTICE_LOADER_SCRIPT_ID = "teacher-flavius-payment-notice-loader-script";
  const PAYMENT_NOTICE_LOADER_SCRIPT_SRC = "/student_payment_notice_loader.js?v=20260902-1";

  function loadBehaviorScript(id, src) {
    if (!document.body || document.getElementById(id)) return;

    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.async = true;
    document.body.appendChild(script);
  }

  function loadPaymentNoticeBehavior() {
    loadBehaviorScript(PAYMENT_NOTICE_LOADER_SCRIPT_ID, PAYMENT_NOTICE_LOADER_SCRIPT_SRC);
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      "#" + FOOTER_ID + ", #" + FOOTER_ID + " *{box-sizing:border-box}",
      ".tf-footer-flex-host{flex-direction:column!important}",
      ".tf-site-footer{width:100%;align-self:stretch;margin-top:clamp(48px,8vw,88px);color:#e2e8f0;background:linear-gradient(145deg,#070d1c 0%,#111b38 58%,#172554 100%);border-top:1px solid rgba(129,140,248,.4);box-shadow:0 -18px 50px rgba(2,6,23,.24);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;text-align:left;position:relative;z-index:1;overflow:hidden}",
      ".tf-site-footer::before{content:'';position:absolute;width:360px;height:360px;top:-250px;right:-100px;border-radius:50%;background:rgba(129,140,248,.14);filter:blur(4px);pointer-events:none}",
      ".tf-site-footer__inner{width:min(1120px,calc(100% - 40px));margin:0 auto;padding:52px 0 24px;position:relative}",
      ".tf-site-footer__grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(180px,.8fr) minmax(240px,.95fr);gap:clamp(30px,5vw,72px);align-items:start}",
      ".tf-site-footer__title{margin:0 0 12px;color:#fff;font-family:Georgia,'Times New Roman',serif;font-size:clamp(28px,4vw,38px);line-height:1.08;letter-spacing:-.02em}",
      ".tf-site-footer__description{max-width:560px;margin:0;color:#b8c4d9;font-size:15px;line-height:1.7}",
      ".tf-site-footer__credentials{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:24px}",
      ".tf-site-footer__credential{min-height:92px;padding:15px 13px;border:1px solid rgba(148,163,184,.18);border-radius:15px;background:rgba(255,255,255,.045)}",
      ".tf-site-footer__credential strong{display:block;margin-bottom:7px;color:#a5b4fc;font-size:18px;line-height:1}",
      ".tf-site-footer__credential span{display:block;color:#dbe4f3;font-size:12px;font-weight:650;line-height:1.4}",
      ".tf-site-footer__heading{margin:4px 0 18px;color:#fff;font-size:13px;font-weight:800;letter-spacing:.13em;text-transform:uppercase}",
      ".tf-site-footer__links{display:grid;gap:12px}",
      ".tf-site-footer__link{width:fit-content;color:#cbd5e1;font-size:14px;font-weight:650;line-height:1.4;text-decoration:none;transition:color 160ms ease,transform 160ms ease}",
      ".tf-site-footer__link:hover{color:#fff;transform:translateX(3px)}",
      ".tf-site-footer__link:focus-visible,.tf-site-footer__cta:focus-visible,.tf-site-footer__bottom a:focus-visible{outline:3px solid #facc15;outline-offset:4px}",
      ".tf-site-footer__contact{padding:22px;border:1px solid rgba(129,140,248,.35);border-radius:19px;background:rgba(129,140,248,.09)}",
      ".tf-site-footer__contact p{margin:0 0 18px;color:#cbd5e1;font-size:14px;line-height:1.55}",
      ".tf-site-footer__cta{display:inline-flex;align-items:center;justify-content:center;width:100%;min-height:46px;padding:12px 16px;border:1px solid rgba(255,255,255,.38);border-radius:999px;color:#fff;background:linear-gradient(135deg,#22c55e,#15803d);box-shadow:0 12px 26px rgba(21,128,61,.24);font-size:13px;font-weight:800;letter-spacing:.035em;text-decoration:none;text-transform:uppercase;transition:transform 160ms ease,box-shadow 160ms ease}",
      ".tf-site-footer__cta:hover{transform:translateY(-2px);box-shadow:0 16px 34px rgba(21,128,61,.34)}",
      ".tf-site-footer__bottom{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-top:36px;padding-top:20px;border-top:1px solid rgba(148,163,184,.15)}",
      ".tf-site-footer__bottom p{margin:0;color:#8290a8;font-size:12px;line-height:1.6}",
      ".tf-site-footer__bottom a{color:#a5b4fc;text-decoration:none}.tf-site-footer__bottom a:hover{color:#fff;text-decoration:underline}",
      ".tf-site-footer__legal{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:7px 12px;max-width:470px}",
      "@media(max-width:850px){.tf-site-footer__grid{grid-template-columns:1fr 1fr}.tf-site-footer__brand{grid-column:1/-1}}",
      "@media(max-width:620px){.tf-site-footer__inner{width:min(100% - 28px,1120px);padding-top:40px}.tf-site-footer__grid{grid-template-columns:1fr;gap:30px}.tf-site-footer__brand{grid-column:auto}.tf-site-footer__credentials{grid-template-columns:1fr}.tf-site-footer__credential{min-height:auto}.tf-site-footer__bottom{align-items:flex-start;flex-direction:column}.tf-site-footer__legal{justify-content:flex-start}}",
      "@media(prefers-reduced-motion:reduce){.tf-site-footer__link,.tf-site-footer__cta{transition:none}}",
      "@media print{.tf-site-footer{color:#111827;background:#fff;border-top:1px solid #cbd5e1;box-shadow:none}.tf-site-footer__title,.tf-site-footer__heading{color:#111827}.tf-site-footer__description,.tf-site-footer__link,.tf-site-footer__contact p,.tf-site-footer__credential span{color:#334155}}"
    ].join("");
    document.head.appendChild(style);
  }

  function buildFooter() {
    const footer = document.createElement("footer");
    footer.id = FOOTER_ID;
    footer.className = "tf-site-footer";
    footer.setAttribute("aria-label", "Informações institucionais do Teacher Flávio");
    footer.innerHTML = [
      '<div class="tf-site-footer__inner">',
      '  <div class="tf-site-footer__grid">',
      '    <section class="tf-site-footer__brand" aria-labelledby="tf-footer-title">',
      '      <h2 class="tf-site-footer__title" id="tf-footer-title">Teacher Flávio</h2>',
      '      <p class="tf-site-footer__description">Aulas de inglês online e ao vivo, com prática orientada, grupos pequenos e acompanhamento.</p>',
      '      <div class="tf-site-footer__credentials" aria-label="Credenciais profissionais">',
      '        <div class="tf-site-footer__credential"><strong>15+</strong><span>anos ensinando idiomas</span></div>',
      '        <div class="tf-site-footer__credential"><strong>PhD</strong><span>Doutor em Linguística</span></div>',
      '        <div class="tf-site-footer__credential"><strong>CELTA</strong><span>certificação de ensino de inglês</span></div>',
      '      </div>',
      '    </section>',
      '    <nav aria-label="Links do rodapé">',
      '      <h2 class="tf-site-footer__heading">Acesso rápido</h2>',
      '      <div class="tf-site-footer__links">',
      '        <a class="tf-site-footer__link" href="/">Início</a>',
      '        <a class="tf-site-footer__link" href="/curso-de-ingles-online/">Curso de inglês</a>',
      '        <a class="tf-site-footer__link" href="/recursos/">Recursos gratuitos</a>',
      '        <a class="tf-site-footer__link" href="/sobre/">Sobre o Teacher Flávio</a>',
      '        <a class="tf-site-footer__link" href="/area-do-estudante/">Área do Estudante</a>',
      '        <a class="tf-site-footer__link" href="https://www.instagram.com/teacher.flavius" target="_blank" rel="noopener noreferrer">Instagram</a>',
      '      </div>',
      '    </nav>',
      '    <section class="tf-site-footer__contact" aria-labelledby="tf-footer-contact">',
      '      <h2 class="tf-site-footer__heading" id="tf-footer-contact">Fale com o professor</h2>',
      '      <p>Tire suas dúvidas e agende uma aula experimental gratuita.</p>',
      '      <a class="tf-site-footer__cta" href="https://wa.me/5534998349756?text=Ol%C3%A1%2C%20Teacher%21%20Vim%20pelo%20site%20e%20gostaria%20de%20conversar%20sobre%20as%20aulas%20de%20ingl%C3%AAs." target="_blank" rel="noopener noreferrer">Conversar no WhatsApp</a>',
      '    </section>',
      '  </div>',
      '  <div class="tf-site-footer__bottom">',
      '    <p>&copy; <span data-tf-footer-year></span> Teacher Flávio. Todos os direitos reservados.<br>Flávio de Sousa Freitas · Bacharel em Tradução, Mestre e Doutor em Linguística.<br>Desenvolvido por <a href="https://zoqvera.com" target="_blank" rel="noopener noreferrer">Zoqvera</a>.</p>',
      '    <p class="tf-site-footer__legal"><a href="/privacidade/">Privacidade</a><a href="/cookies/">Cookies</a><a href="/termos/">Termos de Uso</a><a href="#" data-tf-open-privacy>Preferências de privacidade</a></p>',
      '  </div>',
      '</div>'
    ].join("");

    footer.querySelector("[data-tf-footer-year]").textContent = String(new Date().getFullYear());
    return footer;
  }

  function mountFooter() {
    if (!document.body) return;
    if (document.getElementById(FOOTER_ID)) {
      loadPaymentNoticeBehavior();
      return;
    }

    installStyles();
    const bodyStyle = window.getComputedStyle(document.body);
    if (bodyStyle.display.indexOf("flex") !== -1 && bodyStyle.flexDirection.indexOf("row") === 0) {
      document.body.classList.add("tf-footer-flex-host");
    }
    document.body.appendChild(buildFooter());
    loadPaymentNoticeBehavior();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountFooter, { once: true });
  } else {
    mountFooter();
  }
})();
