(function () {
  "use strict";

  const STAR_PATH = "m12 2.5 2.9 5.88 6.49.94-4.7 4.58 1.11 6.47L12 17.32l-5.8 3.05 1.11-6.47-4.7-4.58 6.49-.94Z";

  function createStar(empty) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    if (empty) svg.dataset.empty = "true";

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", STAR_PATH);
    svg.appendChild(path);
    return svg;
  }

  function createStars(rating) {
    const wrapper = document.createElement("span");
    wrapper.className = "student-review-stars";
    wrapper.setAttribute("aria-label", String(rating) + " de 5 estrelas");

    for (let index = 1; index <= 5; index += 1) {
      wrapper.appendChild(createStar(index > Number(rating)));
    }
    return wrapper;
  }

  function createVerifiedBadge() {
    const badge = document.createElement("span");
    badge.className = "student-review-verified";

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "m5 12 4 4L19 6");
    svg.appendChild(path);

    const label = document.createElement("span");
    label.textContent = "Aluno verificado";

    badge.appendChild(svg);
    badge.appendChild(label);
    return badge;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).format(date);
  }

  function createReviewCard(review) {
    const card = document.createElement("article");
    card.className = "student-review-card";

    const head = document.createElement("div");
    head.className = "student-review-card-head";

    const name = document.createElement("div");
    name.className = "student-review-name";
    const strong = document.createElement("strong");
    strong.textContent = review.display_name || "Aluno";
    name.appendChild(strong);

    if (review.verified_student === true) {
      name.appendChild(createVerifiedBadge());
    }

    head.appendChild(name);
    head.appendChild(createStars(review.rating));

    const comment = document.createElement("p");
    comment.className = "student-review-comment";
    comment.textContent = review.comment || "";

    const date = document.createElement("p");
    date.className = "student-review-date";
    const formattedDate = formatDate(review.submitted_at);
    date.textContent = formattedDate ? "Comentário enviado em " + formattedDate : "";

    card.appendChild(head);
    card.appendChild(comment);
    card.appendChild(date);
    return card;
  }

  function renderSummary(section, payload) {
    const summary = section.querySelector("[data-student-review-summary]");
    const average = section.querySelector("[data-student-review-average]");
    const count = section.querySelector("[data-student-review-count]");
    const total = Number(payload.total_reviews || 0);

    if (!summary || !average || !count || total <= 0) {
      if (summary) summary.hidden = true;
      return;
    }

    average.textContent = Number(payload.average_rating || 0).toLocaleString("pt-BR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    });
    count.textContent = total + (total === 1 ? " avaliação" : " avaliações");
    summary.hidden = false;
  }

  function renderReviews(section, payload) {
    const list = section.querySelector("[data-student-review-list]");
    if (!list) return;

    const reviews = Array.isArray(payload.reviews) ? payload.reviews : [];
    list.textContent = "";

    if (!reviews.length) {
      const empty = document.createElement("p");
      empty.className = "student-reviews-empty";
      empty.textContent = "As avaliações dos alunos aparecerão aqui após a publicação.";
      list.appendChild(empty);
      renderSummary(section, payload);
      return;
    }

    reviews.forEach(function (review) {
      list.appendChild(createReviewCard(review));
    });
    renderSummary(section, payload);
  }

  async function fetchReviews(lessonType) {
    const config = window.SUPABASE_CONFIG;
    if (!config || !config.url || !config.anonKey) {
      throw new Error("Configuração de avaliações indisponível.");
    }

    const response = await fetch(
      config.url + "/rest/v1/rpc/get_public_student_reviews",
      {
        method: "POST",
        cache: "no-store",
        headers: {
          apikey: config.anonKey,
          Authorization: "Bearer " + config.anonKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ target_lesson_type: lessonType })
      }
    );

    if (!response.ok) throw new Error("Não foi possível consultar as avaliações.");
    const payload = await response.json();
    return Array.isArray(payload) ? (payload[0] || {}) : (payload || {});
  }

  function loadSection(section) {
    const lessonType = section.dataset.lessonType;
    if (lessonType !== "group" && lessonType !== "individual") return;

    fetchReviews(lessonType)
      .then(function (payload) {
        renderReviews(section, payload);
      })
      .catch(function () {
        const list = section.querySelector("[data-student-review-list]");
        if (!list) return;
        list.textContent = "";
        const empty = document.createElement("p");
        empty.className = "student-reviews-empty";
        empty.textContent = "Não foi possível carregar as avaliações agora.";
        list.appendChild(empty);
      });
  }

  document.querySelectorAll("[data-student-reviews]").forEach(loadSection);
})();
