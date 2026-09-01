(function () {
  "use strict";

  var attributionStudents = [];
  var recentLeadRows = [];

  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  async function waitForAuth() {
    for (var i = 0; i < 30; i++) {
      if (window.Auth && Auth.getClient && Auth.getSession && Auth.isConfigured && Auth.isConfigured()) return true;
      await sleep(100);
    }
    return !!(window.Auth && Auth.getClient && Auth.getSession && Auth.isConfigured && Auth.isConfigured());
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function number(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function percent(value) {
    return number(value).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 1 }) + "%";
  }

  function currency(value) {
    return number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function sourceLabel(value) {
    var labels = {
      chatgpt: "ChatGPT",
      perplexity: "Perplexity",
      gemini: "Gemini",
      copilot: "Microsoft Copilot",
      claude: "Claude",
      google: "Google",
      bing: "Bing",
      instagram: "Instagram",
      facebook: "Facebook",
      direct: "Acesso direto"
    };
    var key = String(value || "direct").toLowerCase();
    return labels[key] || value || "Acesso direto";
  }

  function ctaLabel(value) {
    var labels = {
      floating_button: "Botão flutuante",
      hero: "CTA principal (hero)",
      final_cta: "CTA final",
      footer: "Rodapé",
      payment_support: "Suporte de pagamento",
      page_link: "Link na página",
      unknown: "Não identificado"
    };
    return labels[value] || value || "Não identificado";
  }

  function formatDate(value) {
    if (!value) return "";
    var parts = String(value).split("-");
    if (parts.length !== 3) return value;
    return parts[2] + "/" + parts[1] + "/" + parts[0];
  }

  function formatDateTime(value) {
    if (!value) return "";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function setText(id, value) {
    var node = document.getElementById(id);
    if (node) node.textContent = String(value);
  }

  function renderTable(rows, bodyId, wrapId, emptyId, rowBuilder) {
    var body = document.getElementById(bodyId);
    var wrap = document.getElementById(wrapId);
    var empty = document.getElementById(emptyId);
    var data = Array.isArray(rows) ? rows : [];
    if (!body || !wrap || !empty) return;
    if (!data.length) {
      body.innerHTML = "";
      wrap.hidden = true;
      empty.hidden = false;
      return;
    }
    body.innerHTML = data.map(rowBuilder).join("");
    wrap.hidden = false;
    empty.hidden = true;
  }

  function renderDaily(rows) {
    var data = Array.isArray(rows) ? rows : [];
    var container = document.getElementById("dailyTrend");
    var empty = document.getElementById("dailyEmpty");
    if (!container || !empty) return;
    if (!data.length) {
      container.innerHTML = "";
      container.hidden = true;
      empty.hidden = false;
      return;
    }

    var maxVisitors = data.reduce(function (max, row) { return Math.max(max, number(row.visitors)); }, 1);
    container.innerHTML = data.map(function (row) {
      var visitors = number(row.visitors);
      var leads = number(row.leads);
      var width = Math.max(2, Math.round((visitors / maxVisitors) * 100));
      return '<div class="trend-row">' +
        '<span>' + escapeHtml(formatDate(row.date)) + '</span>' +
        '<span class="trend-track"><span class="trend-bar" style="width:' + width + '%"></span></span>' +
        '<span class="trend-value">' + visitors + ' vis. · ' + leads + ' clique' + (leads === 1 ? '' : 's') + '</span>' +
      '</div>';
    }).join("");
    container.hidden = false;
    empty.hidden = true;
  }

  function renderSummary(data) {
    data = data || {};
    setText("metricVisitors", number(data.visitors));
    setText("metricLeads", number(data.leads));
    setText("metricConversion", percent(data.conversion_rate));
    setText("metricConfirmedLeads", number(data.confirmed_leads));
    setText("metricEnrollments", number(data.enrollments));
    setText("metricRevenue", currency(data.revenue));
    setText("metricChatgptVisitors", number(data.chatgpt_visitors));
    setText("metricChatgptLeads", number(data.chatgpt_leads));
    setText("metricChatgptConversion", percent(data.chatgpt_conversion_rate));
    setText("metricChatgptConfirmedLeads", number(data.chatgpt_confirmed_leads));
    setText("metricChatgptEnrollments", number(data.chatgpt_enrollments));
    setText("metricChatgptRevenue", currency(data.chatgpt_revenue));

    renderTable(data.channels, "channelsTableBody", "channelsTableWrap", "channelsEmpty", function (row) {
      return "<tr>" +
        '<td class="source-name">' + escapeHtml(sourceLabel(row.source)) + "</td>" +
        "<td>" + number(row.visitors) + "</td>" +
        "<td>" + number(row.leads) + "</td>" +
        "<td>" + number(row.confirmed_leads) + "</td>" +
        "<td>" + number(row.enrollments) + "</td>" +
        "<td>" + escapeHtml(currency(row.revenue)) + "</td>" +
        "<td>" + escapeHtml(percent(row.conversion_rate)) + "</td>" +
        "<td>" + escapeHtml(percent(row.confirmation_rate)) + "</td>" +
        "<td>" + escapeHtml(percent(row.enrollment_rate)) + "</td>" +
      "</tr>";
    });

    renderTable(data.ai_assistants, "aiTableBody", "aiTableWrap", "aiEmpty", function (row) {
      return "<tr>" +
        '<td class="source-name">' + escapeHtml(sourceLabel(row.assistant)) + "</td>" +
        "<td>" + number(row.visitors) + "</td>" +
        "<td>" + number(row.leads) + "</td>" +
        "<td>" + number(row.confirmed_leads) + "</td>" +
        "<td>" + number(row.enrollments) + "</td>" +
        "<td>" + escapeHtml(currency(row.revenue)) + "</td>" +
        "<td>" + escapeHtml(percent(row.conversion_rate)) + "</td>" +
        "<td>" + escapeHtml(percent(row.confirmation_rate)) + "</td>" +
        "<td>" + escapeHtml(percent(row.enrollment_rate)) + "</td>" +
      "</tr>";
    });

    renderTable(data.cta_positions, "ctaTableBody", "ctaTableWrap", "ctaEmpty", function (row) {
      return "<tr>" +
        '<td class="source-name">' + escapeHtml(ctaLabel(row.position)) + "</td>" +
        "<td>" + number(row.leads) + "</td>" +
      "</tr>";
    });

    renderDaily(data.daily);
  }

  function availableStudentOptions() {
    var linked = new Set(recentLeadRows.filter(function (row) { return !!row.student_id; }).map(function (row) { return String(row.student_id); }));
    return attributionStudents.filter(function (student) { return !linked.has(String(student.id)); }).map(function (student) {
      return '<option value="' + escapeHtml(student.id) + '">' + escapeHtml(student.name || student.email || "Aluno") + '</option>';
    }).join("");
  }

  function renderRecentLeads(rows) {
    recentLeadRows = Array.isArray(rows) ? rows : [];
    var body = document.getElementById("recentLeadsTableBody");
    var wrap = document.getElementById("recentLeadsTableWrap");
    var empty = document.getElementById("recentLeadsEmpty");
    if (!body || !wrap || !empty) return;

    if (!recentLeadRows.length) {
      body.innerHTML = "";
      wrap.hidden = true;
      empty.hidden = false;
      return;
    }

    var studentOptions = availableStudentOptions();
    body.innerHTML = recentLeadRows.map(function (row) {
      var confirmed = !!row.confirmed;
      var enrolled = !!row.student_id;
      var status = enrolled
        ? '<span class="status-pill enrolled">MATRICULADO</span>'
        : confirmed
          ? '<span class="status-pill confirmed">CONVERSA CONFIRMADA</span>'
          : '<span class="status-pill click">CLIQUE</span>';

      var source = row.ai_assistant ? sourceLabel(row.ai_assistant) : sourceLabel(row.source);
      var meta = '<div class="lead-meta"><strong>' + escapeHtml(source) + '</strong><small>' + escapeHtml(row.medium || "") + '</small></div>';
      var page = '<div class="lead-meta"><span>' + escapeHtml(row.landing_page || "/") + '</span><small>' + escapeHtml(ctaLabel(row.link_position)) + '</small></div>';

      var studentCell = enrolled
        ? '<div class="student-linked"><strong>' + escapeHtml(row.student_name || "Aluno vinculado") + '</strong><small>' + escapeHtml(currency(row.revenue)) + ' atribuídos</small></div>'
        : confirmed
          ? '<span class="muted">Aguardando matrícula</span>'
          : '<span class="muted">—</span>';

      var actions = "";
      if (!confirmed) {
        actions = '<button class="action-button" type="button" data-action="confirm" data-event-id="' + escapeHtml(row.event_id) + '">CONFIRMAR CONVERSA</button>';
      } else if (!enrolled) {
        actions = '<select class="lead-student-select" aria-label="Selecionar aluno"><option value="">Selecionar aluno...</option>' + studentOptions + '</select>' +
          '<button class="action-button" type="button" data-action="link" data-lead-id="' + escapeHtml(row.commercial_lead_id) + '">VINCULAR MATRÍCULA</button>' +
          '<button class="action-button secondary" type="button" data-action="unconfirm" data-lead-id="' + escapeHtml(row.commercial_lead_id) + '">DESFAZER</button>';
      } else {
        actions = '<button class="action-button secondary" type="button" data-action="unlink" data-lead-id="' + escapeHtml(row.commercial_lead_id) + '">DESVINCULAR MATRÍCULA</button>';
      }

      return '<tr>' +
        '<td>' + escapeHtml(formatDateTime(row.occurred_at)) + '</td>' +
        '<td>' + meta + '</td>' +
        '<td>' + page + '</td>' +
        '<td>' + status + '</td>' +
        '<td>' + studentCell + '</td>' +
        '<td><div class="lead-actions">' + actions + '</div></td>' +
      '</tr>';
    }).join("");

    wrap.hidden = false;
    empty.hidden = true;
  }

  function friendlyError(error) {
    var message = String(error && (error.message || error.details || error.code) || "Erro desconhecido");
    if (/Acesso negado|permission|42501/i.test(message)) return "Acesso restrito à conta do professor.";
    if (/já está vinculado/i.test(message)) return "Esse aluno já está atribuído a outra origem.";
    if (/Aluno ativo e matriculado não encontrado/i.test(message)) return "O aluno selecionado não está ativo e matriculado.";
    return message;
  }

  async function callRpc(name, args) {
    var client = Auth.getClient();
    var response = await client.rpc(name, args || {});
    if (response.error) throw response.error;
    return response.data;
  }

  async function loadReport() {
    var button = document.getElementById("refreshAcquisition");
    var status = document.getElementById("acquisitionStatus");
    var periodNode = document.getElementById("periodFilter");
    var period = Number(periodNode && periodNode.value) || 30;
    if (button) button.disabled = true;
    if (status) status.textContent = "Atualizando funil de aquisição...";

    try {
      var client = Auth.getClient();
      var responses = await Promise.all([
        client.rpc("get_teacher_acquisition_summary", { period_days: period }),
        client.rpc("get_teacher_recent_marketing_leads", { period_days: period }),
        client.rpc("get_teacher_attribution_students")
      ]);
      responses.forEach(function (response) { if (response.error) throw response.error; });

      attributionStudents = Array.isArray(responses[2].data) ? responses[2].data : [];
      renderSummary(responses[0].data || {});
      renderRecentLeads(responses[1].data || []);
      if (status) status.textContent = "Funil de aquisição dos últimos " + period + " dias.";
    } catch (error) {
      console.error("Falha ao carregar aquisição:", error);
      if (status) status.textContent = friendlyError(error);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function handleLeadAction(event) {
    var button = event.target.closest("button[data-action]");
    if (!button) return;
    var status = document.getElementById("acquisitionStatus");
    var row = button.closest("tr");
    var action = button.dataset.action;
    button.disabled = true;
    if (status) status.textContent = "Salvando etapa do funil...";

    try {
      if (action === "confirm") {
        await callRpc("confirm_teacher_marketing_lead", { p_event_id: button.dataset.eventId });
      } else if (action === "unconfirm") {
        await callRpc("unconfirm_teacher_marketing_lead", { p_lead_id: button.dataset.leadId });
      } else if (action === "unlink") {
        await callRpc("unlink_teacher_marketing_lead_student", { p_lead_id: button.dataset.leadId });
      } else if (action === "link") {
        var select = row && row.querySelector(".lead-student-select");
        var studentId = select && select.value;
        if (!studentId) {
          if (status) status.textContent = "Selecione o aluno que se matriculou antes de vincular.";
          button.disabled = false;
          return;
        }
        await callRpc("link_teacher_marketing_lead_student", { p_lead_id: button.dataset.leadId, p_student_id: studentId });
      }
      await loadReport();
    } catch (error) {
      console.error("Falha ao atualizar funil:", error);
      if (status) status.textContent = friendlyError(error);
      button.disabled = false;
    }
  }

  async function initialize() {
    var status = document.getElementById("acquisitionStatus");
    if (!(await waitForAuth())) {
      if (status) status.textContent = "Não foi possível carregar a autenticação.";
      document.body.classList.remove("auth-checking");
      return;
    }

    var session = await Auth.getSession();
    if (!session || !session.user) {
      window.location.replace("/login/?next=" + encodeURIComponent("/marketing_acquisition/"));
      return;
    }

    var content = document.getElementById("dashboardContent");
    if (content) content.hidden = false;
    document.body.classList.remove("auth-checking");

    var refresh = document.getElementById("refreshAcquisition");
    var period = document.getElementById("periodFilter");
    var recentBody = document.getElementById("recentLeadsTableBody");
    if (refresh) refresh.addEventListener("click", loadReport);
    if (period) period.addEventListener("change", loadReport);
    if (recentBody) recentBody.addEventListener("click", handleLeadAction);
    await loadReport();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
