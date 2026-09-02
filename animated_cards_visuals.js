(function () {
  "use strict";

  const CARD_SELECTOR = ".menu-button, .student-card, .professor-button";
  const PARTICLE_COUNT = 80;
  const RIPPLE_DURATION_MS = 600;

  function injectBackground() {
    if (!document.getElementById("particles")) {
      const canvas = document.createElement("canvas");
      canvas.id = "particles";
      document.body.insertBefore(canvas, document.body.firstChild);
    }

    if (!document.querySelector(".aurora")) {
      const aurora = document.createElement("div");
      aurora.className = "aurora";

      for (let index = 0; index < 2; index += 1) {
        const blob = document.createElement("div");
        blob.className = "aurora-blob";
        aurora.appendChild(blob);
      }

      document.body.insertBefore(aurora, document.body.firstChild);
    }
  }

  function initParticles() {
    const canvas = document.getElementById("particles");
    if (!canvas || canvas.dataset.initialized === "true") return;
    canvas.dataset.initialized = "true";

    const context = canvas.getContext("2d");
    let width;
    let height;

    function resize() {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    }

    function createParticle() {
      const particle = {};

      function reset(initialPosition) {
        particle.x = Math.random() * width;
        particle.y = initialPosition ? Math.random() * height : height + 8;
        particle.radius = Math.random() * 1.6 + 0.3;
        particle.velocityY = -(Math.random() * 0.45 + 0.15);
        particle.velocityX = (Math.random() - 0.5) * 0.25;
        particle.alpha = 0;
        particle.maxAlpha = Math.random() * 0.5 + 0.08;
        particle.fadingIn = true;
        particle.hue = Math.random() > 0.5 ? 238 : 260;
      }

      particle.update = function () {
        particle.y += particle.velocityY;
        particle.x += particle.velocityX;

        if (particle.fadingIn) {
          particle.alpha += 0.007;
          if (particle.alpha >= particle.maxAlpha) particle.fadingIn = false;
        } else {
          particle.alpha -= 0.003;
        }

        if (particle.alpha <= 0 || particle.y < -8) reset(false);
      };

      particle.draw = function () {
        context.beginPath();
        context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        context.fillStyle = "hsla(" + particle.hue + ",80%,75%," + particle.alpha + ")";
        context.fill();
      };

      reset(true);
      return particle;
    }

    resize();
    window.addEventListener("resize", resize);

    const particles = Array.from({ length: PARTICLE_COUNT }, createParticle);

    function renderFrame() {
      context.clearRect(0, 0, width, height);
      particles.forEach(function (particle) {
        particle.update();
        particle.draw();
      });
      window.requestAnimationFrame(renderFrame);
    }

    renderFrame();
  }

  function bindRipple(element) {
    if (element.dataset.animatedCardsBound === "true") return;
    element.dataset.animatedCardsBound = "true";

    element.addEventListener("click", function (event) {
      const rect = element.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const ripple = document.createElement("span");

      ripple.className = "ripple";
      ripple.style.cssText = [
        "width:" + size + "px",
        "height:" + size + "px",
        "left:" + (event.clientX - rect.left - size / 2) + "px",
        "top:" + (event.clientY - rect.top - size / 2) + "px"
      ].join(";");

      element.appendChild(ripple);
      window.setTimeout(function () {
        ripple.remove();
      }, RIPPLE_DURATION_MS);
    });
  }

  function refresh() {
    document.querySelectorAll(CARD_SELECTOR).forEach(bindRipple);
  }

  function initialize() {
    injectBackground();
    initParticles();
    refresh();
  }

  window.AnimatedCardsVisuals = Object.freeze({
    initialize: initialize,
    refresh: refresh
  });
})();
