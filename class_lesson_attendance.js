(function () {
  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  var specialLessonOptions = [
    "Feriado",
    "Teacher Cancelou",
    "Não compareceu",
    "Conversation",
    "Outras atividades",
    "Problemas técnicos"
  ];

  async function waitForAuthResources() {
    for (var i = 0; i < 20; i++) {
      if (window.Auth && window.SUPABASE_CONFIG && Auth.isConfigured && Auth.isConfigured()) return true;
      await sleep(150);
    }
    return !!(window.Auth && window.SUPABASE_CONFIG && Auth.isConfigured && Auth.isConfigured());
  }

  function getClassNumber() {
    var params = new URLSearchParams(window.location.search);
    var value = Number(params.get("id"));
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(String(value || ""));
    return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function getStudentRefId(student) {
    return String(student.student_ref_id || student.user_id || student.invite_id || student.id || "").trim();
  }

  function getStudentRefType(student) {
    return String(student.student_ref_type || (student.user_id ? "user" : "invite")).trim();
  }

  function getStudentKey(student) {
    return getStudentRefType(student) + ":" + getStudentRefId(student);
  }

  function isValidStudentRef(student) {
    var refId = getStudentRefId(student);
    var refType = getStudentRefType(student);
    return !!refId && (refType === "user" || refType === "invite");
  }

  function formatBrazilianDate(value) {
    if (!value) return "";
    var parts = String(value).split("-");
    return parts.length === 3 ? parts[2] + "/" + parts[1] + "/" + parts[0].slice(2) : value;
  }

  function todayIso() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function formatPresentationCode(value) {
    var code = String(value || "");
    var match = /^L([1-9]\d?)$/i.exec(code);
    return match ? "Apresentação " + match[1] : code;
  }

  function lessonOptions(selected) {
    var html = '<option value="">Selecionar</option>';
    specialLessonOptions.forEach(function (option) {
      html += '<option value="' + escapeHtml(option) + '"' + (selected === option ? ' selected' : '') + '>' + escapeHtml(option) + '</option>';
    });
    html += '<option disabled>──────────</option>';
    for (var i = 1; i <= 74; i++) {
      var lesson = "L" + i;
      html += '<option value="' + lesson + '"' + (selected === lesson ? ' selected' : '') + '>' + formatPresentationCode(lesson) + '</option>';
    }
    return html;
  }

  async function loadClassStudents(classNumber) {
    var response = await Auth.getClient().rpc("get_teacher_class_students", { target_class_number: classNumber });
    if (response.error) throw response.error;
    return response.data || [];
  }

  async function loadLessonRecords(classNumber) {
    var response = await Auth.getClient().rpc("get_teacher_class_lesson_records", { target_class_number: classNumber });
    if (response.error) throw response.error;
    return response.data || [];
  }

  function groupRecordsByStudentRef(records) {
    return records.reduce(function (map, record) {
      var refType = String(record.student_ref_type || (record.user_id ? "user" : "invite")).trim();
      var refId = String(record.student_ref_id || record.user_id || record.invite_id || "").trim();
      if (!refId) return map;
      var key = refType + ":" + refId;
      if (!map[key]) map[key] = [];
      map[key].push(record);
      return map;
    }, {});
  }

  function renderRecordRows(student, records) {
    var refId = getStudentRefId(student);
    var refType = getStudentRefType(student);
    var safeKey = escapeHtml(getStudentKey(student));

    var rows = (records || []).map(function (record) {
      return '<tr>' +
        '<td>' + escapeHtml(formatBrazilianDate(record.class_date)) + '</td>' +
        '<td><span class="lesson-status-pill">' + escapeHtml(formatPresentationCode(record.lesson_code)) + '</span></td>' +
        '<td><button class="delete-button lesson-delete-button" type="button" data-record-id="' + escapeHtml(record.id) + '" data-record-label="' + escapeHtml(formatPresentationCode(record.lesson_code || "apresentação") + " de " + formatBrazilianDate(record.class_date)) + '">EXCLUIR</button></td>' +
      '</tr>';
    }).join("");

    rows += '<tr>' +
      '<td><input class="lesson-date-input" type="date" value="' + todayIso() + '" data-student-key="' + safeKey + '" data-ref-id="' + escapeHtml(refId) + '" data-ref-type="' + escapeHtml(refType) + '" /></td>' +
      '<td><select class="lesson-select" data-student-key="' + safeKey + '" data-ref-id="' + escapeHtml(refId) + '" data-ref-type="' + escapeHtml(refType) + '">' + lessonOptions("") + '</select></td>' +
      '<td><button class="lesson-save-button" type="button" data-student-key="' + safeKey + '" data-ref-id="' + escapeHtml(refId) + '" data-ref-type="' + escapeHtml(refType) + '">SALVAR</button></td>' +
    '</tr>';

    return rows;
  }

  function renderStudentTable(student, records) {
    var name = student.student_name || student.name || student.student_email || "Aluno sem nome";
    var enrollment = student.enrollment_code || "Não informado";
    var preLabel = getStudentRefType(student) === "invite" ? " · Pré-matriculado" : "";

    return '<div class="lesson-attendance-card">' +
      '<table class="lesson-attendance-table">' +
        '<thead><tr><th>' + escapeHtml(name + preLabel) + '</th><th colspan="2">Matrícula: ' + escapeHtml(enrollment) + '</th></tr></thead>' +
        '<tbody>' + renderRecordRows(student, records) + '</tbody>' +
      '</table>' +
    '</div>';
  }

  async function saveLessonRecord(button) {
    var studentKey = button.dataset.studentKey;
    var refId = String(button.dataset.refId || "").trim();
    var refType = String(button.dataset.refType || "").trim();
    var escapedKey = cssEscape(studentKey);
    var dateInput = document.querySelector('.lesson-date-input[data-student-key="' + escapedKey + '"]');
    var lessonSelect = document.querySelector('.lesson-select[data-student-key="' + escapedKey + '"]');
    var classNumber = getClassNumber();

    if (!dateInput || !lessonSelect || !classNumber) return;
    if (!refId || (refType !== "user" && refType !== "invite")) {
      alert("Não foi possível identificar este aluno. Atualize a página e tente novamente.");
      return;
    }
    if (!dateInput.value) { alert("Escolha uma data."); return; }
    if (!lessonSelect.value) { alert("Escolha uma opção da lista."); return; }

    button.disabled = true;
    button.textContent = "SALVANDO...";

    try {
      var response = await Auth.getClient().rpc("save_teacher_class_lesson_record_by_ref", {
        target_class_number: classNumber,
        target_student_ref_id: refId,
        target_student_ref_type: refType,
        target_class_date: dateInput.value,
        target_lesson_code: lessonSelect.value
      });
      if (response.error) throw response.error;
      await renderLessonAttendance();
    } catch (error) {
      alert("Não foi possível salvar o registro: " + (error.message || "erro desconhecido") + ".");
      button.disabled = false;
      button.textContent = "SALVAR";
    }
  }

  async function deleteLessonRecord(button) {
    var recordId = String(button.dataset.recordId || "").trim();
    if (!recordId) return;
    var label = button.dataset.recordLabel || "este registro";
    if (!window.confirm("Excluir " + label + "? Esta ação remove o registro de frequência/apresentação.")) return;

    button.disabled = true;
    button.textContent = "EXCLUINDO...";
    try {
      var response = await Auth.getClient().rpc("delete_teacher_class_lesson_record", {
        target_record_id: recordId
      });
      if (response.error) throw response.error;
      await renderLessonAttendance();
    } catch (error) {
      alert("Não foi possível excluir o registro: " + (error.message || "erro desconhecido") + ".");
      button.disabled = false;
      button.textContent = "EXCLUIR";
    }
  }

  function attachActionButtons() {
    document.querySelectorAll(".lesson-save-button").forEach(function (button) {
      if (button.dataset.bound === "true") return;
      button.dataset.bound = "true";
      button.addEventListener("click", function () { saveLessonRecord(button); });
    });
    document.querySelectorAll(".lesson-delete-button").forEach(function (button) {
      if (button.dataset.bound === "true") return;
      button.dataset.bound = "true";
      button.addEventListener("click", function () { deleteLessonRecord(button); });
    });
  }

  async function renderLessonAttendance() {
    var target = document.getElementById("lessonAttendanceTables");
    var classNumber = getClassNumber();
    if (!target || !classNumber) return;

    try {
      var ready = await waitForAuthResources();
      if (!ready) throw new Error("Supabase não configurado.");
      var students = (await loadClassStudents(classNumber)).filter(isValidStudentRef);
      var records = await loadLessonRecords(classNumber);
      var grouped = groupRecordsByStudentRef(records);

      if (!students.length) {
        target.className = "empty";
        target.textContent = "Adicione alunos à turma antes de registrar apresentações.";
        return;
      }

      target.className = "";
      target.innerHTML = students.map(function (student) {
        return renderStudentTable(student, grouped[getStudentKey(student)] || []);
      }).join("");
      attachActionButtons();
    } catch (error) {
      target.className = "error";
      target.textContent = "Não foi possível carregar a tabela de frequência e apresentações.";
    }
  }

  window.renderLessonAttendance = renderLessonAttendance;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", renderLessonAttendance);
  else renderLessonAttendance();
})();
