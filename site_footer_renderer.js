(function () {
  "use strict";

  const FOOTER_ID = "teacher-flavius-site-footer";
  const STYLE_ID = "teacher-flavius-site-footer-styles";
  const FOOTER_LINKS = Object.freeze([
    Object.freeze({ href: "/", label: "Início" }),
    Object.freeze({ href: "/curso-de-ingles-online/", label: "Curso de inglês" }),
    Object.freeze({ href: "/recursos/", label: "Recursos gratuitos" }),
    Object.freeze({ href: "/sobre/", label: "Sobre o Teacher Flávio" }),
    Object.freeze({ href: "/area-do-estudante/", label: "Área do Estudante" }),
    Object.freeze({
      href: "https://www.instagram.com/teacher.flavius",
      label: "Instagram",
      external: true
    })
  ]);
  const LEGAL_LINKS = Object.freeze([
    Object.freeze({ href: "/privacidade/", label: "Privacidade" }),
    Object.freeze({ href: "/cookies/", label: "Cookies" }),
    Object.freeze({ href: "/termos/", label: "Termos de Uso" })
  ]);
  const CREDENTIALS = Object.freeze([
    Object.freeze({ value: "15+", label: "anos ensinando idiomas" }),
    Object.freeze({ value: "PhD", label: "Doutor em Linguística" }),
    Object.freeze({ value: "CELTA", label: "certificação de ensino de inglês" })
  ]);
  const WHATSAPP_URL = "https://wa.me/5534998349756?text=Ol%C3%A1%2C%20Teacher%21%20Vim%20pelo%20site%20e%20gostaria%20de%20conversar%20sobre%20as%20aulas%20de%20ingl%C3%AAs.";

  function createElement(tagName, options) {
    const settings = options || {};
    const element = document.createElement(tagName);
    if (settings.id) element.id = settings.id;
    if (settings.className) element.className = settings.className;
    if (settings.text !== undefined) element.textContent = settings.text;
    return element;
  }

  function configureExternalLink(link) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
  }

  function createLink(href, label, className, external) {
    const link = createElement("a", { className: className, text: label });
    link.href = href;
    return external ? configureExternalLink(link) : link;
  }

  function createCredential(value, label) {
    const credential = createElement("div", { className: "tf-site-footer__credential" });
    credential.appendChild(createElement("strong", { text: value }));
    credential.appendChild(createElement("span", { text: label }));
    return credential;
  }

  function createBrandSection() {
    const section = createElement("section", { className: "tf-site-footer__brand" });
    section.setAttribute("aria-labelledby", "tf-footer-title");
    section.appendChild(createElement("h2", {
      id: "tf-footer-title",
      className: "tf-site-footer__title",
      text: "Teacher Flávio"
    }));
    section.appendChild(createElement("p", {
      className: "tf-site-footer__description",
      text: "Aulas de inglês online e ao vivo, com prática orientada, grupos pequenos e acompanhamento."
    }));

    const credentials = createElement("div", { className: "tf-site-footer__credentials" });
    credentials.setAttribute("aria-label", "Credenciais profissionais");
    CREDENTIALS.forEach(function (credential) {
      credentials.appendChild(createCredential(credential.value, credential.label));
    });
    section.appendChild(credentials);
    return section;
  }

  function createQuickLinksNavigation() {
    const navigation = createElement("nav");
    navigation.setAttribute("aria-label", "Links do rodapé");
    navigation.appendChild(createElement("h2", {
      className: "tf-site-footer__heading",
      text: "Acesso rápido"
    }));

    const links = createElement("div", { className: "tf-site-footer__links" });
    FOOTER_LINKS.forEach(function (item) {
      links.appendChild(createLink(item.href, item.label, "tf-site-footer__link", item.external));
    });
    navigation.appendChild(links);
    return navigation;
  }

  function createContactSection() {
    const section = createElement("section", { className: "tf-site-footer__contact" });
    section.setAttribute("aria-labelledby", "tf-footer-contact");
    section.appendChild(createElement("h2", {
      id: "tf-footer-contact",
      className: "tf-site-footer__heading",
      text: "Fale com o professor"
    }));
    section.appendChild(createElement("p", {
      text: "Tire suas dúvidas e agende uma aula experimental gratuita."
    }));
    section.appendChild(createLink(
      WHATSAPP_URL,
      "Conversar no WhatsApp",
      "tf-site-footer__cta",
      true
    ));
    return section;
  }

  function appendLineBreak(parent) {
    parent.appendChild(document.createElement("br"));
  }

  function createCopyrightText() {
    const paragraph = createElement("p");
    paragraph.appendChild(document.createTextNode("© "));
    paragraph.appendChild(createElement("span", {
      className: "",
      text: String(new Date().getFullYear())
    }));
    paragraph.lastChild.setAttribute("data-tf-footer-year", "");
    paragraph.appendChild(document.createTextNode(" Teacher Flávio. Todos os direitos reservados."));
    appendLineBreak(paragraph);
    paragraph.appendChild(document.createTextNode("Flávio de Sousa Freitas · Bacharel em Tradução, Mestre e Doutor em Linguística."));
    appendLineBreak(paragraph);
    paragraph.appendChild(document.createTextNode("Desenvolvido por "));
    paragraph.appendChild(createLink("https://zoqvera.com", "Zoqvera", "", true));
    paragraph.appendChild(document.createTextNode("."));
    return paragraph;
  }

  function createLegalLinks() {
    const paragraph = createElement("p", { className: "tf-site-footer__legal" });
    LEGAL_LINKS.forEach(function (item) {
      paragraph.appendChild(createLink(item.href, item.label));
    });
    const privacyPreferences = createLink("#", "Preferências de privacidade");
    privacyPreferences.setAttribute("data-tf-open-privacy", "");
    paragraph.appendChild(privacyPreferences);
    return paragraph;
  }

  function createFooterBottom() {
    const bottom = createElement("div", { className: "tf-site-footer__bottom" });
    bottom.appendChild(createCopyrightText());
    bottom.appendChild(createLegalLinks());
    return bottom;
  }

  function buildFooter() {
    const footer = createElement("footer", {
      id: FOOTER_ID,
      className: "tf-site-footer"
    });
    footer.setAttribute("aria-label", "Informações institucionais do Teacher Flávio");

    const inner = createElement("div", { className: "tf-site-footer__inner" });
    const grid = createElement("div", { className: "tf-site-footer__grid" });
    grid.appendChild(createBrandSection());
    grid.appendChild(createQuickLinksNavigation());
    grid.appendChild(createContactSection());
    inner.appendChild(grid);
    inner.appendChild(createFooterBottom());
    footer.appendChild(inner);
    return footer;
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

  window.SiteFooterRenderer = Object.freeze({
    footerId: FOOTER_ID,
    installStyles: installStyles,
    buildFooter: buildFooter
  });
})();
