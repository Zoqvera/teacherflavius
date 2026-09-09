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

  function renderVacancies(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      summary.textContent = "No momento, não há turmas em grupo dentro dos critérios de exibição com vagas abertas.";
      list.innerHTML = '<div class="home-vacancies-empty">Novas vagas aparecem aqui automaticamente conforme as turmas são atualizadas.</div>';
      return;
    }

    const totalSpots = rows.reduce((sum, row) => sum + Number(row.available_spots || 0), 0);
    summary.textContent = `${rows.length} ${rows.length === 1 ? "turma com vaga" : "turmas com vagas"} · ${totalSpots} ${totalSpots === 1 ? "vaga disponível" : "vagas disponíveis"}.`;

    list.innerHTML = rows.map((row) => {
      const spots = Number(row.available_spots || 0);
      return '<article class="home-vacancy-item">' +
        '<div><strong>' + escapeHtml(formatWeekday(row.class_weekday)) + '</strong><span>' + escapeHtml(formatTime(row.class_start_time)) + ' · aula de 60 minutos</span></div>' +
        '<div class="home-vacancy-count"><b>' + spots + '</b><span>' + (spots === 1 ? 'vaga' : 'vagas') + '</span></div>' +
      '</article>';
    }).join("");
  }

  async function fetchVacancies() {
    const config = window.SUPABASE_CONFIG;
    if (!config || !config.url || !config.anonKey) {
      throw new Error("Configuração de vagas indisponível");
    }

    const response = await fetch(`${config.url}/rest/v1/rpc/get_public_quartet_vacancies`, {
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
