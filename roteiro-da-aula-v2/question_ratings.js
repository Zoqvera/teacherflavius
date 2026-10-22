(function (root) {
  "use strict";

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const RATINGS = Object.freeze({
    good: "BOM",
    medium: "MÉDIO",
    improve: "MELHORAR"
  });
  const BLOCKED_ATTENDANCE = Object.freeze(["absent", "cancelled", "cancelled_finalized"]);
  const WRITE_RPC = "rate_teacher_conversation_question_v2";
  const HISTORY_RPC = "get_teacher_question_rating_history_v2";

  function occurrenceKey(item) {
    return String(item.student_id).toLowerCase() + "|" + item.starts_at;
  }

  function validDate(date) {
    const raw = String(date || "");
    const parsed = DATE.test(raw) ? new Date(raw + "T12:00:00Z") : new Date(NaN);
    return !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === raw;
  }

  function localDate(startsAt) {
    const date = new Date(startsAt);
    if (Number.isNaN(date.getTime())) return null;
    const pieces = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(date);
    const values = {};
    pieces.forEach(function (piece) {
      if (piece.type !== "literal") values[piece.type] = piece.value;
    });
    return values.year + "-" + values.month + "-" + values.day;
  }

  function studiedForClass(item, questionId) {
    return ["today_questions", "review_questions"].some(function (section) {
      return Array.isArray(item[section]) && item[section].some(function (question) {
        return String(question.id).toLowerCase() === questionId;
      });
    });
  }

  function currentRating(evaluations, questionId) {
    return (Array.isArray(evaluations) ? evaluations : []).find(function (record) {
      return record.is_current === true &&
        String(record.question_id || "").toLowerCase() === String(questionId).toLowerCase();
    }) || null;
  }

  function latestRating(evaluations, questionId) {
    return (Array.isArray(evaluations) ? evaluations : []).find(function (record) {
      return String(record.question_id || "").toLowerCase() === String(questionId).toLowerCase();
    }) || null;
  }

  function ratingLabel(value) {
    return RATINGS[value] || "NÃO AVALIADA";
  }

  function canRate(item, classDate, questionId, evaluations) {
    if (!item || !validDate(classDate) || localDate(item.starts_at) !== classDate ||
        !["regular", "makeup"].includes(item.lesson_kind) ||
        !UUID.test(String(item.entry_id || "")) ||
        !UUID.test(String(item.student_id || "")) ||
        !UUID.test(String(questionId || "")) ||
        BLOCKED_ATTENDANCE.includes(item.attendance_status) ||
        !studiedForClass(item, String(questionId).toLowerCase())) return false;

    return !currentRating(evaluations, questionId);
  }

  function create(client) {
    if (!client || typeof client.rpc !== "function") {
      throw new Error("Serviço de avaliações indisponível.");
    }
    const pending = new Map();
    const confirmed = new Map();

    async function getHistory(classDate) {
      if (!validDate(classDate)) throw new Error("Data da aula inválida.");
      const response = await client.rpc(HISTORY_RPC, { target_date: classDate });
      if (response.error) {
        if (response.error.code === "PGRST202" || response.error.code === "42883") {
          return { available: false, byOccurrence: new Map() };
        }
        throw response.error;
      }
      const result = new Map();
      (Array.isArray(response.data) ? response.data : []).forEach(function (row) {
        if (row && Array.isArray(row.evaluations)) {
          result.set(occurrenceKey(row), row.evaluations);
        }
      });
      return { available: true, byOccurrence: result };
    }

    function rate(item, classDate, questionId, rating, evaluations) {
      if (!Object.hasOwn(RATINGS, rating) ||
          !canRate(item, classDate, questionId, evaluations)) {
        throw new Error("Pergunta indisponível para avaliação nesta aula.");
      }

      const normalizedId = String(questionId).toLowerCase();
      const key = [
        item.lesson_kind, item.entry_id, classDate, normalizedId
      ].join("|");
      if (confirmed.has(key)) return Promise.resolve(confirmed.get(key));
      if (pending.has(key)) return pending.get(key);

      const request = Promise.resolve().then(async function () {
        const response = await client.rpc(WRITE_RPC, {
          target_lesson_kind: item.lesson_kind,
          target_entry_id: item.entry_id,
          target_date: classDate,
          target_question_id: normalizedId,
          target_rating: rating
        });
        if (response.error) throw response.error;
        const result = response.data;
        if (!result || result.ok !== true ||
            !Object.hasOwn(RATINGS, result.rating) ||
            !UUID.test(String(result.occurrence_id || "")) ||
            result.attendance_status !== "present") {
          throw new Error("O servidor não confirmou a avaliação.");
        }
        confirmed.set(key, result);
        return result;
      }).finally(function () {
        pending.delete(key);
      });

      pending.set(key, request);
      return request;
    }

    return Object.freeze({
      getHistory: getHistory,
      rate: rate
    });
  }

  root.TeacherQuestionRatings = Object.freeze({
    canRate: canRate,
    create: create,
    currentRating: currentRating,
    latestRating: latestRating,
    occurrenceKey: occurrenceKey,
    ratingLabel: ratingLabel
  });
})(typeof window !== "undefined" ? window : globalThis);
