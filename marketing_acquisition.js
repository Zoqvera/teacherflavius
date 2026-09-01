(function () {
  "use strict";

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
        '<span class="trend-value">' + visitors + ' vis. · ' + leads + ' lead' + (leads === 1 ? '' : 's') + '</span>' +
      '</div>';
    }).join("");
    container.hidden = false;
    empty.hidden = true;
  }

  function render(data) {
    data = data || {};
    setText("metricVisitors", number(data.visitors));
    setText("metricLeads", number(data.leads));
    setText("metricConversion", percent(data.conversion_rate));
    setText("metricChatgptVisitors", number(data.chatgpt_visitors));
    setText("metricChatgptLeads", number(data.chatgpt_leads));
    setText("metricChatgptConversion", percent(data.chatgpt_conversion_rate));

    renderTable(data.channels, "channelsTableBody", "channelsTableWrap", "channelsEmpty", function (row) {
      return "<tr>" +
        '<td class="source-name">' + escapeHtml(sourceLabel(row.source)) + "</td>" +
        "<td>" + number(row.visitors) + "</td>" +
        "<td>" + number(row.leads) + "</td>" +
        "<td>" + escapeHtml(percent(row.conversion_rate)) + "</td>" +
      "</tr>";
    });

    renderTable(data.ai_assistants, "aiTableBody", "aiTableWrap", "aiEmpty", function (row) {
      return "<tr>" +
        '<td class="source-name">' + escapeHtml(sourceLabel(row.assistant)) + "</td>" +
        "<td>" + number(row.visitors) + "</td>" +
        "<td>" + number(row.leads) + "</td>" +
        "<td>" + escapeHtml(percent(row.conversion_rate)) + "</td>" +
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

  async function loadReport() {
    var button = document.getElementById("refreshAcquisition");
    var status = document.getElementById("acquisitionStatus");
    var period = Number(document.getElementById("periodFilter").value) || 30;
    if (button) button.disabled = true;
    if (status) status.textContent = "Atualizando dados de aquisição...";

    try {
      var client = Auth.getClient();
      var response = await client.rpc("get_teacher_acquisition_summary", { period_days: period });
      if (response.error) throw response.error;
      render(response.data || {});
      if (status) status.textContent = "Dados de aquisição dos últimos " + period + " dias.";
    } catch (error) {
      console.error("Falha ao carregar aquisição:", error);
      if (status) status.textContent = /Acesso negado|permission|42501/i.test(String(error && (error.message || error.code) || ""))
        ? "Acesso restrito à conta do professor."
        : "Não foi possível carregar os dados de aquisição.";
    } finally {
      if (button) button.disabled = false;
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
      window.location.replace("/login/?next=" + encodeURIComponent("/relatorios/"));
      return;
    }

    var content = document.getElementById("dashboardContent");
    if (content) content.hidden = false;
    document.body.classList.remove("auth-checking");

    var refresh = document.getElementById("refreshAcquisition");
    var period = document.getElementById("periodFilter");
    if (refresh) refresh.addEventListener("click", loadReport);
    if (period) period.addEventListener("change", loadReport);
    await loadReport();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
