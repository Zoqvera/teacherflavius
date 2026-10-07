(function () {
  "use strict";

  const LEGACY_LESSON_FILE_IDS = Object.freeze({
    1: "1IcPBeVjsZfm0RnqqUwhDhwoF2QY3qIA1",
    2: "1LDXrDtGGiMKNUe_DWFSLu-k3IKQmQcYB",
    3: "1-Sav9gssbAMYVUqVv0-MdwvUxT-H3eGX",
    4: "1Rjq4Oqpx_JRsAECFGLtteRrSINIDmFER",
    5: "1Ke_jLAODBKpd0OLaFF8sklof6JcperdY",
    6: "1TP5NADYwClQGFo77ev443famp63-O4ry",
    7: "1NeR_jXZWRv7qboHEG1LslyWTSzRGs1tm",
    8: "1m_63uJwB_ag9wFt1TB9uCr2MjjLUqUum",
    9: "18uEqMcwSVZKE8l6p_RtWMiMGdZutoOgW",
    10: "1XeKm2x-kuv69q7LsVDjek-AYLTicHbIe",
    11: "1IQmyLLn48kYy5jwtXHPcTo2ND7BtoUiX",
    12: "1Y8GfT5usJloYaqjJ3QDbDjGr7qtjv5Ja",
    13: "1yv3OFxTGA0mBDQUSLr0XimUuiXWO9rYq",
    14: "1616T4D-rOJUFVjQksrgicKxSowjJ1w1B",
    15: "18rFFtbEAMbjDfOEyKv0G0BMusJE8BjAe",
    16: "1HmYII_gk0BAiscuNwsGZON7QSX5dtLzZ",
    17: "1tACff-0CckERLisJ9A3vGWekDQ3Jlq9D",
    18: "1aaeAIOGJwSfLZYWp0yeFUv7uUaM2cYcx",
    19: "1tNKSboLBxpQczN3kgil2eMHiMi1kG9VC",
    20: "1CFnlK6IpYY5IDWMcRn_buS4EuXWcdyF5"
  });

  function requireClient(client) {
    if (!client) throw new Error("Cliente Supabase indisponível.");
    return client;
  }

  function normalizeLessonNumber(value) {
    const lessonNumber = Number(value);
    return Number.isInteger(lessonNumber) && lessonNumber >= 1 && lessonNumber <= 74
      ? lessonNumber
      : null;
  }

  function normalizeDate(value) {
    const date = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error("Data da aula inválida.");
    }
    return date;
  }

  function lessonUrl(lessonNumber) {
    const normalized = normalizeLessonNumber(lessonNumber);
    if (!normalized) return "";
    return "/licao/?lesson=" + encodeURIComponent(normalized);
  }

  function legacyLessonPreviewUrl(lessonNumber) {
    const normalized = normalizeLessonNumber(lessonNumber);
    const fileId = normalized ? LEGACY_LESSON_FILE_IDS[normalized] : null;
    return fileId ? "https://drive.google.com/file/d/" + fileId + "/preview" : "";
  }

  function unwrap(response) {
    if (response.error) throw response.error;
    return response.data;
  }

  function create(client) {
    const supabase = requireClient(client);

    async function hydrateQuestions(questions) {
      if (!Array.isArray(questions) || questions.length === 0) return [];

      const ids = Array.from(new Set(questions
        .map(function (question) { return question && question.id; })
        .filter(Boolean)));

      if (!ids.length) return questions;

      const response = await supabase
        .from("conversation_questions")
        .select("id,question_text,question_translation,answer_examples,display_order")
        .in("id", ids);

      const rows = unwrap(response) || [];
      const byId = new Map(rows.map(function (row) {
        return [row.id, row];
      }));

      return questions.map(function (question) {
        const row = byId.get(question.id);
        if (!row) return question;

        return Object.assign({}, question, {
          text: row.question_text,
          translation: row.question_translation,
          examples: row.answer_examples,
          display_order: row.display_order
        });
      });
    }

    async function getMyActionPlan() {
      const plan = unwrap(await supabase.rpc("get_my_action_plan"));
      if (!plan) return plan;

      plan.questions = await hydrateQuestions(plan.questions);
      return plan;
    }

    async function markLessonPrepared(lessonNumber) {
      const normalized = normalizeLessonNumber(lessonNumber);
      if (!normalized) throw new Error("Lição inválida.");
      return unwrap(await supabase.rpc("mark_my_lesson_prepared", {
        target_lesson_number: normalized
      }));
    }

    async function markQuestionsStudied(questionIds) {
      if (!Array.isArray(questionIds) || questionIds.length === 0) {
        throw new Error("Perguntas inválidas.");
      }
      return unwrap(await supabase.rpc("mark_my_questions_studied", {
        target_question_ids: questionIds
      }));
    }

    async function markQuestionStudied(questionId) {
      const normalizedQuestionId = String(questionId || "").trim();
      if (!normalizedQuestionId) throw new Error("Pergunta inválida.");
      return markQuestionsStudied([normalizedQuestionId]);
    }

    async function hydrateTeacherLessonPlan(items) {
      const planItems = Array.isArray(items) ? items : [];
      const allQuestions = [];

      planItems.forEach(function (item) {
        if (Array.isArray(item.new_questions)) {
          allQuestions.push.apply(allQuestions, item.new_questions);
        }
        if (Array.isArray(item.review_questions)) {
          allQuestions.push.apply(allQuestions, item.review_questions);
        }
      });

      if (!allQuestions.length) return planItems;

      const hydrated = await hydrateQuestions(allQuestions);
      const byId = new Map(hydrated.map(function (question) {
        return [question.id, question];
      }));

      function hydrateCollection(questions) {
        return (Array.isArray(questions) ? questions : []).map(function (question) {
          return byId.get(question.id) || question;
        });
      }

      return planItems.map(function (item) {
        return Object.assign({}, item, {
          new_questions: hydrateCollection(item.new_questions),
          review_questions: hydrateCollection(item.review_questions)
        });
      });
    }

    async function getTeacherLessonPlan(classDate) {
      const items = unwrap(await supabase.rpc("get_teacher_lesson_plan", {
        target_date: normalizeDate(classDate)
      })) || [];
      return hydrateTeacherLessonPlan(items);
    }

    async function finalizeTeacherLessonSession(classNumber, startsAt, classDate) {
      const normalizedClassNumber = Number(classNumber);
      const normalizedStartsAt = String(startsAt || "").trim();

      if (!Number.isInteger(normalizedClassNumber) || normalizedClassNumber <= 0) {
        throw new Error("Turma inválida.");
      }
      if (!normalizedStartsAt || Number.isNaN(Date.parse(normalizedStartsAt))) {
        throw new Error("Horário da aula inválido.");
      }

      return unwrap(await supabase.rpc("finalize_teacher_lesson_session", {
        target_class_number: normalizedClassNumber,
        target_starts_at: normalizedStartsAt,
        target_date: normalizeDate(classDate)
      }));
    }

    async function setAttendance(item, classDate, status) {
      return unwrap(await supabase.rpc("set_teacher_lesson_attendance", {
        target_lesson_kind: item.lesson_kind,
        target_entry_id: item.entry_id,
        target_date: normalizeDate(classDate),
        target_status: status
      }));
    }

    async function markLessonPresented(item, classDate) {
      const lessonNumber = normalizeLessonNumber(item.lesson_number);
      if (!lessonNumber) throw new Error("Não há lição prevista para registrar.");
      return unwrap(await supabase.rpc("mark_teacher_lesson_presented", {
        target_lesson_kind: item.lesson_kind,
        target_entry_id: item.entry_id,
        target_date: normalizeDate(classDate),
        target_lesson_number: lessonNumber
      }));
    }

    async function rateQuestion(item, classDate, questionId, rating) {
      return unwrap(await supabase.rpc("rate_teacher_conversation_question", {
        target_lesson_kind: item.lesson_kind,
        target_entry_id: item.entry_id,
        target_date: normalizeDate(classDate),
        target_question_id: questionId,
        target_rating: rating
      }));
    }

    return Object.freeze({
      finalizeTeacherLessonSession,
      getMyActionPlan,
      getTeacherLessonPlan,
      markLessonPrepared,
      markLessonPresented,
      markQuestionStudied,
      markQuestionsStudied,
      rateQuestion,
      setAttendance
    });
  }

  window.AcademicWorkflowService = Object.freeze({
    create,
    lessonUrl,
    legacyLessonPreviewUrl,
    normalizeLessonNumber
  });
})();
