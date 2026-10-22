(function (root) {
  "use strict";

  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const CLASS_DURATION_MINUTES = 90;
  const MIN_REASON_LENGTH = 8;
  const MAX_REASON_LENGTH = 500;

  function canAdjust(item, date) {
    if (!item || !DATE.test(String(date || "")) ||
        !["regular", "makeup"].includes(item.lesson_kind) ||
        !UUID.test(String(item.entry_id || "")) ||
        !UUID.test(String(item.student_id || "")) ||
        ["cancelled", "cancelled_finalized"].includes(item.attendance_status)) return false;
    const timestamp = new Date(item.starts_at);
    if (Number.isNaN(timestamp.getTime())) return false;
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(timestamp);
    const values = {};
    parts.forEach(function (part) {
      if (part.type !== "literal") values[part.type] = part.value;
    });
    return date === values.year + "-" + values.month + "-" + values.day;
  }

  function eligibleToMarkParticipation(item, date, currentTime) {
    if (!canAdjust(item, date)) return false;
    if (item.attendance_status === "present" ||
        item.attendance_status === "absent") return false;
    const start = new Date(item.starts_at).getTime();
    const now = currentTime === undefined ? Date.now() : currentTime;
    return Number.isFinite(now) && now >= start - 30 * 60000;
  }

  function elapsedSinceClassStart(startsAt, currentTime) {
    const start = new Date(startsAt).getTime();
    const now = currentTime === undefined ? Date.now() : currentTime;
    return Number.isFinite(start) && Number.isFinite(now) &&
      now >= start + CLASS_DURATION_MINUTES * 60000;
  }

  function normalizeClosedSessions(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.filter(function (row) {
      return Number.isInteger(row.class_number) && row.class_number > 0 &&
        !Number.isNaN(Date.parse(row.starts_at));
    }).map(function (row) {
      return Object.freeze({
        key: row.class_number + "|" + row.starts_at,
        classNumber: row.class_number,
        className: row.class_name || "Turma " + row.class_number,
        startsAt: row.starts_at,
        finalizedAt: row.finalized_at,
        finalized: true,
        students: Array.isArray(row.students) ? row.students : []
      });
    });
  }

  function create(client) {
    if (!client || typeof client.rpc !== "function") {
      throw new Error("Serviço de encerramento indisponível.");
    }

    const pending = new Map();
    async function getClosedSessions(date) {
      if (!DATE.test(String(date || ""))) {
        throw new Error("Data da aula inválida.");
      }
      const response = await client.rpc("get_teacher_v2_closed_sessions", {
        target_date: date
      });
      if (response.error) {
        if (["PGRST202", "42883"].includes(response.error.code)) {
          return { available: false, sessions: [] };
        }
        throw response.error;
      }
      return {
        available: true,
        sessions: normalizeClosedSessions(response.data)
      };
    }

    function execute(key, name, parameters) {
      if (pending.has(key)) return pending.get(key);
      const work = Promise.resolve().then(async function () {
        const response = await client.rpc(name, parameters);
        if (response.error) throw response.error;
        if (!response.data || response.data.ok !== true) {
          throw new Error("O servidor não confirmou a alteração.");
        }
        return response.data;
      }).finally(function () {
        pending.delete(key);
      });
      pending.set(key, work);
      return work;
    }

    function markParticipation(item, date) {
      if (!eligibleToMarkParticipation(item, date)) {
        throw new Error("Registro de participação indisponível para esta aula.");
      }
      return execute(item.entry_id + "|" + date + "|participation",
        "mark_teacher_v2_participation", {
          target_lesson_kind: item.lesson_kind,
          target_entry_id: item.entry_id,
          target_date: date
        });
    }

    function correctAttendance(item, date, attendanceStatus, reason) {
      const justification = String(reason || "").trim();
      if (!canAdjust(item, date) || !["present", "absent"].includes(attendanceStatus) ||
          justification.length < MIN_REASON_LENGTH ||
          justification.length > MAX_REASON_LENGTH) {
        throw new Error("Informe frequência válida e justificativa de 8 a 500 caracteres.");
      }
      return execute(item.entry_id + "|" + date + "|correction",
        "correct_teacher_v2_attendance", {
          target_lesson_kind: item.lesson_kind,
          target_entry_id: item.entry_id,
          target_date: date,
          target_status: attendanceStatus,
          target_reason: justification
        });
    }

    return Object.freeze({
      getClosedSessions: getClosedSessions,
      markParticipation: markParticipation,
      correctAttendance: correctAttendance
    });
  }

  root.TeacherSessionLifecycle = Object.freeze({
    canAdjust: canAdjust,
    create: create,
    elapsedSinceClassStart: elapsedSinceClassStart,
    eligibleToMarkParticipation: eligibleToMarkParticipation,
    normalizeClosedSessions: normalizeClosedSessions
  });
})(typeof window !== "undefined" ? window : globalThis);
