(function () {
  var classTypeCache = null;
  var classTypeLoading = false;
  var classTypeWaitPending = false;
  const CLASS_TYPE_RETRY_DELAY_MS = 250;

  function injectBackground() {
    if (!document.getElementById("particles")) {
      var canvas = document.createElement("canvas");
      canvas.id = "particles";
      document.body.insertBefore(canvas, document.body.firstChild);
    }

    if (!document.querySelector(".aurora")) {
      var aurora = document.createElement("div");
      aurora.className = "aurora";
      aurora.innerHTML = '<div class="aurora-blob"></div><div class="aurora-blob"></div>';
      document.body.insertBefore(aurora, document.body.firstChild);
    }
  }

  function loadClassRecordedLessonsExtension() {
    if (document.querySelector('script[src^="class_recorded_lessons.js"]')) return;
    var script = document.createElement("script");
    script.src = "class_recorded_lessons.js?v=20260429-1";
    script.defer = true;
    document.body.appendChild(script);
  }

  function loadGlobalLogout() {
    if (window.teacherFlavioGlobalLogoutLoaded) return;
    if (document.querySelector('script[src^="/global_logout.js"], script[src^="global_logout.js"]')) return;
    var script = document.createElement("script");
    script.src = "/global_logout.js?v=20260716-1";
    script.defer = true;
    document.body.appendChild(script);
  }

  function initParticles() {
    var canvas = document.getElementById("particles");
    if (!canvas || canvas.dataset.initialized === "true") return;
    canvas.dataset.initialized = "true";

    var ctx = canvas.getContext("2d");
    var W, H;

    function resize() {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
    }

    resize();
    window.addEventListener("resize", resize);

    var particles = Array.from({ length: 80 }, function () {
      var p = {};

      function reset(init) {
        p.x = Math.random() * W;
        p.y = init ? Math.random() * H : H + 8;
        p.r = Math.random() * 1.6 + 0.3;
        p.vy = -(Math.random() * 0.45 + 0.15);
        p.vx = (Math.random() - 0.5) * 0.25;
        p.alpha = 0;
        p.max = Math.random() * 0.5 + 0.08;
        p.fin = true;
        p.hue = Math.random() > 0.5 ? 238 : 260;
        p.reset = reset;
      }

      reset(true);

      p.update = function () {
        p.y += p.vy;
        p.x += p.vx;
        if (p.fin) {
          p.alpha += 0.007;
          if (p.alpha >= p.max) p.fin = false;
        } else {
          p.alpha -= 0.003;
        }
        if (p.alpha <= 0 || p.y < -8) p.reset(false);
      };

      p.draw = function () {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = "hsla(" + p.hue + ",80%,75%," + p.alpha + ")";
        ctx.fill();
      };

      return p;
    });

    function loop() {
      ctx.clearRect(0, 0, W, H);
      particles.forEach(function (p) {
        p.update();
        p.draw();
      });
      requestAnimationFrame(loop);
    }

    loop();
  }

  function initTiltAndRipple() {
    document.querySelectorAll(".menu-button, .student-card, .professor-button").forEach(function (el) {
      if (el.dataset.animatedCardsBound === "true") return;
      el.dataset.animatedCardsBound = "true";

      el.addEventListener("click", function (event) {
        var rect = el.getBoundingClientRect();
        var size = Math.max(rect.width, rect.height);
        var ripple = document.createElement("span");
        ripple.className = "ripple";
        ripple.style.cssText = "width:" + size + "px;height:" + size + "px;left:" + (event.clientX - rect.left - size / 2) + "px;top:" + (event.clientY - rect.top - size / 2) + "px";
        el.appendChild(ripple);
        setTimeout(function () { ripple.remove(); }, 600);
      });
    });
  }

  function isClassBoardPage() {
    return /(^|\/)quadro-de-turmas\.html$/.test(window.location.pathname);
  }

  function getClassTypeVisual(value) {
    if (value === "quartet" || value === "group") return { label: "QUARTETO", color: "#bfdbfe", background: "rgba(59,130,246,.15)", border: "rgba(96,165,250,.35)" };
    if (value === "individual") return { label: "INDIVIDUAL", color: "#d8b4fe", background: "rgba(168,85,247,.14)", border: "rgba(192,132,252,.35)" };
    if (value === "eight_students") return { label: "8 ALUNOS", color: "#a7f3d0", background: "rgba(16,185,129,.14)", border: "rgba(52,211,153,.35)" };
    return { label: "TIPO NÃO DEFINIDO", color: "#fde68a", background: "rgba(245,158,11,.12)", border: "rgba(251,191,36,.30)" };
  }

  function annotateClassTypeBadges() {
    if (!isClassBoardPage() || !classTypeCache) return;

    document.querySelectorAll('.class-item[href*="turma.html?id="]').forEach(function (card) {
      var generated = card.querySelector(".generated-class-type-badge");
      var official = card.querySelector(".class-type-badge");
      if (official) {
        if (generated) generated.remove();
        return;
      }

      var title = card.querySelector(".class-title");
      if (!title) return;

      var classNumber = null;
      try {
        classNumber = Number(new URL(card.getAttribute("href"), window.location.href).searchParams.get("id"));
      } catch (error) {}
      if (!Number.isFinite(classNumber)) return;

      var row = classTypeCache.get(classNumber);
      var typeValue = row && row.class_type ? row.class_type : "unset";
      var existing = title.querySelector(".generated-class-type-badge");
      if (existing && existing.dataset.classType === typeValue) return;
      if (existing) existing.remove();

      var visual = getClassTypeVisual(row ? row.class_type : null);
      var badge = document.createElement("span");
      badge.className = "generated-class-type-badge";
      badge.dataset.classType = typeValue;
      badge.textContent = visual.label;
      badge.style.cssText = "display:inline-flex;margin-left:7px;vertical-align:middle;border-radius:999px;padding:3px 7px;font-size:9px;font-weight:bold;letter-spacing:.4px;color:" + visual.color + ";background:" + visual.background + ";border:1px solid " + visual.border + ";";
      title.appendChild(badge);
    });
  }

  function classTypeDependenciesReady() {
    return !!(window.Auth && window.SUPABASE_CONFIG && Auth.isConfigured());
  }

  async function waitForClassTypeDependencies() {
    const waiter = window.ResourceWaiter;
    if (waiter && typeof waiter.waitUntil === "function") {
      return waiter.waitUntil(classTypeDependenciesReady, {
        maxAttempts: null,
        delayMs: CLASS_TYPE_RETRY_DELAY_MS
      });
    }

    await new Promise(function (resolve) {
      window.setTimeout(resolve, CLASS_TYPE_RETRY_DELAY_MS);
    });
    return classTypeDependenciesReady();
  }

  async function loadClassTypeBadges() {
    if (!isClassBoardPage() || classTypeCache || classTypeLoading) {
      annotateClassTypeBadges();
      return;
    }

    if (!classTypeDependenciesReady()) {
      if (classTypeWaitPending) return;

      classTypeWaitPending = true;
      let dependenciesReady = false;
      try {
        dependenciesReady = await waitForClassTypeDependencies();
        if (dependenciesReady) {
          await loadClassTypeBadges();
          return;
        }
      } finally {
        classTypeWaitPending = false;
      }

      loadClassTypeBadges();
      return;
    }

    classTypeLoading = true;
    try {
      var response = await Auth.getClient().rpc("get_teacher_classes_with_type");
      if (response.error) throw response.error;
      classTypeCache = new Map((response.data || []).map(function (row) {
        return [Number(row.class_number), row];
      }));
      annotateClassTypeBadges();
    } catch (error) {
      console.error("Não foi possível carregar etiquetas das turmas:", error);
    } finally {
      classTypeLoading = false;
    }
  }

  function init() {
    injectBackground();
    loadClassRecordedLessonsExtension();
    loadGlobalLogout();
    initParticles();
    initTiltAndRipple();
    loadClassTypeBadges();

    var observer = new MutationObserver(function () {
      initTiltAndRipple();
      if (classTypeCache) annotateClassTypeBadges();
      else loadClassTypeBadges();
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
