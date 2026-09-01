let currentSession = null;

function redirectToLogin() {
  window.location.href = "login.html?next=" + encodeURIComponent("minha_turma.html");
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function waitForAuthResources() {
  for (let i = 0; i < 10; i++) {
    if (window.Auth && window.SUPABASE_CONFIG && Auth.isConfigured()) return true;
    await sleep(150);
  }
  return !!(window.Auth && window.SUPABASE_CONFIG && Auth.isConfigured());
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDateTime(value) {
  if (!value) return "Não informado";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

async function loadMyClass() {
  const client = Auth.getClient();
  const response = await client.rpc("get_my_student_class");
  if (response.error) throw response.error;
  const rows = response.data || [];
  return mergeRecordedLessonsUrls(rows);
}

async function mergeRecordedLessonsUrls(rows) {
  if (!rows.length) return rows;

  const hasRecordedLessonsUrl = rows.some(function (row) {
    return typeof row.recorded_lessons_url !== "undefined";
  });

  const classNumbers = rows
    .map(function (row) { return row.class_number; })
    .filter(function (value, index, list) { return value && list.indexOf(value) === index; });

  if (!classNumbers.length) return rows;

  try {
    const client = Auth.getClient();
    const response = await client
      .from("class_resources")
      .select("class_number, recorded_lessons_url")
      .in("class_number", classNumbers);

    if (response.error) throw response.error;

    const urlsByClass = {};
    (response.data || []).forEach(function (item) {
      urlsByClass[item.class_number] = item.recorded_lessons_url || "";
    });

    return rows.map(function (row) {
      if (!row.recorded_lessons_url && urlsByClass[row.class_number]) {
        return Object.assign({}, row, { recorded_lessons_url: urlsByClass[row.class_number] });
      }
      return row;
    });
  } catch (error) {
    if (!hasRecordedLessonsUrl) {
      console.warn("Campo recorded_lessons_url não disponível em class_resources:", error.message || error);
    }
    return rows;
  }
}

function resourceIconSvg(kind) {
  const icons = {
    lesson: '<svg class="tf-icon-svg" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3Z"/></svg>',
    notes: '<svg class="tf-icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>',
    recordings: '<svg class="tf-icon-svg" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m9 9 6 3-6 3Z"/></svg>',
    whatsapp: '<svg class="tf-icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.5 9.5 0 0 1-3.9-.9L3 21l1.7-4.7A8.4 8.4 0 1 1 21 11.5Z"/><path d="M8.2 8.1c.5 2.6 2.1 4.3 4.8 5.1"/><path d="M13.1 13.2c.5-.4 1-.8 1.4-.5l1.6.8c.4.2.4.5.2.9-.5 1-1.4 1.4-2.4 1.2"/></svg>'
  };
  return icons[kind] || icons.notes;
}

function renderResourceLink(url, label, kind) {
  if (!url) return "";
  return '<a class="resource-card" href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' +
    '<span class="resource-card-main"><span class="resource-icon">' + resourceIconSvg(kind) + '</span><span>' + escapeHtml(label) + '</span></span>' +
    '<span class="resource-arrow" aria-hidden="true">›</span>' +
  '</a>';
}

function getDisplayClassName(row) {
  return row.class_name || "Turma";
}

function renderMetaItem(label, value) {
  return '<div class="class-meta-item"><dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(value || "Não informado") + '</dd></div>';
}

function renderClassCard(row) {
  const links = [
    renderResourceLink(row.video_lesson_url, "ASSISTIR A AULA", "lesson"),
    renderResourceLink(row.lesson_material_url, "ANOTAÇÕES", "notes"),
    renderResourceLink(row.recorded_lessons_url, "AULAS GRAVADAS", "recordings"),
    renderResourceLink(row.whatsapp_group_url, "GRUPO NO WHATSAPP", "whatsapp")
  ].filter(Boolean).join("");

  const classIcon = '<svg class="tf-icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';

  return '<article class="class-card">' +
    '<header class="class-card-header">' +
      '<div class="class-card-heading"><span class="class-eyebrow">Sua turma</span><h2>' + escapeHtml(getDisplayClassName(row)) + '</h2></div>' +
      '<span class="class-header-icon" aria-hidden="true">' + classIcon + '</span>' +
    '</header>' +
    '<div class="class-card-body">' +
      '<dl class="class-meta">' +
        renderMetaItem("Aluno", row.student_name) +
        renderMetaItem("E-mail", row.student_email) +
        renderMetaItem("Matrícula", row.enrollment_code) +
        renderMetaItem("Inscrito na turma em", formatDateTime(row.created_at)) +
      '</dl>' +
      '<section class="class-resources" aria-label="Recursos da turma">' +
        '<div class="class-resources-head"><h3>Recursos da turma</h3><p>Acesse materiais e canais disponibilizados pelo professor.</p></div>' +
        (links ? '<div class="resource-grid">' + links + '</div>' : '<p class="resources-empty">Nenhum recurso foi cadastrado pelo professor ainda.</p>') +
      '</section>' +
    '</div>' +
  '</article>';
}

async function renderMyClass() {
  const content = document.getElementById("studentClassContent");
  try {
    const rows = await loadMyClass();

    if (!rows.length) {
      content.className = "empty-panel";
      content.textContent = "Você ainda não foi inscrito em uma turma pelo professor.";
      return;
    }

    content.className = "class-content";
    content.innerHTML = rows.map(renderClassCard).join("");
  } catch (error) {
    console.error("Não foi possível carregar a turma do aluno:", error);
    content.className = "empty-panel";
    content.textContent = "Não foi possível carregar sua turma agora. Atualize a página e tente novamente.";
  }
}

async function guardPage() {
  const status = document.getElementById("loginStatus");
  const resourcesReady = await waitForAuthResources();

  if (!resourcesReady) {
    status.textContent = "Não foi possível carregar a autenticação. Atualize a página ou limpe o cache do navegador.";
    document.body.classList.remove("auth-checking");
    return;
  }

  currentSession = await Auth.getSession();
  if (!currentSession || !currentSession.user) {
    redirectToLogin();
    return;
  }

  status.textContent = "Aluno conectado: " + currentSession.user.email + ".";
  document.body.classList.remove("auth-checking");
  await renderMyClass();
}

guardPage();
