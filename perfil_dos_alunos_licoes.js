(function () {
  const SPECIAL_LESSONS = [
    "Feriado",
    "Teacher Cancelou",
    "Não compareceu",
    "Conversation",
    "Outras atividades",
    "Problemas técnicos"
  ];

  let dataLoaded = false;
  let dataLoading = null;
  let classMap = new Map();
  let membershipsByUser = new Map();
  let recordsByUser = new Map();
  let attachTimer = null;

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  async function waitForResources() {
    for (let i = 0; i < 20; i++) {
      if (window.Auth && window.SUPABASE_CONFIG && Auth.isConfigured && Auth.isConfigured()) return true;
      await sleep(150);
    }
    return !!(window.Auth && window.SUPABASE_CONFIG && Auth.isConfigured && Auth.isConfigured());
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function todayIso() {
    const now = new Date();
    return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
  }

  function formatDate(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? match[3] + "/" + match[2] + "/" + match[1].slice(2) : String(value || "");
  }

  function formatPresentationCode(value) {
    const code = String(value || "");
    const match = /^L([1-9]\d?)$/i.exec(code);
    return match ? "Apresentação " + match[1] : code;
  }

  function lessonOptions() {
    let html = '<option value="">Selecione</option>';
    SPECIAL_LESSONS.forEach(function (option) {
      html += '<option value="' + escapeHtml(option) + '">' + escapeHtml(option) + '</option>';
    });
    html += '<option disabled>──────────</option>';
    for (let i = 1; i <= 74; i++) {
      html += '<option value="L' + i + '">Apresentação ' + i + '</option>';
    }
    return html;
  }

  function injectStyles() {
    if (document.getElementById("studentLessonsStyles")) return;
    const style = document.createElement("style");
    style.id = "studentLessonsStyles";
    style.textContent = `
      .student-lessons-panel{margin-top:14px;border:1px solid rgba(129,140,248,.25);border-radius:15px;background:rgba(129,140,248,.055);overflow:hidden}
      .student-lessons-panel summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 14px;color:#e0e7ff;font-weight:bold;cursor:pointer;list-style:none}
      .student-lessons-panel summary::-webkit-details-marker{display:none}
      .student-lessons-summary-meta{color:#a5b4fc;font-size:11px;font-weight:normal;text-align:right}
      .student-lessons-body{padding:0 14px 14px}
      .student-lessons-history{display:grid;gap:7px;margin-bottom:14px;max-height:290px;overflow:auto;padding-right:3px}
      .student-lesson-row{display:grid;grid-template-columns:88px 1fr auto;gap:8px;align-items:center;padding:9px 10px;border:1px solid rgba(255,255,255,.07);border-radius:10px;background:rgba(255,255,255,.035);color:#cbd5e1;font-size:12px}
      .student-lesson-code{display:inline-flex;width:max-content;border-radius:999px;padding:5px 8px;background:rgba(129,140,248,.14);border:1px solid rgba(129,140,248,.28);color:#e0e7ff;font-weight:bold}
      .student-lesson-class{color:#94a3b8;text-align:right;font-size:11px}
      .student-lessons-empty{padding:11px;border:1px dashed rgba(255,255,255,.12);border-radius:10px;color:#94a3b8;font-size:12px;line-height:1.5;margin-bottom:14px}
      .student-lesson-form{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding-top:12px;border-top:1px solid rgba(255,255,255,.08)}
      .student-lesson-form label{display:grid;gap:5px;color:#cbd5e1;font-size:11px;font-weight:bold}
      .student-lesson-form .full{grid-column:1/-1}
      .student-lesson-form select,.student-lesson-form input{width:100%;box-sizing:border-box;background:#111827;border:1.5px solid rgba(255,255,255,.12);border-radius:10px;padding:10px;color:#f1f5f9;font-family:Georgia,serif;font-size:13px}
      .student-lesson-form select option{color:#0f172a}
      .student-lesson-save{grid-column:1/-1;border:1.5px solid rgba(52,211,153,.38);border-radius:10px;background:rgba(16,185,129,.10);color:#a7f3d0;padding:10px 12px;font-family:Georgia,serif;font-weight:bold;cursor:pointer}
      .student-lesson-save:disabled{opacity:.55;cursor:wait}
      .student-lesson-message{grid-column:1/-1;color:#94a3b8;font-size:11px;line-height:1.45;min-height:16px}
      .student-lesson-message.error{color:#fca5a5}
      .student-lesson-message.success{color:#86efac}
      @media(max-width:620px){.student-lesson-row{grid-template-columns:72px 1fr}.student-lesson-class{grid-column:1/-1;text-align:left}.student-lesson-form{grid-template-columns:1fr}.student-lesson-form .full,.student-lesson-save,.student-lesson-message{grid-column:auto}}
    `;
    document.head.appendChild(style);
  }

  async function loadData(force) {
    if (dataLoaded && !force) return;
    if (dataLoading && !force) return dataLoading;

    dataLoading = (async function () {
      const ready = await waitForResources();
      if (!ready) throw new Error("Supabase não configurado.");

      const client = Auth.getClient();
      const results = await Promise.all([
        client.from("teacher_classes").select("class_number,class_name,is_active"),
        client.from("class_students").select("user_id,class_number").not("user_id", "is", null),
        client.from("class_lesson_records").select("id,class_number,user_id,class_date,lesson_code,created_at").not("user_id", "is", null).order("class_date", { ascending: false }).order("created_at", { ascending: false })
      ]);

      results.forEach(function (result) {
        if (result.error) throw result.error;
      });

      classMap = new Map((results[0].data || []).map(function (row) {
        return [Number(row.class_number), row];
      }));

      membershipsByUser = new Map();
      (results[1].data || []).forEach(function (row) {
        if (!row.user_id) return;
        const list = membershipsByUser.get(row.user_id) || [];
        const classNumber = Number(row.class_number);
        if (!list.includes(classNumber)) list.push(classNumber);
        membershipsByUser.set(row.user_id, list);
      });

      recordsByUser = new Map();
      (results[2].data || []).forEach(function (row) {
        if (!row.user_id) return;
        const list = recordsByUser.get(row.user_id) || [];
        list.push(row);
        recordsByUser.set(row.user_id, list);
      });

      dataLoaded = true;
      dataLoading = null;
    })();

    try {
      await dataLoading;
    } catch (error) {
      dataLoading = null;
      throw error;
    }
  }

  function getUserIdFromCard(card) {
    const assign = card.querySelector('.assign-class-button[data-ref-type="user"][data-ref-id]');
    if (assign && assign.dataset.refId) return String(assign.dataset.refId);
    const archive = card.querySelector('.delete-student-button[data-user-id]');
    return archive && archive.dataset.userId ? String(archive.dataset.userId) : "";
  }

  function className(classNumber) {
    const item = classMap.get(Number(classNumber));
    return item && item.class_name ? item.class_name : "Turma " + classNumber;
  }

  function renderHistory(userId) {
    const records = recordsByUser.get(userId) || [];
    if (!records.length) {
      return '<div class="student-lessons-empty">Nenhuma apresentação registrada para este aluno.</div>';
    }

    return '<div class="student-lessons-history">' + records.map(function (record) {
      return '<div class="student-lesson-row">' +
        '<span>' + escapeHtml(formatDate(record.class_date)) + '</span>' +
        '<span class="student-lesson-code">' + escapeHtml(formatPresentationCode(record.lesson_code)) + '</span>' +
        '<span class="student-lesson-class">' + escapeHtml(className(record.class_number)) + '</span>' +
      '</div>';
    }).join("") + '</div>';
  }

  function renderClassOptions(userId) {
    const memberships = membershipsByUser.get(userId) || [];
    if (!memberships.length) return '<option value="">Sem turma atribuída</option>';

    return memberships
      .filter(function (classNumber) {
        const item = classMap.get(Number(classNumber));
        return !item || item.is_active !== false;
      })
      .map(function (classNumber) {
        return '<option value="' + escapeHtml(classNumber) + '">' + escapeHtml(className(classNumber)) + '</option>';
      }).join("");
  }

  function latestSummary(userId) {
    const records = recordsByUser.get(userId) || [];
    if (!records.length) return "Nenhum registro";
    const latest = records[0];
    return records.length + (records.length === 1 ? " registro" : " registros") + " · Última: " + formatPresentationCode(latest.lesson_code) + " em " + formatDate(latest.class_date);
  }

  function buildPanel(userId) {
    const memberships = membershipsByUser.get(userId) || [];
    const canRegister = memberships.some(function (classNumber) {
      const item = classMap.get(Number(classNumber));
      return !item || item.is_active !== false;
    });

    const details = document.createElement("details");
    details.className = "student-lessons-panel";
    details.dataset.lessonsUserId = userId;
    details.innerHTML =
      '<summary><span>APRESENTAÇÕES</span><span class="student-lessons-summary-meta">' + escapeHtml(latestSummary(userId)) + '</span></summary>' +
      '<div class="student-lessons-body">' +
        renderHistory(userId) +
        '<div class="student-lesson-form">' +
          '<label class="full">Turma<select data-lesson-class>' + renderClassOptions(userId) + '</select></label>' +
          '<label>Data<input data-lesson-date type="date" value="' + todayIso() + '"></label>' +
          '<label>Apresentação<select data-lesson-code>' + lessonOptions() + '</select></label>' +
          '<button class="student-lesson-save" data-save-student-lesson type="button"' + (canRegister ? '' : ' disabled') + '>' + (canRegister ? 'REGISTRAR APRESENTAÇÃO' : 'ATRIBUA UMA TURMA PRIMEIRO') + '</button>' +
          '<div class="student-lesson-message" data-lesson-message></div>' +
        '</div>' +
      '</div>';

    const button = details.querySelector("[data-save-student-lesson]");
    if (button && canRegister) {
      button.addEventListener("click", function () { saveLesson(userId, details, button); });
    }
    return details;
  }

  async function refreshUserRecords(userId) {
    const response = await Auth.getClient()
      .from("class_lesson_records")
      .select("id,class_number,user_id,class_date,lesson_code,created_at")
      .eq("user_id", userId)
      .order("class_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (response.error) throw response.error;
    recordsByUser.set(userId, response.data || []);
  }

  async function saveLesson(userId, panel, button) {
    const classSelect = panel.querySelector("[data-lesson-class]");
    const dateInput = panel.querySelector("[data-lesson-date]");
    const lessonSelect = panel.querySelector("[data-lesson-code]");
    const message = panel.querySelector("[data-lesson-message]");
    const classNumber = Number(classSelect && classSelect.value);
    const date = dateInput ? dateInput.value : "";
    const lessonCode = lessonSelect ? lessonSelect.value : "";

    message.className = "student-lesson-message";
    message.textContent = "";

    if (!Number.isInteger(classNumber) || classNumber < 1) {
      message.classList.add("error");
      message.textContent = "Selecione uma turma.";
      return;
    }
    if (!date) {
      message.classList.add("error");
      message.textContent = "Escolha a data da aula.";
      return;
    }
    if (!lessonCode) {
      message.classList.add("error");
      message.textContent = "Selecione a apresentação ou ocorrência.";
      return;
    }

    button.disabled = true;
    button.textContent = "SALVANDO...";

    try {
      const response = await Auth.getClient().rpc("save_teacher_class_lesson_record_by_ref", {
        target_class_number: classNumber,
        target_student_ref_id: userId,
        target_student_ref_type: "user",
        target_class_date: date,
        target_lesson_code: lessonCode
      });
      if (response.error) throw response.error;

      await refreshUserRecords(userId);
      const wasOpen = panel.open;
      const replacement = buildPanel(userId);
      replacement.open = wasOpen;
      panel.replaceWith(replacement);
      const newMessage = replacement.querySelector("[data-lesson-message]");
      if (newMessage) {
        newMessage.classList.add("success");
        newMessage.textContent = "Apresentação registrada com sucesso.";
      }
    } catch (error) {
      message.classList.add("error");
      message.textContent = "Não foi possível registrar a apresentação: " + (error.message || "erro desconhecido") + ".";
      button.disabled = false;
      button.textContent = "REGISTRAR APRESENTAÇÃO";
    }
  }

  function attachSections() {
    if (!dataLoaded) return;
    const cards = document.querySelectorAll("#studentProfilesList .student-card");
    cards.forEach(function (card) {
      if (card.querySelector(".student-lessons-panel")) return;
      const userId = getUserIdFromCard(card);
      if (!userId) return;
      const panel = buildPanel(userId);
      const actions = card.querySelector(".student-actions");
      if (actions) card.insertBefore(panel, actions);
      else card.appendChild(panel);
    });
  }

  function scheduleAttach() {
    clearTimeout(attachTimer);
    attachTimer = setTimeout(async function () {
      try {
        await loadData(false);
        attachSections();
      } catch (error) {
        console.error("Não foi possível carregar o histórico de apresentações dos alunos.", error);
      }
    }, 80);
  }

  async function init() {
    injectStyles();
    const ready = await waitForResources();
    if (!ready) return;

    try {
      const adminResponse = await Auth.getClient().rpc("is_teacher_admin");
      if (adminResponse.error || adminResponse.data !== true) return;
      await loadData(false);
      attachSections();
    } catch (error) {
      console.error("Não foi possível iniciar o painel de apresentações dos alunos.", error);
    }

    const list = document.getElementById("studentProfilesList");
    if (list) {
      const observer = new MutationObserver(scheduleAttach);
      observer.observe(list, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
