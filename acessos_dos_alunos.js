(function () {
  "use strict";

  const RESOURCE_MAX_ATTEMPTS = 15;
  const RESOURCE_RETRY_DELAY_MS = 150;
  const state = {
    session: null,
    accessService: null
  };

  function sleep(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms);
    });
  }

  function resourcesAreReady() {
    return !!(
      window.Auth &&
      window.StudentAccessService &&
      window.SUPABASE_CONFIG &&
      window.Auth.isConfigured()
    );
  }

  async function waitForResources() {
    for (let attempt = 0; attempt < RESOURCE_MAX_ATTEMPTS; attempt += 1) {
      if (resourcesAreReady()) return true;
      await sleep(RESOURCE_RETRY_DELAY_MS);
    }
    return resourcesAreReady();
  }

  function setStatus(text, isError) {
    const status = document.getElementById("accessStatus");
    status.textContent = text;
    status.style.color = isError ? "#fca5a5" : "#94a3b8";
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatDateTime(value) {
    if (!value) return "Data não informada";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "medium"
    }).format(date);
  }

  function formatOptionalDateTime(value) {
    return value ? formatDateTime(value) : "—";
  }

  function renderStudents(students) {
    const select = document.getElementById("studentFilter");
    const selectedValue = select.value;
    const unique = new Map();

    (students || []).forEach(function (student) {
      const userId = student.user_id || student.id;
      if (!userId || unique.has(userId)) return;
      unique.set(userId, {
        id: userId,
        name: student.name || student.email || "Aluno",
        email: student.email || ""
      });
    });

    const sorted = Array.from(unique.values()).sort(function (a, b) {
      return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
    });

    select.innerHTML = '<option value="">Todos os alunos</option>' + sorted.map(function (student) {
      const label = student.email
        ? student.name + " · " + student.email
        : student.name;
      return '<option value="' + escapeHtml(student.id) + '">' + escapeHtml(label) + "</option>";
    }).join("");

    if (Array.from(select.options).some(function (option) { return option.value === selectedValue; })) {
      select.value = selectedValue;
    }
  }

  function renderAccessStatuses(statuses) {
    const rows = Array.isArray(statuses) ? statuses : [];
    const accessedCount = rows.filter(function (student) { return student.has_accessed === true; }).length;
    const neverCount = rows.length - accessedCount;

    document.getElementById("statusTotalStudents").textContent = String(rows.length);
    document.getElementById("statusAccessedStudents").textContent = String(accessedCount);
    document.getElementById("statusNeverStudents").textContent = String(neverCount);

    const message = document.getElementById("statusMessage");
    const tableWrap = document.getElementById("statusTableWrap");
    const tbody = document.getElementById("statusTableBody");

    if (!rows.length) {
      tbody.innerHTML = "";
      tableWrap.hidden = true;
      message.hidden = false;
      message.className = "empty";
      message.textContent = "Nenhum aluno matriculado foi encontrado.";
      return;
    }

    tbody.innerHTML = rows.map(function (student) {
      const hasAccessed = student.has_accessed === true;
      return [
        "<tr>",
        '<td><span class="student-name">' + escapeHtml(student.student_name || "Aluno") + "</span>",
        '<div class="muted">' + escapeHtml(student.student_email || "") + "</div></td>",
        '<td><span class="status-pill ' + (hasAccessed ? "status-accessed" : "status-never") + '">' +
          (hasAccessed ? "JÁ ACESSOU" : "NUNCA ACESSOU") + "</span></td>",
        "<td>" + escapeHtml(formatOptionalDateTime(student.first_access_at)) + "</td>",
        "<td>" + escapeHtml(formatOptionalDateTime(student.last_access_at)) + "</td>",
        "</tr>"
      ].join("");
    }).join("");

    message.hidden = true;
    tableWrap.hidden = false;
  }

  function renderSummary(accesses) {
    const studentIds = new Set();
    const pages = new Set();

    accesses.forEach(function (access) {
      if (access.user_id) studentIds.add(access.user_id);
      if (access.page_path) pages.add(access.page_path);
    });

    document.getElementById("totalAccesses").textContent = String(accesses.length);
    document.getElementById("activeStudents").textContent = String(studentIds.size);
    document.getElementById("uniquePages").textContent = String(pages.size);
  }

  function renderAccesses(accesses) {
    const message = document.getElementById("accessMessage");
    const tableWrap = document.getElementById("accessTableWrap");
    const tbody = document.getElementById("accessTableBody");

    renderSummary(accesses);

    if (!accesses.length) {
      tbody.innerHTML = "";
      tableWrap.hidden = true;
      message.hidden = false;
      message.className = "empty";
      message.textContent = "Nenhum acesso foi encontrado para os filtros selecionados.";
      return;
    }

    tbody.innerHTML = accesses.map(function (access) {
      const pageTitle = access.page_title || "Página sem título";
      const pagePath = access.page_path || "/";

      return [
        "<tr>",
        '<td><span class="student-name">' + escapeHtml(access.student_name || "Aluno") + "</span>",
        '<div class="muted">' + escapeHtml(access.student_email || "") + "</div></td>",
        "<td>" + escapeHtml(formatDateTime(access.accessed_at)),
        access.timezone ? '<div class="muted">' + escapeHtml(access.timezone) + "</div>" : "",
        "</td>",
        '<td><a class="page-link" href="' + escapeHtml(pagePath) + '" target="_blank" rel="noopener noreferrer">' +
          escapeHtml(pageTitle) + "</a>",
        '<div class="muted">' + escapeHtml(pagePath) + "</div></td>",
        "</tr>"
      ].join("");
    }).join("");

    message.hidden = true;
    tableWrap.hidden = false;
  }

  async function loadStudents() {
    const students = await state.accessService.getStudents();
    renderStudents(students);
  }

  async function loadAccessStatuses() {
    const statuses = await state.accessService.getAccessStatuses();
    renderAccessStatuses(statuses);
  }

  async function loadAccesses() {
    const refreshButton = document.getElementById("refreshAccesses");
    const message = document.getElementById("accessMessage");
    const tableWrap = document.getElementById("accessTableWrap");
    const days = Number(document.getElementById("periodFilter").value || 30);
    const userId = document.getElementById("studentFilter").value || null;

    refreshButton.disabled = true;
    message.hidden = false;
    message.className = "empty";
    message.textContent = "Carregando acessos...";
    tableWrap.hidden = true;

    try {
      const accesses = await state.accessService.getAccesses({
        days: days,
        userId: userId
      });
      renderAccesses(accesses);
      setStatus("Professor autenticado: " + state.session.user.email + ".");
    } catch (error) {
      renderSummary([]);
      message.hidden = false;
      message.className = "error";
      message.textContent = "Não foi possível carregar os acessos. Detalhe: " + (error.message || "erro desconhecido");
      setStatus("O painel ainda não está configurado corretamente no Supabase.", true);
    } finally {
      refreshButton.disabled = false;
    }
  }

  async function refreshDashboard() {
    await Promise.all([loadAccessStatuses(), loadAccesses()]);
  }

  function createAccessService() {
    return window.StudentAccessService.create({
      getClient: function () {
        return window.Auth.getClient();
      }
    });
  }

  async function initializeDashboard() {
    const ready = await waitForResources();
    const content = document.getElementById("dashboardContent");

    if (!ready) {
      setStatus("Não foi possível carregar a autenticação. Atualize a página ou limpe o cache.", true);
      document.body.classList.remove("auth-checking");
      return;
    }

    state.accessService = createAccessService();
    state.session = await window.Auth.getSession();
    if (!state.session || !state.session.user) {
      window.location.href = "/login.html?next=" + encodeURIComponent("acessos_dos_alunos.html");
      return;
    }

    try {
      const isTeacherAdmin = await state.accessService.isTeacherAdmin();
      if (!isTeacherAdmin) {
        setStatus("Acesso negado. Esta página é exclusiva do professor.", true);
        document.body.classList.remove("auth-checking");
        return;
      }

      content.hidden = false;
      document.body.classList.remove("auth-checking");
      setStatus("Professor autenticado: " + state.session.user.email + ".");

      await loadStudents();
      await refreshDashboard();
    } catch (error) {
      setStatus("Não foi possível confirmar as credenciais administrativas ou carregar os dados.", true);
      document.body.classList.remove("auth-checking");
      const statusMessage = document.getElementById("statusMessage");
      if (statusMessage) {
        statusMessage.hidden = false;
        statusMessage.className = "error";
        statusMessage.textContent = error.message || "Não foi possível carregar a situação dos alunos.";
      }
    }
  }

  document.getElementById("refreshAccesses").addEventListener("click", refreshDashboard);
  document.getElementById("studentFilter").addEventListener("change", loadAccesses);
  document.getElementById("periodFilter").addEventListener("change", loadAccesses);

  initializeDashboard();
})();
