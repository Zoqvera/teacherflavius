(function () {
  "use strict";

  const list = document.getElementById("homeVacanciesList");
  const summary = document.getElementById("homeVacanciesSummary");
  if (!list || !summary) return;

  const WEEKDAYS = Object.freeze({
    1: "Segunda-feira",
    2: "Terça-feira",
    3: "Quarta-feira",
    4: "Quinta-feira",
    5: "Sexta-feira",
    6: "Sábado",
    7: "Domingo"
  });

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatWeekday(value) {
    return WEEKDAYS[Number(value)] || "Dia a confirmar";
  }

  function formatTime(value) {
    const match = String(value || "").match(/^(\d{2}):(\d{2})/);
    if (!match) return "horário a confirmar";

    const hour = Number(match[1]);
    const minute = Number(match[2]);
    return minute === 0 ? `${hour}h` : `${hour}h${String(minute).padStart(2, "0")}`;
  }

  function isSoldOut(row) {
    return row && (row.sold_out === true || String(row.sold_out).toLowerCase() === "true");
  }

  function classLabel(row) {
    return row && row.class_type === "individual" ? "Aula individual" : "Turma em grupo";
  }

  function renderSummary(rows) {
    const availableRows = rows.filter((row) => !isSoldOut(row));
    const soldOutRows = rows.filter(isSoldOut);
    const availableSpots = availableRows.reduce(
      (sum, row) => sum + Number(row.available_spots || 0),
      0
    );

    const availableText = `${availableRows.length} ${availableRows.length === 1 ? "turma disponível" : "turmas disponíveis"}`;
    const spotsText = `${availableSpots} ${availableSpots === 1 ? "vaga" : "vagas"}`;
    const soldOutText = `${soldOutRows.length} ${soldOutRows.length === 1 ? "turma com vagas esgotadas" : "turmas com vagas esgotadas"}`;

    summary.textContent = `${availableText} · ${spotsText} · ${soldOutText}.`;
  }

  function renderClassCard(row) {
    const soldOut = isSoldOut(row);
    const spots = soldOut ? 0 : Number(row.available_spots || 0);
    const ribbon = soldOut
      ? '<span class="home-vacancy-ribbon" aria-label="Vagas esgotadas">VAGAS ESGOTADAS</span>'
      : "";
    const cardClass = soldOut ? "home-vacancy-item is-sold-out" : "home-vacancy-item";

    return '<article class="' + cardClass + '">' +
      ribbon +
      '<div class="home-vacancy-details"><strong>' + escapeHtml(formatWeekday(row.class_weekday)) + '</strong>' +
      '<span>' + escapeHtml(formatTime(row.class_start_time)) + ' · aula de 60 minutos · ' + escapeHtml(classLabel(row)) + '</span></div>' +
      '<div class="home-vacancy-count"><b>' + spots + '</b><span>' + (spots === 1 ? 'vaga' : 'vagas') + '</span></div>' +
    '</article>';
  }

  function renderVacancies(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      summary.textContent = "No momento, não há turmas cadastradas para exibição.";
      list.innerHTML = '<div class="home-vacancies-empty">A disponibilidade será exibida aqui quando houver turmas cadastradas.</div>';
      return;
    }

    renderSummary(rows);
    list.innerHTML = rows.map(renderClassCard).join("");
  }

  async function fetchVacancies() {
    const config = window.SUPABASE_CONFIG;
    if (!config || !config.url || !config.anonKey) {
      throw new Error("Configuração de vagas indisponível");
    }

    const response = await fetch(`${config.url}/rest/v1/rpc/get_public_course_vacancies`, {
      method: "POST",
      cache: "no-store",
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`,
        "Content-Type": "application/json"
      },
      body: "{}"
    });

    if (!response.ok) throw new Error("Não foi possível consultar as vagas");
    return response.json();
  }

  fetchVacancies()
    .then(renderVacancies)
    .catch(() => {
      summary.textContent = "As vagas são atualizadas automaticamente a partir das matrículas registradas no sistema.";
      list.innerHTML = '<div class="home-vacancies-empty">Não foi possível carregar a disponibilidade agora. Consulte os horários pelo WhatsApp.</div>';
    });
})();
