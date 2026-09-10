(function () {
  "use strict";

  var EXPERIMENT_NAME = "cta_copy_v1";
  var EXPERIMENT_KEY = "tf_cro_cta_copy_v1";
  var EXIT_MIN_SECONDS = 5;
  var SCROLL_THRESHOLDS = [25, 50, 75, 90];
  var pageStartedAt = Date.now();
  var whatsappClicked = false;
  var primaryCtaClicked = false;
  var trackedSections = Object.create(null);
  var trackedScroll = Object.create(null);
  var cachedVariant = "";

  function currentPath() {
    return (window.location.pathname || "/").toLowerCase();
  }

  function isHomePage() {
    return currentPath() === "/";
  }

  function isSalesPage() {
    return currentPath().indexOf("/curso-de-ingles-online") === 0;
  }

  function isMarketingPage() {
    var path = currentPath();
    return isHomePage() || isSalesPage() ||
      path.indexOf("/quero-conhecer") === 0 ||
      path.indexOf("/quero_conhecer") === 0 ||
      path.indexOf("/landing-page") === 0;
  }

  if (!isMarketingPage()) return;

  function cleanText(value, maxLength) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, maxLength || 120);
  }

  function safeGet(key) {
    try { return window.localStorage.getItem(key); } catch (error) { return null; }
  }

  function safeSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (error) { /* Storage may be unavailable. */ }
  }

  function queryVariantOverride() {
    try {
      var value = new URLSearchParams(window.location.search || "").get("cro_variant");
      return value === "a" || value === "b" ? value : "";
    } catch (error) {
      return "";
    }
  }

  function getVariant() {
    if (!isSalesPage()) return "not_applicable";
    if (cachedVariant) return cachedVariant;

    var override = queryVariantOverride();
    if (override) {
      cachedVariant = override;
      return cachedVariant;
    }

    var stored = safeGet(EXPERIMENT_KEY);
    if (stored === "a" || stored === "b") {
      cachedVariant = stored;
      return cachedVariant;
    }

    cachedVariant = Math.random() < 0.5 ? "a" : "b";
    safeSet(EXPERIMENT_KEY, cachedVariant);
    return cachedVariant;
  }

  function track(eventName, params) {
    var payload = Object.assign({
      site_area: "marketing",
      cro_page: isSalesPage() ? "course_sales" : (isHomePage() ? "home" : "marketing"),
      cro_experiment: isSalesPage() ? EXPERIMENT_NAME : "none",
      cro_variant: isSalesPage() ? getVariant() : "not_applicable"
    }, params || {});

    if (window.TeacherAnalytics && typeof window.TeacherAnalytics.track === "function") {
      window.TeacherAnalytics.track(eventName, payload);
      return;
    }
    if (typeof window.gtag === "function") window.gtag("event", eventName, payload);
  }

  function isWhatsappLink(link) {
    if (!link || link.tagName !== "A") return false;
    try {
      var url = new URL(link.getAttribute("href") || "", window.location.href);
      return url.hostname === "wa.me" || url.hostname === "api.whatsapp.com" || /(^|\.)whatsapp\.com$/.test(url.hostname);
    } catch (error) {
      return false;
    }
  }

  function ctaPosition(link) {
    if (!link) return "unknown";
    if (link.id === "teacher-flavius-whatsapp-float") return "floating_whatsapp";
    if (link.closest(".hero")) return "hero";
    if (link.closest(".cro-mid-cta")) return "mid_page";
    if (link.closest(".final-cta") || link.closest(".cta")) return "final_cta";
    if (link.closest("#teacher-flavius-site-footer")) return "footer";
    return "page_link";
  }

  function isPrimaryCta(link) {
    return !!(link && link.classList && link.classList.contains("btn-primary") && isWhatsappLink(link));
  }

  function addStyles() {
    if (document.getElementById("teacher-flavius-cro-styles")) return;
    var style = document.createElement("style");
    style.id = "teacher-flavius-cro-styles";
    style.textContent = [
      ".cro-reassurance{margin:12px 0 0;color:rgba(255,255,255,.78);font-size:.9rem;font-weight:700}",
      ".cro-proof-strip{background:#fff;border-bottom:1px solid rgba(2,16,43,.1)}",
      ".cro-proof-strip__inner{width:min(1120px,calc(100% - 32px));margin:0 auto;padding:18px 0;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}",
      ".cro-proof-item{min-height:58px;display:flex;align-items:center;justify-content:center;padding:10px 12px;border:1px solid rgba(2,16,43,.1);border-radius:14px;background:#f7f9fc;color:#12213b;text-align:center;font-size:.86rem;font-weight:800;line-height:1.35}",
      ".cro-mid-cta{padding:0 0 72px;background:#eef3f9}",
      ".cro-mid-cta__card{width:min(1120px,calc(100% - 32px));margin:0 auto;padding:30px;border:1px solid rgba(2,16,43,.12);border-radius:24px;background:#fff;box-shadow:0 12px 34px rgba(2,16,43,.08);text-align:center}",
      ".cro-mid-cta__card h2{margin:0 auto 10px;max-width:760px;color:#02102b;font-size:clamp(1.55rem,4vw,2.25rem);line-height:1.15}",
      ".cro-mid-cta__card p{margin:0 auto 20px;max-width:720px;color:#64748b}",
      ".cro-mid-cta__secondary{display:block;margin-top:13px;color:#075fae;font-size:.92rem;font-weight:800;text-underline-offset:3px}",
      ".cro-cta-note{margin:12px auto 0!important;color:rgba(255,255,255,.75)!important;font-size:.88rem}",
      "@media(max-width:760px){.cro-proof-strip__inner{grid-template-columns:repeat(2,minmax(0,1fr))}.cro-mid-cta{padding-bottom:58px}}",
      "@media(max-width:420px){.cro-proof-strip__inner{width:min(100% - 24px,1120px);grid-template-columns:1fr}.cro-mid-cta__card{width:min(100% - 24px,1120px);padding:24px 18px}}"
    ].join("");
    document.head.appendChild(style);
  }

  function addSalesReassurance() {
    if (!isSalesPage()) return;

    var actions = document.querySelector(".hero .actions");
    if (actions && !document.getElementById("cro-hero-reassurance")) {
      var note = document.createElement("p");
      note.id = "cro-hero-reassurance";
      note.className = "cro-reassurance";
      note.textContent = "A aula experimental é gratuita e acontece antes de qualquer decisão de matrícula. O agendamento é feito diretamente pelo WhatsApp.";
      actions.insertAdjacentElement("afterend", note);
    }

    var finalCard = document.querySelector(".cta-card");
    if (finalCard && !document.getElementById("cro-final-note")) {
      var finalButton = finalCard.querySelector(".btn-primary");
      if (finalButton) {
        var finalNote = document.createElement("p");
        finalNote.id = "cro-final-note";
        finalNote.className = "cro-cta-note";
        finalNote.textContent = "Sem matrícula prévia para experimentar. Você consulta horários e vagas antes de decidir.";
        finalButton.insertAdjacentElement("afterend", finalNote);
      }
    }
  }

  function addProofStrip() {
    if (!isSalesPage() || document.getElementById("cro-proof-strip")) return;
    var hero = document.querySelector(".hero");
    if (!hero) return;

    var strip = document.createElement("section");
    strip.id = "cro-proof-strip";
    strip.className = "cro-proof-strip";
    strip.setAttribute("aria-label", "Credenciais e condições do curso");
    strip.innerHTML = [
      '<div class="cro-proof-strip__inner">',
      '<div class="cro-proof-item">Aula experimental gratuita</div>',
      '<div class="cro-proof-item">Mais de 15 anos de experiência</div>',
      '<div class="cro-proof-item">Certificação CELTA</div>',
      '<div class="cro-proof-item">Turmas de até 4 alunos</div>',
      '</div>'
    ].join("");
    hero.insertAdjacentElement("afterend", strip);
  }

  function addMidPageCta() {
    if (!isSalesPage() || document.getElementById("cro-mid-cta")) return;
    var groupsSection = document.querySelector('section[aria-labelledby="groups-title"]');
    if (!groupsSection) return;

    var section = document.createElement("section");
    section.id = "cro-mid-cta";
    section.className = "cro-mid-cta";
    section.setAttribute("aria-label", "Agendar aula experimental");
    section.innerHTML = [
      '<div class="cro-mid-cta__card">',
      '<h2>Você pode experimentar o formato antes de se matricular.</h2>',
      '<p>Faça uma aula experimental gratuita, tire suas dúvidas diretamente com o professor e consulte os horários disponíveis.</p>',
      '<a class="btn btn-primary" href="https://wa.me/5534998349756?text=Ol%C3%A1%2C%20gostaria%20de%20marcar%20uma%20aula%20experimental." target="_blank" rel="noopener noreferrer">AGENDAR AULA EXPERIMENTAL GRATUITA</a>',
      '<a class="cro-mid-cta__secondary" href="/#aula-gratuita">Prefere assistir primeiro? Veja uma aula gratuita.</a>',
      '</div>'
    ].join("");
    groupsSection.insertAdjacentElement("afterend", section);
  }

  function applyCtaExperiment() {
    if (!isSalesPage()) return;
    var variant = getVariant();
    var buttons = Array.prototype.slice.call(document.querySelectorAll('a.btn-primary[href*="wa.me/"]'));
    var eligible = buttons.filter(function (button) {
      return /AULA EXPERIMENTAL|AULA GRATUITA/i.test(button.textContent || "");
    });
    if (!eligible.length) return;

    eligible.forEach(function (button) {
      button.setAttribute("data-cro-experiment", EXPERIMENT_NAME);
      button.setAttribute("data-cro-variant", variant);
      if (variant === "b") button.textContent = "QUERO FAZER UMA AULA GRATUITA";
    });

    track("cro_experiment_exposure", {
      experiment_name: EXPERIMENT_NAME,
      experiment_variant: variant,
      experiment_element: "primary_cta_copy",
      eligible_ctas: eligible.length
    });
  }

  function trackSection(name, element) {
    if (!element || trackedSections[name]) return;
    trackedSections[name] = true;
    track("cro_section_view", { section_name: name });
  }

  function installSectionTracking() {
    var candidates = [];

    function add(name, selector) {
      var element = document.querySelector(selector);
      if (element) candidates.push({ name: name, element: element });
    }

    add("hero", ".hero");
    add("price", isSalesPage() ? ".hero-card" : ".offer");
    add("course_benefits", isSalesPage() ? 'section[aria-labelledby="included-title"]' : 'section[aria-labelledby="benefits-title"]');
    add("teacher_authority", 'section[aria-labelledby="teacher-title"]');
    add("credibility_strip", "#cro-proof-strip");
    add("mid_page_cta", "#cro-mid-cta");
    add("free_class_video", "#aula-gratuita");
    add("objections_faq", ".faq, section[aria-labelledby=\"faq-title\"]");
    add("final_cta", ".final-cta, .cta");

    if (!("IntersectionObserver" in window)) {
      candidates.forEach(function (item) { trackSection(item.name, item.element); });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting || entry.intersectionRatio < 0.35) return;
        var item = candidates.find(function (candidate) { return candidate.element === entry.target; });
        if (!item) return;
        trackSection(item.name, item.element);
        observer.unobserve(entry.target);
      });
    }, { threshold: [0.35] });

    candidates.forEach(function (item) { observer.observe(item.element); });
  }

  function scrollDepth() {
    var doc = document.documentElement;
    var body = document.body;
    var scrollTop = window.scrollY || doc.scrollTop || 0;
    var viewport = window.innerHeight || doc.clientHeight || 0;
    var fullHeight = Math.max(
      body ? body.scrollHeight : 0,
      doc.scrollHeight,
      body ? body.offsetHeight : 0,
      doc.offsetHeight
    );
    if (fullHeight <= viewport) return 100;
    return Math.min(100, Math.round(((scrollTop + viewport) / fullHeight) * 100));
  }

  var scrollTicking = false;
  function inspectScrollDepth() {
    scrollTicking = false;
    var depth = scrollDepth();
    SCROLL_THRESHOLDS.forEach(function (threshold) {
      if (depth < threshold || trackedScroll[threshold]) return;
      trackedScroll[threshold] = true;
      track("cro_scroll_depth", { percent_scrolled: threshold });
    });
  }

  function installScrollTracking() {
    window.addEventListener("scroll", function () {
      if (scrollTicking) return;
      scrollTicking = true;
      window.requestAnimationFrame(inspectScrollDepth);
    }, { passive: true });
    inspectScrollDepth();
  }

  function installClickTracking() {
    document.addEventListener("click", function (event) {
      var link = event.target && event.target.closest ? event.target.closest("a[href]") : null;
      if (!link) return;

      if (isWhatsappLink(link)) {
        whatsappClicked = true;
        var primary = isPrimaryCta(link);
        if (primary) primaryCtaClicked = true;
        track(primary ? "cro_primary_cta_click" : "cro_whatsapp_click", {
          cta_position: ctaPosition(link),
          cta_text: cleanText(link.textContent || link.getAttribute("aria-label"), 100),
          experiment_name: isSalesPage() && primary ? EXPERIMENT_NAME : "none",
          experiment_variant: isSalesPage() && primary ? getVariant() : "not_applicable"
        });
        return;
      }

      if (link.matches && link.matches(".cro-mid-cta__secondary")) {
        track("cro_secondary_cta_click", {
          cta_position: "mid_page",
          cta_text: cleanText(link.textContent, 100),
          destination: "free_class_video"
        });
      }
    }, true);
  }

  function installExitTracking() {
    window.addEventListener("pagehide", function () {
      var seconds = Math.round((Date.now() - pageStartedAt) / 1000);
      if (whatsappClicked || seconds < EXIT_MIN_SECONDS) return;
      track("cro_no_cta_exit", {
        time_on_page_seconds: seconds,
        max_scroll_percent: scrollDepth(),
        primary_cta_clicked: primaryCtaClicked,
        transport_type: "beacon"
      });
    });
  }

  function init() {
    addStyles();
    addSalesReassurance();
    addProofStrip();
    addMidPageCta();
    applyCtaExperiment();
    installClickTracking();
    installSectionTracking();
    installScrollTracking();
    installExitTracking();

    track("cro_page_view", {
      experiment_name: isSalesPage() ? EXPERIMENT_NAME : "none",
      experiment_variant: isSalesPage() ? getVariant() : "not_applicable"
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
