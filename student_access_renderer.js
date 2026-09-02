(function () {
  "use strict";

  const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium"
  });

  function getElement(id) {
    const element = document.getElementById(id);
    if (!element) throw new Error("Elemento do painel não encontrado: " + id + ".");
    return element;
  }

  function clearElement(element) {
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
  }

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text != null) element.textContent = String(text);
    return element;
  }

  function formatDateTime(value) {
    if (!value) return "Data não informada";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return DATE_TIME_FORMATTER.format(date);
  }

  function formatOptionalDateTime(value) {
    return value ? formatDateTime(value) : "—";
  }

  function normalizeStudents(students) {
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

    return Array.from(unique.values()).sort(function (a, b) {
      return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
    });
  }

  function appendStudentIdentity(cell, name, email) {
    cell.appendChild(createElement("span", "student-name", name || "Aluno"));
    cell.appendChild(createElement("div", "muted", email || ""));
  }

  function createStudentCell(name, email) {
    const cell = document.createElement("td");
    appendStudentIdentity(cell, name, email);
    return cell;
  }

  function createStatusCell(hasAccessed) {
    const cell = document.createElement("td");
    const className = "status-pill " + (hasAccessed ? "status-accessed" : "status-never");
    const label = hasAccessed ? "JÁ ACESSOU" : "NUNCA ACESSOU";
    cell.appendChild(createElement("span", className, label));
    return cell;
  }

  function createTextCell(text) {
    return createElement("td", "", text);
  }

  function createAccessDateCell(access) {
    const cell = document.createElement("td");
    cell.appendChild(document.createTextNode(formatDateTime(access.accessed_at)));
    if (access.timezone) cell.appendChild(createElement("div", "muted", access.timezone));
    return cell;
  }

  function createPageCell(access) {
    const pageTitle = access.page_title || "Página sem título";
    const pagePath = access.page_path || "/";
    const cell = document.createElement("td");
    const link = createElement("a", "page-link", pageTitle);
    link.href = pagePath;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    cell.appendChild(link);
    cell.appendChild(createElement("div", "muted", pagePath));
    return cell;
  }

  function create() {
    function setStatus(text, isError) {
      const status = getElement("accessStatus");
      status.textContent = text;
      status.style.color = isError ? "#fca5a5" : "#94a3b8";
    }

    function renderStudents(students) {
      const select = getElement("studentFilter");
      const selectedValue = select.value;
      clearElement(select);

      const defaultOption = document.createElement("option");
      defaultOption.value = "";
      defaultOption.textContent = "Todos os alunos";
      select.appendChild(defaultOption);

      normalizeStudents(students).forEach(function (student) {
        const option = document.createElement("option");
        option.value = student.id;
        option.textContent = student.email ? student.name + " · " + student.email : student.name;
        select.appendChild(option);
      });

      const selectedStillExists = Array.from(select.options).some(function (option) {
        return option.value === selectedValue;
      });
      if (selectedStillExists) select.value = selectedValue;
    }

    function renderAccessStatuses(statuses) {
      const rows = Array.isArray(statuses) ? statuses : [];
      const accessedCount = rows.filter(function (student) {
        return student.has_accessed === true;
      }).length;

      getElement("statusTotalStudents").textContent = String(rows.length);
      getElement("statusAccessedStudents").textContent = String(accessedCount);
      getElement("statusNeverStudents").textContent = String(rows.length - accessedCount);

      const message = getElement("statusMessage");
      const tableWrap = getElement("statusTableWrap");
      const tbody = getElement("statusTableBody");
      clearElement(tbody);

      if (!rows.length) {
        tableWrap.hidden = true;
        message.hidden = false;
        message.className = "empty";
        message.textContent = "Nenhum aluno matriculado foi encontrado.";
        return;
      }

      rows.forEach(function (student) {
        const row = document.createElement("tr");
        row.appendChild(createStudentCell(student.student_name, student.student_email));
        row.appendChild(createStatusCell(student.has_accessed === true));
        row.appendChild(createTextCell(formatOptionalDateTime(student.first_access_at)));
        row.appendChild(createTextCell(formatOptionalDateTime(student.last_access_at)));
        tbody.appendChild(row);
      });

      message.hidden = true;
      tableWrap.hidden = false;
    }

    function renderSummary(accesses) {
      const rows = Array.isArray(accesses) ? accesses : [];
      const studentIds = new Set();
      const pages = new Set();

      rows.forEach(function (access) {
        if (access.user_id) studentIds.add(access.user_id);
        if (access.page_path) pages.add(access.page_path);
      });

      getElement("totalAccesses").textContent = String(rows.length);
      getElement("activeStudents").textContent = String(studentIds.size);
      getElement("uniquePages").textContent = String(pages.size);
    }

    function renderAccesses(accesses) {
      const rows = Array.isArray(accesses) ? accesses : [];
      const message = getElement("accessMessage");
      const tableWrap = getElement("accessTableWrap");
      const tbody = getElement("accessTableBody");

      renderSummary(rows);
      clearElement(tbody);

      if (!rows.length) {
        tableWrap.hidden = true;
        message.hidden = false;
        message.className = "empty";
        message.textContent = "Nenhum acesso foi encontrado para os filtros selecionados.";
        return;
      }

      rows.forEach(function (access) {
        const row = document.createElement("tr");
        row.appendChild(createStudentCell(access.student_name, access.student_email));
        row.appendChild(createAccessDateCell(access));
        row.appendChild(createPageCell(access));
        tbody.appendChild(row);
      });

      message.hidden = true;
      tableWrap.hidden = false;
    }

    function getAccessFilters() {
      return {
        days: Number(getElement("periodFilter").value || 30),
        userId: getElement("studentFilter").value || null
      };
    }

    function showAccessLoading() {
      getElement("refreshAccesses").disabled = true;
      const message = getElement("accessMessage");
      message.hidden = false;
      message.className = "empty";
      message.textContent = "Carregando acessos...";
      getElement("accessTableWrap").hidden = true;
    }

    function showAccessError(messageText) {
      renderSummary([]);
      const message = getElement("accessMessage");
      message.hidden = false;
      message.className = "error";
      message.textContent = messageText;
      getElement("accessTableWrap").hidden = true;
    }

    function showStatusError(messageText) {
      const message = getElement("statusMessage");
      message.hidden = false;
      message.className = "error";
      message.textContent = messageText;
    }

    function setRefreshDisabled(disabled) {
      getElement("refreshAccesses").disabled = disabled;
    }

    function showDashboard() {
      getElement("dashboardContent").hidden = false;
    }

    function finishAuthCheck() {
      document.body.classList.remove("auth-checking");
    }

    function bindEvents(handlers) {
      getElement("refreshAccesses").addEventListener("click", handlers.onRefresh);
      getElement("studentFilter").addEventListener("change", handlers.onStudentChange);
      getElement("periodFilter").addEventListener("change", handlers.onPeriodChange);
    }

    return Object.freeze({
      setStatus: setStatus,
      renderStudents: renderStudents,
      renderAccessStatuses: renderAccessStatuses,
      renderAccesses: renderAccesses,
      getAccessFilters: getAccessFilters,
      showAccessLoading: showAccessLoading,
      showAccessError: showAccessError,
      showStatusError: showStatusError,
      setRefreshDisabled: setRefreshDisabled,
      showDashboard: showDashboard,
      finishAuthCheck: finishAuthCheck,
      bindEvents: bindEvents
    });
  }

  window.StudentAccessRenderer = Object.freeze({
    create: create
  });
})();
