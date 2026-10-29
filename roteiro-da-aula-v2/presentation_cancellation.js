(function (root) {
  "use strict";

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const ATTENDANCE_STATUSES = Object.freeze(["present", "absent"]);

  function validDate(value) {
    if (!DATE.test(value)) return false;
    const parsed = new Date(value + "T12:00:00Z");
    return !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value;
  }

  function localLessonDate(startsAt) {
    if (!startsAt || Number.isNaN(Date.parse(startsAt))) return null;
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date(startsAt));
    const values = {};
    parts.forEach(function (part) {
      if (part.type !== "literal") values[part.type] = part.value;
    });
    return values.year + "-" + values.month + "-" + values.day;
  }

  function canCancel(item) {
    return !!item &&
      (item.lesson_kind === "regular" || item.lesson_kind === "makeup") &&
      UUID.test(String(item.entry_id || "")) &&
      UUID.test(String(item.student_id || "")) &&
      Number.isInteger(item.lesson_number) &&
      item.lesson_number >= 1 && item.lesson_number <= 74 &&
      item.lesson_status === "presented" &&
      !["cancelled", "cancelled_finalized"].includes(item.attendance_status);
  }

  function validate(item, classDate, attendanceStatus, reason) {
    if (!canCancel(item) || !validDate(String(classDate || "")) ||
        localLessonDate(item.starts_at) !== classDate) {
      throw new Error("Apresentação não disponível. Atualize o roteiro.");
    }
    if (!ATTENDANCE_STATUSES.includes(attendanceStatus)) {
      throw new Error("Escolha PRESENTE ou AUSENTE.");
    }
    if (typeof reason !== "string" ||
        reason.trim().length < 8 || reason.trim().length > 500) {
      throw new Error("Informe uma justificativa de 8 a 500 caracteres.");
    }
    return [item.lesson_kind, item.entry_id, classDate, item.lesson_number].join("|");
  }

  function create(service) {
    if (!service || typeof service.cancelPresentation !== "function") {
      throw new Error("Serviço de cancelamento indisponível.");
    }

    const inFlight = new Map();

    function cancel(item, date, attendanceStatus, reason) {
      const key = validate(item, date, attendanceStatus, reason);
      if (inFlight.has(key)) return inFlight.get(key);

      const request = Promise.resolve()
        .then(function () {
          return service.cancelPresentation(item, date, attendanceStatus, reason.trim());
        })
        .then(function (result) {
          if (!result || result.ok !== true ||
              Number(result.cancelled_lesson_number) !== item.lesson_number ||
              result.attendance_status !== attendanceStatus ||
              !UUID.test(String(result.occurrence_id || ""))) {
            throw new Error("O cancelamento não foi confirmado pelo servidor.");
          }
          return result;
        })
        .finally(function () { inFlight.delete(key); });

      inFlight.set(key, request);
      return request;
    }

    return Object.freeze({ cancel: cancel });
  }

  root.TeacherPresentationCancellation = Object.freeze({
    canCancel: canCancel,
    create: create
  });
})(typeof window !== "undefined" ? window : globalThis);
