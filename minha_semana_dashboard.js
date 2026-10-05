(function () {
  const FLASHCARD_WEEKLY_GOAL = 3;
  const ROADMAP_TOTAL = 24;
  let currentUser = null;

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

  function formatDate(key) {
    const match = String(key || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? match[3] + "/" + match[2] : String(key || "");
  }

  function activityNumber(title) {
    const match = String(title || "").match(/ATIVIDADE\s+(\d+)/i);
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
  }

  function normalize(value) {
    return String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function isPresent(value) {
    const status = normalize(value);
    return status.includes("compareceu") || status === "presente" || status === "present";
  }

  function weekdayLabel(value) {
    return ({ 1:"segunda-feira", 2:"terça-feira", 3:"quarta-feira", 4:"quinta-feira", 5:"sexta-feira", 6:"sábado", 7:"domingo" })[Number(value)] || "dia não definido";
  }

  function timeLabel(value) {
    const match = String(value || "").match(/^(\d{2}):(\d{2})/);
    if (!match) return "horário não definido";
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    return minute === 0 ? hour + "h" : hour + "h" + String(minute).padStart(2, "0");
  }

  function localNowParts() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone:"America/Sao_Paulo", year:"numeric", month:"2-digit", day:"2-digit",
      hour:"2-digit", minute:"2-digit", hourCycle:"h23"
    }).formatToParts(new Date());
    const values = {};
    parts.forEach(function (part) { if (part.type !== "literal") values[part.type] = part.value; });
    const key = values.year + "-" + values.month + "-" + values.day;
    const date = new Date(key + "T00:00:00Z");
    let weekday = date.getUTCDay();
    if (weekday === 0) weekday = 7;
    return { key:key, weekday:weekday, minutes:Number(values.hour) * 60 + Number(values.minute) };
  }

  function nextClassText(classInfo) {
    if (!classInfo || !classInfo.class_weekday || !classInfo.class_start_time) return "Horário semanal ainda não configurado";
    const now = localNowParts();
    const timeMatch = String(classInfo.class_start_time).match(/^(\d{2}):(\d{2})/);
    const classMinutes = timeMatch ? Number(timeMatch[1]) * 60 + Number(timeMatch[2]) : 0;
    let delta = (Number(classInfo.class_weekday) - now.weekday + 7) % 7;
    if (delta === 0 && now.minutes >= classMinutes) delta = 7;
    return weekdayLabel(classInfo.class_weekday) + ", " + timeLabel(classInfo.class_start_time) + (delta === 0 ? " — hoje" : "");
  }

  async function loadProfile() {
    const response = await Auth.getClient().from("profiles")
      .select("id,name,email,enrolled,enrollment_code,archived")
      .eq("id", currentUser.id).limit(1);
    if (response.error) throw response.error;
    return response.data && response.data.length ? response.data[0] : null;
  }

  async function ensureWeek() {
    const response = await Auth.getClient().rpc("ensure_weekly_plan_snapshot", { target_user_id: currentUser.id });
    if (response.error) throw response.error;
    return response.data && response.data.length ? response.data[0] : null;
  }

  async function loadClassInfo() {
    const client = Auth.getClient();
    const membership = await client.from("class_students").select("class_number").eq("user_id", currentUser.id).limit(1);
    if (membership.error) throw membership.error;
    if (!membership.data || !membership.data.length) return null;
    const classNumber = membership.data[0].class_number;
    const response = await client.from("teacher_classes")
      .select("class_number,class_name,class_type,class_weekday,class_start_time")
      .eq("class_number", classNumber).limit(1);
    if (response.error) throw response.error;
    return response.data && response.data.length ? response.data[0] : null;
  }

  async function loadData(week) {
    const client = Auth.getClient();
    const results = await Promise.all([
      client.rpc("get_public_teacher_exercises"),
      client.from("daily_exercise_completion").select("exercise_id,completed").eq("user_id", currentUser.id),
      client.from("flashcard_practice_days").select("practice_date").eq("user_id", currentUser.id).gte("practice_date", week.week_start).lte("practice_date", week.week_end),
      client.from("grammar_lessons").select("id,title,created_at").order("created_at", { ascending:true }),
      client.from("grammar_lesson_completion").select("lesson_id,completed,completed_at").eq("user_id", currentUser.id),
      client.from("student_frequency").select("class_date,attendance_status").eq("user_id", currentUser.id).gte("class_date", week.week_start).lte("class_date", week.week_end),
      client.from("study_roadmap_completion").select("lesson_number,completed").eq("user_id", currentUser.id),
      loadClassInfo()
    ]);

    results.slice(0, 7).forEach(function (result) { if (result.error) throw result.error; });

    return {
      exercises: (results[0].data || []).map(function (item) {
        return { id:item.exercise_id, title:item.exercise_title, url:item.exercise_url, number:activityNumber(item.exercise_title) };
      }).filter(function (item) { return item.id; }).sort(function (a,b) { return a.number-b.number; }),
      exerciseCompletions: new Map((results[1].data || []).map(function (row) { return [row.exercise_id, row.completed === true]; })),
      practiceDates: Array.from(new Set((results[2].data || []).map(function (row) { return String(row.practice_date).slice(0,10); }))),
      grammarLessons: results[3].data || [],
      grammarCompletions: results[4].data || [],
      frequency: results[5].data || [],
      roadmap: results[6].data || [],
      classInfo: results[7]
    };
  }

  function buildState(week, data) {
    const currentExercise = data.exercises.find(function (ex) { return ex.number === Number(week.week_number); }) || null;
    const overdue = data.exercises.filter(function (ex) {
      return Number.isFinite(ex.number) && ex.number < Number(week.week_number) && data.exerciseCompletions.get(ex.id) !== true;
    });

    const currentExerciseDone = !!(currentExercise && data.exerciseCompletions.get(currentExercise.id) === true);
    const flashDone = data.practiceDates.length >= FLASHCARD_WEEKLY_GOAL;
    const classDone = data.frequency.some(function (row) { return isPresent(row.attendance_status); });
    const classTrackable = classDone || !!(data.classInfo && data.classInfo.class_weekday && data.classInfo.class_start_time);

    const grammarDoneThisWeek = data.grammarCompletions.some(function (row) {
      if (row.completed !== true || !row.completed_at) return false;
      const key = new Intl.DateTimeFormat("en-CA", { timeZone:"America/Sao_Paulo", year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date(row.completed_at));
      return key >= week.week_start && key <= week.week_end;
    });
    const completedGrammarIds = new Set(data.grammarCompletions.filter(function (row) { return row.completed === true; }).map(function (row) { return row.lesson_id; }));
    const nextGrammar = data.grammarLessons.find(function (lesson) { return !completedGrammarIds.has(lesson.id); }) || null;
    const grammarTrackable = grammarDoneThisWeek || !!nextGrammar;

    const completedRoadmap = new Set(data.roadmap.filter(function (row) { return row.completed === true; }).map(function (row) { return Number(row.lesson_number); }));
    let nextRoadmap = null;
    for (let number=1; number<=ROADMAP_TOTAL; number++) {
      if (!completedRoadmap.has(number)) { nextRoadmap = number; break; }
    }

    const tasks = [];
    if (classTrackable) {
      tasks.push({
        key:"class", icon:classDone ? "✅" : "📅", tone:classDone ? "done" : "pending",
        title:classDone ? "Aula da semana realizada" : "Aula da semana — pendente",
        detail:data.classInfo && data.classInfo.class_weekday ? weekdayLabel(data.classInfo.class_weekday) + ", " + timeLabel(data.classInfo.class_start_time) : "Frequência ainda não registrada nesta semana",
        done:classDone, href:"/minha-turma/", button:"VER MINHA TURMA"
      });
    }

    overdue.forEach(function (exercise) {
      tasks.push({ key:"overdue-" + exercise.id, icon:"🔴", tone:"danger", title:exercise.title + " — atrasada", detail:"Atividade de uma semana anterior ainda não concluída.", done:false, href:exercise.url || "/exercicios-diarios/", button:"FAZER ATIVIDADE" });
    });

    if (currentExercise) {
      tasks.push({
        key:"current-exercise", icon:currentExerciseDone ? "✅" : "🟣", tone:currentExerciseDone ? "done" : "current",
        title:currentExercise.title + (currentExerciseDone ? " — concluída" : " — fazer esta semana"),
        detail:"Atividade correspondente à Semana " + week.week_number + ".", done:currentExerciseDone,
        href:currentExercise.url || "/exercicios-diarios/", button:currentExerciseDone ? "ABRIR ATIVIDADE" : "FAZER ATIVIDADE"
      });
    }

    tasks.push({
      key:"flashcards", icon:"🧠", tone:flashDone ? "done" : "pending",
      title:"Flashcards — " + Math.min(data.practiceDates.length, FLASHCARD_WEEKLY_GOAL) + "/3 dias praticados",
      detail:flashDone ? "Meta semanal atingida." : "Pratique em " + (FLASHCARD_WEEKLY_GOAL - data.practiceDates.length) + " dia(s) diferente(s) para completar a meta.",
      done:flashDone, href:"/flashcards/", button:"PRATICAR FLASHCARDS"
    });

    if (grammarTrackable) {
      tasks.push({
        key:"grammar", icon:grammarDoneThisWeek ? "✅" : "📚", tone:grammarDoneThisWeek ? "done" : "pending",
        title:grammarDoneThisWeek ? "Aula de gramática — realizada nesta semana" : "Aula de gramática — pendente",
        detail:grammarDoneThisWeek ? "Você já concluiu uma aula de gramática nesta semana." : (nextGrammar ? "Próxima: " + nextGrammar.title : "Abra as aulas de gramática."),
        done:grammarDoneThisWeek, href:"/aulas-de-gramatica.html", button:"VER AULA DE GRAMÁTICA"
      });
    }

    return {
      tasks:tasks,
      doneCount:tasks.filter(function (task) { return task.done; }).length,
      totalCount:tasks.length,
      overdue:overdue,
      currentExercise:currentExercise,
      classInfo:data.classInfo,
      nextClass:nextClassText(data.classInfo),
      nextRoadmap:nextRoadmap
    };
  }

  function renderTask(task) {
    return '<article class="week-task ' + esc(task.tone) + '">' +
      '<div class="task-icon">' + esc(task.icon) + '</div>' +
      '<div class="task-body"><div class="task-title">' + esc(task.title) + '</div><div class="task-detail">' + esc(task.detail) + '</div></div>' +
      '<a class="task-button" href="' + esc(task.href) + '">' + esc(task.button) + '</a>' +
    '</article>';
  }

  function renderDashboard(profile, week, state) {
    const progress = state.totalCount ? Math.round(state.doneCount / state.totalCount * 100) : 100;
    document.getElementById("weekTitle").textContent = "SEMANA " + week.week_number + " — " + formatDate(week.week_start) + " a " + formatDate(week.week_end);
    document.getElementById("progressCount").textContent = state.doneCount + " de " + state.totalCount + " tarefas concluídas";
    document.getElementById("progressPercent").textContent = progress + "%";
    document.getElementById("progressFill").style.width = progress + "%";
    document.getElementById("taskList").innerHTML = state.tasks.length ? state.tasks.map(renderTask).join("") : '<div class="empty-panel">Nenhuma tarefa semanal disponível no momento.</div>';

    document.getElementById("nextClassValue").textContent = state.nextClass;
    document.getElementById("classNameValue").textContent = state.classInfo ? (state.classInfo.class_name || ("Turma " + state.classInfo.class_number)) : "Sem turma atribuída";

    const roadmap = document.getElementById("roadmapPanel");
    if (state.nextRoadmap) {
      roadmap.innerHTML = '<div><span class="info-kicker">ROTEIRO DE ESTUDOS</span><strong>Próxima lição: Lição ' + esc(state.nextRoadmap) + '</strong><p>Esta é a primeira lição ainda não marcada como concluída.</p></div><a class="info-button" href="/area-do-estudante/minhas-aulas/">ABRIR ROTEIRO</a>';
    } else {
      roadmap.innerHTML = '<div><span class="info-kicker">ROTEIRO DE ESTUDOS</span><strong>Roteiro concluído</strong><p>Todas as lições disponíveis foram concluídas.</p></div><a class="info-button" href="/area-do-estudante/minhas-aulas/">ABRIR ROTEIRO</a>';
    }

    document.getElementById("pageStatus").textContent = "Olá, " + (profile.name || profile.email || "aluno") + ". Aqui está o que você precisa fazer nesta semana.";
    document.getElementById("dashboard").hidden = false;
    document.getElementById("loadingPanel").hidden = true;
  }

  async function init() {
    const ready = await waitForResources();
    if (!ready) {
      document.body.classList.remove("auth-checking");
      document.getElementById("loadingPanel").textContent = "Não foi possível carregar a autenticação.";
      return;
    }

    const session = await Auth.getSession();
    if (!session || !session.user) {
      window.location.href = "/login.html?next=" + encodeURIComponent("/minha-semana/");
      return;
    }
    currentUser = session.user;

    try {
      const profile = await loadProfile();
      if (!profile || profile.enrolled !== true || profile.archived === true) {
        throw new Error("Esta página está disponível apenas para alunos ativos matriculados.");
      }
      const week = await ensureWeek();
      if (!week) throw new Error("Não foi possível identificar sua semana atual.");
      const data = await loadData(week);
      const state = buildState(week, data);
      renderDashboard(profile, week, state);
      document.body.classList.remove("auth-checking");
    } catch (error) {
      document.body.classList.remove("auth-checking");
      document.getElementById("loadingPanel").hidden = false;
      document.getElementById("loadingPanel").textContent = "Não foi possível montar sua semana: " + (error.message || "erro desconhecido") + ".";
      document.getElementById("pageStatus").textContent = "Erro ao carregar Minha Semana.";
    }
  }

  init();
})();
