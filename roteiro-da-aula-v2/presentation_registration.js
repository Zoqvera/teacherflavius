(function (root) {
  "use strict";

  const VALID_LESSON_KINDS = Object.freeze(["regular", "makeup"]);
  const INVALID_ATTENDANCE = Object.freeze([
    "absent", "cancelled", "cancelled_finalized"
  ]);
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const FIRST_PRESENTATION = 1;
  const LAST_PRESENTATION = 74;

  function canRegister(item) {
    return !!item &&
      VALID_LESSON_KINDS.includes(item.lesson_kind) &&
      UUID.test(String(item.entry_id || "")) &&
      UUID.test(String(item.student_id || "")) &&
      Number.isInteger(item.lesson_number) &&
      item.lesson_number >= FIRST_PRESENTATION &&
      item.lesson_number <= LAST_PRESENTATION &&
      item.lesson_status !== "presented" &&
      !INVALID_ATTENDANCE.includes(item.attendance_status);
  }

  function registrationKey(item, classDate) {
    return [item.lesson_kind, item.entry_id, classDate, item.lesson_number].join("|");
  }

  function validateRegistration(item, classDate) {
    const dateValue = String(classDate || "");
    const parsedDate = DATE.test(dateValue)
      ? new Date(dateValue + "T12:00:00Z") : new Date(NaN);
    if (Number.isNaN(parsedDate.getTime()) ||
        parsedDate.toISOString().slice(0, 10) !== dateValue) {
      throw new Error("Data da aula inválida.");
    }
    if (!canRegister(item)) {
      throw new Error("Apresentação indisponível. Atualize o roteiro antes de registrar.");
    }
    if (!item.starts_at || Number.isNaN(Date.parse(item.starts_at))) {
      throw new Error("Horário da aula inválido.");
    }
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo", year: "numeric",
      month: "2-digit", day: "2-digit"
    }).formatToParts(new Date(item.starts_at));
    const values = {};
    parts.forEach(function (part) {
      if (part.type !== "literal") values[part.type] = part.value;
    });
    const lessonDate = values.year + "-" + values.month + "-" + values.day;
    if (lessonDate !== classDate) {
      throw new Error("A apresentação pertence a outra data.");
    }
    return registrationKey(item, classDate);
  }

  function create(service) {
    if (!service || typeof service.markLessonPresented !== "function") {
      throw new Error("Serviço de apresentações indisponível.");
    }
    const inFlight = new Map();
    const confirmed = new Map();

    function register(item, classDate) {
      const key = validateRegistration(item, classDate);
      if (confirmed.has(key)) return Promise.resolve(confirmed.get(key));
      if (inFlight.has(key)) return inFlight.get(key);

      const work = Promise.resolve()
        .then(function () { return service.markLessonPresented(item, classDate); })
        .then(function (response) {
          if (!response || response.ok !== true ||
              Number(response.lesson_number) !== item.lesson_number ||
              !UUID.test(String(response.occurrence_id || ""))) {
            throw new Error("O registro não foi confirmado pelo servidor.");
          }
          confirmed.set(key, response);
          return response;
        })
        .finally(function () { inFlight.delete(key); });

      inFlight.set(key, work);
      return work;
    }

    return Object.freeze({ register: register });
  }

  root.TeacherPresentationRegistration = Object.freeze({
    canRegister: canRegister,
    create: create
  });
})(typeof window !== "undefined" ? window : globalThis);
