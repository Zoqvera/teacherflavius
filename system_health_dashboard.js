(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.SystemHealthDashboard = api;
    api.initialize({ windowRef: root, documentRef: root.document });
  }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const HEALTH_LABELS = Object.freeze({
    healthy: "SAUDÁVEL",
    degraded: "ATENÇÃO",
    critical: "CRÍTICO"
  });

  const PROBE_LABELS = Object.freeze({
    home: "Página inicial",
    health: "Endpoint de saúde",
    login: "Login",
    student_access: "Acesso do aluno"
  });

  const ISSUE_LABELS = Object.freeze({
    critical_application_errors: "Erros críticos da aplicação",
    http_5xx_burst: "Burst de respostas HTTP 5xx",
    http_5xx_elevated: "Respostas HTTP 5xx elevadas",
    auth_error_burst: "Falhas de autenticação elevadas",
    application_error_fingerprint_burst: "Erro recorrente da aplicação",
    resource_error_burst: "Falhas de carregamento de recursos",
    csp_violation_burst: "Violações CSP inesperadas",
    synthetic_availability_failure: "Falha de disponibilidade sintética",
    synthetic_probe_stale: "Probe de disponibilidade atrasado",
    scheduled_job_failure: "Falha de job agendado",
    scheduled_jobs_stale: "Jobs agendados atrasados",
    system_health_stalled: "Health check global atrasado",
    data_quality_check_stalled: "Health check de qualidade de dados atrasado",
    data_quality_orphan_class_assignments: "Vínculos de turma órfãos",
    data_quality_invalid_class_student_refs: "Vínculos de turma com referência inválida",
    data_quality_class_capacity_exceeded: "Turma acima da capacidade",
    data_quality_student_class_type_mismatch: "Tipo do aluno incompatível com a turma",
    data_quality_typed_student_without_active_class: "Aluno com tipo definido sem turma ativa",
    data_quality_duplicate_active_cpf: "CPF duplicado entre alunos ativos",
    data_quality_archive_state_mismatch: "Estado de arquivamento inconsistente",
    data_quality_active_class_schedule_missing: "Turma ativa sem horário completo",
    data_quality_makeup_capacity_exceeded: "Reposição acima da capacidade",
    data_quality_makeup_booking_class_mismatch: "Reposição vinculada à turma incorreta",
    data_quality_makeup_status_timestamp_mismatch: "Status de reposição inconsistente",
    data_quality_future_auto_slot_invalid_class: "Reposição automática ligada a turma inválida",
    data_quality_lesson_orphan_class: "Registro de lição com turma inexistente",
    data_quality_frequency_invalid_subject_ref: "Frequência com referência de aluno inválida",
    data_quality_tuition_subject_mismatch: "Mensalidade com referência de aluno inconsistente",
    data_quality_payment_attempt_subject_mismatch: "Tentativa de pagamento com referência inconsistente"
  });

  function toString(value) {
    return value == null ? "" : String(value);
  }

  function escapeHtml(value) {
    return toString(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function toArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function toObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function normalizeHealthBlock(raw) {
    const health = toObject(raw);
    return Object.freeze({
      status: toString(health.status) || "unknown",
      issueCount: Number(health.issue_count || 0),
      criticalCount: Number(health.critical_count || 0),
      warningCount: Number(health.warning_count || 0),
      completedAt: toString(health.completed_at),
      metrics: Object.freeze(toObject(health.metrics)),
      issues: Object.freeze(toArray(health.issues).map(toObject))
    });
  }

  function normalizeDashboard(raw) {
    const dashboard = toObject(raw);
    return Object.freeze({
      generatedAt: toString(dashboard.generated_at),
      health: normalizeHealthBlock(dashboard.health),
      dataQuality: normalizeHealthBlock(dashboard.data_quality),
      probes: Object.freeze(toArray(dashboard.probes).map(toObject)),
      crons: Object.freeze(toArray(dashboard.crons).map(toObject)),
      alerts: Object.freeze(toArray(dashboard.alerts).map(toObject))
    });
  }

  function formatDateTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return toString(value);
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "America/Sao_Paulo"
    }).format(date);
  }

  function formatMetric(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) ? String(number) : "0";
  }

  function statusClass(status) {
    if (status === "healthy" || status === "succeeded" || status === "sent") return "health-good";
    if (status === "critical" || status === "failed") return "health-critical";
    return "health-warning";
  }

  function healthLabel(status) {
    return HEALTH_LABELS[status] || "SEM DADOS";
  }

  function issueLabel(code) {
    return ISSUE_LABELS[code] || code || "Evento operacional";
  }

  function renderSummary(documentRef, dashboard) {
    const health = dashboard.health;
    const metrics = health.metrics;
    const summary = documentRef.getElementById("healthSummary");
    if (!summary) return;

    summary.innerHTML = [
      '<article class="health-card ' + statusClass(health.status) + '"><span>Estado global</span><strong>' + escapeHtml(healthLabel(health.status)) + '</strong></article>',
      '<article class="health-card"><span>Issues ativos</span><strong>' + escapeHtml(health.issueCount) + '</strong></article>',
      '<article class="health-card"><span>Erros · 15 min</span><strong>' + escapeHtml(formatMetric(metrics.application_errors_15m)) + '</strong></article>',
      '<article class="health-card"><span>HTTP 5xx · 15 min</span><strong>' + escapeHtml(formatMetric(metrics.http_5xx_15m)) + '</strong></article>',
      '<article class="health-card"><span>CSP acionável · 15 min</span><strong>' + escapeHtml(formatMetric(metrics.csp_actionable_15m)) + '</strong></article>',
      '<article class="health-card"><span>Último health check</span><strong class="health-card-date">' + escapeHtml(formatDateTime(health.completedAt)) + '</strong></article>'
    ].join("");
  }

  function renderIssueRows(issues) {
    if (!issues.length) return '<div class="health-empty health-good">Nenhuma invariante ativa.</div>';
    return issues.map(function (issue) {
      const severity = toString(issue.severity) || "warning";
      const details = toObject(issue.details);
      return '<article class="health-row ' + statusClass(severity) + '">' +
        '<div><strong>' + escapeHtml(issueLabel(toString(issue.code))) + '</strong>' +
        '<small>' + escapeHtml(JSON.stringify(details)) + '</small></div>' +
        '<span>' + escapeHtml(severity === "critical" ? "CRÍTICO" : "ATENÇÃO") + '</span>' +
      '</article>';
    }).join("");
  }

  function renderIssues(documentRef, dashboard) {
    const element = documentRef.getElementById("healthIssues");
    if (!element) return;
    element.innerHTML = renderIssueRows(dashboard.health.issues);
  }

  function renderDataQuality(documentRef, dashboard) {
    const quality = dashboard.dataQuality;
    const summary = documentRef.getElementById("dataQualitySummary");
    const issues = documentRef.getElementById("dataQualityIssues");
    if (summary) {
      summary.innerHTML = [
        '<article class="health-card ' + statusClass(quality.status) + '"><span>Qualidade dos dados</span><strong>' + escapeHtml(healthLabel(quality.status)) + '</strong></article>',
        '<article class="health-card"><span>Findings ativos</span><strong>' + escapeHtml(quality.issueCount) + '</strong></article>',
        '<article class="health-card"><span>Última verificação</span><strong class="health-card-date">' + escapeHtml(formatDateTime(quality.completedAt)) + '</strong></article>'
      ].join("");
    }
    if (issues) issues.innerHTML = renderIssueRows(quality.issues);
  }

  function renderProbes(documentRef, dashboard) {
    const body = documentRef.getElementById("healthProbeTableBody");
    if (!body) return;
    body.innerHTML = dashboard.probes.map(function (probe) {
      const ok = probe.ok === true;
      return '<tr>' +
        '<td><strong>' + escapeHtml(PROBE_LABELS[probe.target_key] || probe.target_key) + '</strong></td>' +
        '<td><span class="health-pill ' + (ok ? "health-good" : "health-critical") + '">' + (ok ? "OK" : "FALHA") + '</span></td>' +
        '<td>' + escapeHtml(probe.http_status == null ? "—" : probe.http_status) + '</td>' +
        '<td>' + escapeHtml(probe.latency_ms == null ? "—" : probe.latency_ms + " ms") + '</td>' +
        '<td>' + escapeHtml(formatDateTime(probe.checked_at)) + '</td>' +
      '</tr>';
    }).join("");
  }

  function renderCrons(documentRef, dashboard) {
    const body = documentRef.getElementById("healthCronTableBody");
    if (!body) return;
    body.innerHTML = dashboard.crons.map(function (cron) {
      const stale = cron.stale === true;
      const failed = cron.last_status === "failed" || cron.active === false;
      const className = failed ? "health-critical" : stale ? "health-warning" : "health-good";
      const label = failed ? "FALHA" : stale ? "ATRASADO" : "OK";
      return '<tr>' +
        '<td><strong>' + escapeHtml(cron.jobname) + '</strong></td>' +
        '<td><span class="health-pill ' + className + '">' + label + '</span></td>' +
        '<td>' + escapeHtml(toString(cron.last_status) || "—") + '</td>' +
        '<td>' + escapeHtml(formatDateTime(cron.last_completed_at)) + '</td>' +
      '</tr>';
    }).join("");
  }

  function renderAlerts(documentRef, dashboard) {
    const body = documentRef.getElementById("healthAlertTableBody");
    if (!body) return;
    if (!dashboard.alerts.length) {
      body.innerHTML = '<tr><td colspan="4">Nenhum alerta operacional registrado.</td></tr>';
      return;
    }
    body.innerHTML = dashboard.alerts.map(function (alert) {
      return '<tr>' +
        '<td><strong>' + escapeHtml(issueLabel(toString(alert.issue_code))) + '</strong></td>' +
        '<td><span class="health-pill ' + statusClass(toString(alert.severity)) + '">' + escapeHtml(toString(alert.severity).toUpperCase()) + '</span></td>' +
        '<td>' + escapeHtml(toString(alert.status)) + '</td>' +
        '<td>' + escapeHtml(formatDateTime(alert.created_at)) + '</td>' +
      '</tr>';
    }).join("");
  }

  function renderDashboard(documentRef, rawDashboard) {
    const dashboard = normalizeDashboard(rawDashboard);
    renderSummary(documentRef, dashboard);
    renderIssues(documentRef, dashboard);
    renderDataQuality(documentRef, dashboard);
    renderProbes(documentRef, dashboard);
    renderCrons(documentRef, dashboard);
    renderAlerts(documentRef, dashboard);
    const generated = documentRef.getElementById("healthGeneratedAt");
    if (generated) generated.textContent = "Atualizado em " + formatDateTime(dashboard.generatedAt || dashboard.health.completedAt);
    return dashboard;
  }

  function setMessage(documentRef, message, type) {
    const element = documentRef.getElementById("healthMessage");
    if (!element) return;
    element.textContent = message || "";
    element.className = "health-message" + (type ? " " + type : "");
    element.hidden = !message;
  }

  function wait(milliseconds, windowRef) {
    return new Promise(function (resolve) { windowRef.setTimeout(resolve, milliseconds); });
  }

  async function waitForDependencies(windowRef) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (
        windowRef.Auth && typeof windowRef.Auth.getClient === "function" &&
        windowRef.ProfessorMfaGate && typeof windowRef.ProfessorMfaGate.requireAal2 === "function"
      ) return true;
      await wait(150, windowRef);
    }
    return false;
  }

  async function assertTeacher(client) {
    const response = await client.rpc("is_teacher_admin");
    if (response.error) throw response.error;
    return response.data === true;
  }

  async function loadDashboard(client) {
    const response = await client.functions.invoke("get-system-health-dashboard", { body: {} });
    if (response.error) throw response.error;
    const data = toObject(response.data);
    return toObject(data.dashboard);
  }

  async function refresh(dependencies) {
    const documentRef = dependencies.documentRef;
    const button = documentRef.getElementById("healthRefreshButton");
    if (button) {
      button.disabled = true;
      button.textContent = "ATUALIZANDO...";
    }
    setMessage(documentRef, "Carregando saúde operacional...", "info");
    try {
      const dashboard = await loadDashboard(dependencies.client);
      renderDashboard(documentRef, dashboard);
      setMessage(documentRef, "", "");
      return dashboard;
    } catch (error) {
      setMessage(documentRef, "Não foi possível carregar a saúde do sistema: " + (error.message || "erro desconhecido") + ".", "error");
      throw error;
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "ATUALIZAR";
      }
    }
  }

  async function initialize(dependencies) {
    const windowRef = dependencies && dependencies.windowRef;
    const documentRef = dependencies && dependencies.documentRef;
    if (!windowRef || !documentRef) return false;
    if (!(await waitForDependencies(windowRef))) return false;

    const client = windowRef.Auth.getClient();
    const teacher = await assertTeacher(client).catch(function () { return false; });
    if (!teacher) {
      windowRef.location.href = "/login/?next=" + encodeURIComponent("/saude-do-sistema/");
      return false;
    }

    await windowRef.ProfessorMfaGate.requireAal2({ client: client });
    const runtime = { windowRef: windowRef, documentRef: documentRef, client: client };
    const button = documentRef.getElementById("healthRefreshButton");
    if (button && !button.dataset.healthBound) {
      button.dataset.healthBound = "true";
      button.addEventListener("click", function () {
        refresh(runtime).catch(function () {});
      });
    }
    await refresh(runtime);
    return true;
  }

  return Object.freeze({
    normalizeDashboard: normalizeDashboard,
    healthLabel: healthLabel,
    issueLabel: issueLabel,
    statusClass: statusClass,
    renderDashboard: renderDashboard,
    initialize: initialize
  });
});
