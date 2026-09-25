(function () {
  const TZ = "America/Sao_Paulo";
  const CUTOFF = "2026-07-30";
  const DAY_MS = 86400000;
  const ROADMAP_TOTAL = 24;
  const FLASHCARD_GOAL = 3;
  let currentSession = null;
  let radarRows = [];

  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  async function waitForResources() {
    for (let i = 0; i < 15; i++) {
      if (window.Auth && window.SUPABASE_CONFIG && Auth.isConfigured()) return true;
      await sleep(150);
    }
    return !!(window.Auth && window.SUPABASE_CONFIG && Auth.isConfigured());
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function dateKeyInSaoPaulo(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone:TZ, year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(date);
    const values = {};
    parts.forEach(function (part) { if (part.type !== "literal") values[part.type] = part.value; });
    return values.year + "-" + values.month + "-" + values.day;
  }

  function keyToMs(key) {
    const m = String(key || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
  }

  function msToKey(ms) {
    const d = new Date(ms);
    return d.getUTCFullYear() + "-" + String(d.getUTCMonth()+1).padStart(2,"0") + "-" + String(d.getUTCDate()).padStart(2,"0");
  }

  function addDays(key, days) { return msToKey(keyToMs(key) + days * DAY_MS); }

  function getStartDate(profile) {
    const stored = profile.exercise_schedule_start_date ? String(profile.exercise_schedule_start_date).slice(0,10) : "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(stored)) return stored;
    const created = profile.created_at ? dateKeyInSaoPaulo(profile.created_at) : "";
    if (!created || created <= CUTOFF) return CUTOFF;
    return created;
  }

  function getWeekInfo(profile) {
    const start = getStartDate(profile);
    const today = dateKeyInSaoPaulo(new Date());
    const elapsed = Math.max(0, Math.floor((keyToMs(today) - keyToMs(start)) / DAY_MS));
    const week = Math.floor(elapsed / 7) + 1;
    const currentStart = addDays(start, (week - 1) * 7);
    return {
      week: week,
      currentStart: currentStart,
      currentEnd: addDays(currentStart, 6),
      previousStart: week > 1 ? addDays(currentStart, -7) : null,
      previousEnd: week > 1 ? addDays(currentStart, -1) : null
    };
  }

  function activityNumber(title) {
    const m = String(title || "").match(/ATIVIDADE\s+(\d+)/i);
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
  }

  function normalizeStatus(value) {
    return String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function attendanceKind(value) {
    const status = normalizeStatus(value);
    if (!status) return "excluded";
    if (status === "nao compareceu") return "absent";
    if (status === "feriado" || status === "teacher cancelou" || status === "problemas tecnicos") return "excluded";
    return "present";
  }

  function daysSince(value) {
    if (!value) return null;
    const diff = Date.now() - new Date(value).getTime();
    return Math.max(0, Math.floor(diff / DAY_MS));
  }

  function relativeAccess(days) {
    if (days == null) return "Sem registro";
    if (days === 0) return "Hoje";
    if (days === 1) return "Há 1 dia";
    return "Há " + days + " dias";
  }

  function riskLabel(level) {
    if (level === "red") return "INTERVENÇÃO NECESSÁRIA";
    if (level === "yellow") return "ATENÇÃO";
    return "EM DIA";
  }

  function groupByUser(rows) {
    const map = new Map();
    (rows || []).forEach(function (row) {
      if (!map.has(row.user_id)) map.set(row.user_id, []);
      map.get(row.user_id).push(row);
    });
    return map;
  }

  async function loadData() {
    const client = Auth.getClient();
    const today = dateKeyInSaoPaulo(new Date());
    const accessStart = addDays(today, -90);
    const frequencyStart = addDays(today, -30);
    const flashcardStart = addDays(today, -21);

    const results = await Promise.all([
      client.from("profiles").select("id,name,email,enrolled,enrollment_code,exercise_schedule_start_date,created_at").eq("enrolled", true).eq("archived", false).order("name", { ascending:true }),
      client.rpc("get_public_teacher_exercises"),
      client.from("daily_exercise_completion").select("user_id,exercise_id,completed"),
      client.from("flashcard_practice_days").select("user_id,practice_date").gte("practice_date", flashcardStart),
      client.from("class_lesson_records").select("user_id,class_date,lesson_code").gte("class_date", frequencyStart),
      client.from("student_access_logs").select("user_id,accessed_at").gte("accessed_at", accessStart + "T00:00:00Z").order("accessed_at", { ascending:false }),
      client.from("study_roadmap_completion").select("user_id,lesson_number,lesson_id,completed"),
      client.from("class_students").select("user_id,class_number"),
      client.from("teacher_classes").select("class_number,class_name,is_active")
    ]);

    results.forEach(function (result) { if (result.error) throw result.error; });

    return {
      profiles: results[0].data || [],
      exercises: (results[1].data || []).map(function (item) { return { id:item.exercise_id, title:item.exercise_title, url:item.exercise_url, number:activityNumber(item.exercise_title) }; }),
      completions: results[2].data || [],
      flashcards: results[3].data || [],
      frequency: results[4].data || [],
      accesses: results[5].data || [],
      roadmap: results[6].data || [],
      memberships: results[7].data || [],
      classes: results[8].data || []
    };
  }

  function buildRadar(data) {
    const completionByUser = groupByUser(data.completions);
    const flashByUser = groupByUser(data.flashcards);
    const frequencyByUser = groupByUser(data.frequency);
    const accessByUser = groupByUser(data.accesses);
    const roadmapByUser = groupByUser(data.roadmap);
    const membershipByUser = new Map(data.memberships.map(function (r) { return [r.user_id, r.class_number]; }));
    const classByNumber = new Map(data.classes.map(function (r) { return [r.class_number, r.class_name || ("Turma " + r.class_number)]; }));

    return data.profiles.map(function (profile) {
      const week = getWeekInfo(profile);
      const completions = new Map((completionByUser.get(profile.id) || []).map(function (r) { return [r.exercise_id, r.completed === true]; }));
      const overdue = data.exercises.filter(function (ex) { return Number.isFinite(ex.number) && ex.number < week.week && completions.get(ex.id) !== true; }).sort(function (a,b) { return a.number-b.number; });

      const flashRows = flashByUser.get(profile.id) || [];
      const previousFlashcards = week.previousStart ? new Set(flashRows.filter(function (r) {
        const key = String(r.practice_date).slice(0,10);
        return key >= week.previousStart && key <= week.previousEnd;
      }).map(function (r) { return String(r.practice_date).slice(0,10); })).size : null;

      const freqRows = frequencyByUser.get(profile.id) || [];
      const attendanceRows = freqRows.map(function (r) {
        return attendanceKind(r.lesson_code);
      }).filter(function (kind) {
        return kind !== "excluded";
      });
      const attendanceTotal = attendanceRows.length;
      const attendancePresent = attendanceRows.filter(function (kind) { return kind === "present"; }).length;
      const attendanceRate = attendanceTotal ? Math.round(attendancePresent / attendanceTotal * 100) : null;

      const userAccesses = accessByUser.get(profile.id) || [];
      const lastAccess = userAccesses.length ? userAccesses[0].accessed_at : null;
      const accessDays = daysSince(lastAccess);

      const roadRows = roadmapByUser.get(profile.id) || [];
      const doneRoadmap = new Set();
      roadRows.forEach(function (r) {
        if (r.completed !== true) return;
        const n = Number(r.lesson_number || String(r.lesson_id || "").replace("lesson-", ""));
        if (Number.isFinite(n)) doneRoadmap.add(n);
      });
      let nextLesson = null;
      for (let n=1; n<=ROADMAP_TOTAL; n++) { if (!doneRoadmap.has(n)) { nextLesson=n; break; } }

      let score = 0;
      const reasons = [];
      const actions = [];

      if (overdue.length >= 3) {
        score += 3;
        reasons.push(overdue.length + " atividades anteriores estão atrasadas.");
        actions.push("Priorizar a conclusão das atividades atrasadas começando pela Atividade " + overdue[0].number + ".");
      } else if (overdue.length === 2) {
        score += 2;
        reasons.push("2 atividades anteriores estão atrasadas.");
        actions.push("Orientar o aluno a concluir as duas atividades atrasadas em ordem numérica.");
      } else if (overdue.length === 1) {
        score += 1;
        reasons.push("1 atividade anterior está atrasada.");
        actions.push("Solicitar a conclusão da Atividade " + overdue[0].number + ".");
      }

      if (previousFlashcards != null) {
        if (previousFlashcards === 0) {
          score += 2;
          reasons.push("Não houve prática de flashcards na última semana completa.");
          actions.push("Reforçar a meta de praticar flashcards em 3 dias distintos por semana.");
        } else if (previousFlashcards < FLASHCARD_GOAL) {
          score += 1;
          reasons.push("Flashcards abaixo da meta: " + previousFlashcards + "/3 dias na última semana completa.");
          actions.push("Orientar o aluno a distribuir a prática de flashcards em pelo menos 3 dias.");
        }
      }

      if (attendanceTotal >= 2 && attendanceRate < 60) {
        score += 3;
        reasons.push("Frequência recente baixa: " + attendanceRate + "% em " + attendanceTotal + " aulas.");
        actions.push("Verificar faltas recentes e necessidade de reposição ou contato.");
      } else if (attendanceTotal >= 2 && attendanceRate < 75) {
        score += 2;
        reasons.push("Frequência recente exige atenção: " + attendanceRate + "%.");
        actions.push("Acompanhar a frequência nas próximas aulas.");
      } else if (attendanceTotal >= 2 && attendanceRate < 85) {
        score += 1;
        reasons.push("Frequência recente abaixo de 85%: " + attendanceRate + "%.");
      }

      if (accessDays == null && week.week > 1) {
        score += 1;
        reasons.push("Nenhum acesso ao portal foi registrado nos últimos 90 dias.");
        actions.push("Confirmar se o aluno está conseguindo acessar o portal normalmente.");
      } else if (accessDays != null && accessDays > 21) {
        score += 3;
        reasons.push("Último acesso ao portal foi há " + accessDays + " dias.");
        actions.push("Entrar em contato para verificar desengajamento ou dificuldade de acesso.");
      } else if (accessDays != null && accessDays > 14) {
        score += 2;
        reasons.push("Último acesso ao portal foi há " + accessDays + " dias.");
        actions.push("Estimular o retorno ao portal e acompanhar a próxima semana.");
      } else if (accessDays != null && accessDays > 7) {
        score += 1;
        reasons.push("O aluno está há mais de uma semana sem acessar o portal.");
      }

      if (week.week >= 4 && doneRoadmap.size === 0) {
        score += 1;
        reasons.push("Nenhuma lição do Roteiro de Estudos foi marcada como concluída após pelo menos 4 semanas.");
        actions.push("Retomar o Roteiro de Estudos e definir a próxima lição a preparar.");
      } else if (week.week >= 8 && doneRoadmap.size < 2) {
        score += 1;
        reasons.push("Avanço muito baixo no Roteiro de Estudos para o tempo de matrícula.");
        actions.push("Revisar com o aluno como as lições do roteiro estão sendo preparadas e apresentadas.");
      }

      if (!reasons.length) reasons.push("Nenhum sinal relevante de atenção foi identificado pelos dados disponíveis.");
      if (!actions.length) actions.push("Manter o acompanhamento regular.");

      let level = "green";
      if (score >= 4 || overdue.length >= 3 || (accessDays != null && accessDays > 21) || (attendanceTotal >= 3 && attendanceRate < 60)) level = "red";
      else if (score >= 2 || overdue.length >= 1 || (accessDays != null && accessDays > 7)) level = "yellow";

      const classNumber = membershipByUser.get(profile.id) || null;
      return {
        id: profile.id,
        name: profile.name || profile.email || "Aluno",
        email: profile.email || "",
        className: classNumber ? (classByNumber.get(classNumber) || ("Turma " + classNumber)) : "Sem turma",
        level: level,
        score: score,
        overdue: overdue,
        previousFlashcards: previousFlashcards,
        attendanceRate: attendanceRate,
        attendanceTotal: attendanceTotal,
        lastAccess: lastAccess,
        accessDays: accessDays,
        roadmapCompleted: doneRoadmap.size,
        nextLesson: nextLesson,
        reasons: reasons,
        actions: actions
      };
    }).sort(function (a,b) {
      const rank = { red:0, yellow:1, green:2 };
      return rank[a.level] - rank[b.level] || b.score - a.score || a.name.localeCompare(b.name, "pt-BR", { sensitivity:"base" });
    });
  }

  function renderSummary(rows) {
    document.getElementById("totalStudents").textContent = String(rows.length);
    document.getElementById("redStudents").textContent = String(rows.filter(function (r) { return r.level === "red"; }).length);
    document.getElementById("yellowStudents").textContent = String(rows.filter(function (r) { return r.level === "yellow"; }).length);
    document.getElementById("greenStudents").textContent = String(rows.filter(function (r) { return r.level === "green"; }).length);
  }

  function metric(label, value) {
    return '<div class="metric"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong></div>';
  }

  function renderRows() {
    const q = document.getElementById("searchStudent").value.trim().toLowerCase();
    const filter = document.getElementById("riskFilter").value;
    const rows = radarRows.filter(function (row) {
      const matchesText = !q || row.name.toLowerCase().includes(q) || row.email.toLowerCase().includes(q);
      return matchesText && (!filter || row.level === filter);
    });

    const list = document.getElementById("radarList");
    if (!rows.length) {
      list.innerHTML = '<div class="empty">Nenhum aluno corresponde aos filtros selecionados.</div>';
      return;
    }

    list.innerHTML = rows.map(function (row) {
      const flashText = row.previousFlashcards == null ? "Primeira semana" : row.previousFlashcards + "/3 dias";
      const attendanceText = row.attendanceRate == null ? "Sem dados" : row.attendanceRate + "% (" + row.attendanceTotal + ")";
      const roadmapText = row.nextLesson ? row.roadmapCompleted + "/" + ROADMAP_TOTAL + " · próxima " + row.nextLesson : ROADMAP_TOTAL + "/" + ROADMAP_TOTAL;
      return '<article class="student-card ' + row.level + '">' +
        '<div class="student-head"><div><div class="student-name">' + esc(row.name) + '</div><div class="student-meta">' + esc(row.email) + ' · ' + esc(row.className) + '</div></div><span class="risk-badge ' + row.level + '">' + esc(riskLabel(row.level)) + '</span></div>' +
        '<div class="metrics">' +
          metric("Atividades atrasadas", String(row.overdue.length)) +
          metric("Flashcards · última semana", flashText) +
          metric("Frequência · 30 dias", attendanceText) +
          metric("Último acesso", relativeAccess(row.accessDays)) +
          metric("Roteiro", roadmapText) +
        '</div>' +
        '<div class="card-actions"><button class="detail-button" type="button" data-detail-id="' + esc(row.id) + '">VER O QUE PRECISA SER FEITO</button><a class="link-button" href="/perfil-dos-alunos/">ABRIR ALUNOS</a><a class="link-button" href="/relatorios/">ABRIR RELATÓRIOS</a></div>' +
        '<div id="detail-' + esc(row.id) + '" class="details" hidden><div><h3>Por que recebeu esta classificação</h3><ul>' + row.reasons.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div><div><h3>Ações recomendadas</h3><ul>' + row.actions.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div></div>' +
      '</article>';
    }).join("");

    document.querySelectorAll("[data-detail-id]").forEach(function (button) {
      button.addEventListener("click", function () {
        const detail = document.getElementById("detail-" + button.dataset.detailId);
        detail.hidden = !detail.hidden;
        button.textContent = detail.hidden ? "VER O QUE PRECISA SER FEITO" : "FECHAR DIAGNÓSTICO";
      });
    });
  }

  async function refreshRadar() {
    const button = document.getElementById("refreshRadar");
    button.disabled = true;
    document.getElementById("radarList").innerHTML = '<div class="empty">Atualizando radar...</div>';
    try {
      const data = await loadData();
      radarRows = buildRadar(data);
      renderSummary(radarRows);
      renderRows();
      document.getElementById("radarStatus").textContent = "Radar atualizado com dados atuais do portal.";
    } catch (error) {
      console.error("Erro ao carregar Radar de Alunos:", error);
      document.getElementById("radarList").innerHTML = '<div class="empty">Não foi possível carregar o radar. Atualize a página e tente novamente.</div>';
      document.getElementById("radarStatus").textContent = "Erro ao carregar os dados do radar.";
    } finally {
      button.disabled = false;
    }
  }

  async function init() {
    const ready = await waitForResources();
    if (!ready) {
      document.body.classList.remove("auth-checking");
      document.getElementById("radarStatus").textContent = "Não foi possível carregar a autenticação.";
      return;
    }

    currentSession = await Auth.getSession();
    if (!currentSession || !currentSession.user) {
      window.location.href = "/login.html?next=" + encodeURIComponent("/radar-de-alunos/");
      return;
    }

    try {
      const admin = await Auth.getClient().rpc("is_teacher_admin");
      if (admin.error) throw admin.error;
      if (admin.data !== true) {
        document.body.classList.remove("auth-checking");
        document.getElementById("radarStatus").textContent = "Acesso negado. Esta página é exclusiva do professor.";
        return;
      }
      document.getElementById("dashboard").hidden = false;
      document.body.classList.remove("auth-checking");
      await refreshRadar();
    } catch (error) {
      document.body.classList.remove("auth-checking");
      document.getElementById("radarStatus").textContent = "Não foi possível confirmar as credenciais administrativas.";
    }
  }

  document.getElementById("refreshRadar").addEventListener("click", refreshRadar);
  document.getElementById("searchStudent").addEventListener("input", renderRows);
  document.getElementById("riskFilter").addEventListener("change", renderRows);
  init();
})();