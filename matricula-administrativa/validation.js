(function (root) {
  "use strict";

  const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

  function isValidDate(value) {
    if (!DATE_FORMAT.test(String(value || ""))) return false;
    const date = new Date(value + "T12:00:00Z");
    return !Number.isNaN(date.getTime())
      && date.toISOString().slice(0, 10) === value;
  }

  function weekdayOf(dateValue) {
    if (!isValidDate(dateValue)) return null;
    return new Date(dateValue + "T12:00:00Z").getUTCDay() || 7;
  }

  function validateEnrollment(input, classInfo, today) {
    const name = String(input.name || "").trim();
    if (name.length < 3 || name.length > 160) {
      throw new Error("Informe o nome completo do aluno.");
    }
    if (!classInfo || !["individual", "quintet"].includes(classInfo.class_type)) {
      throw new Error("Selecione uma turma regular e ativa.");
    }
    if (!isValidDate(input.first_lesson_date)) {
      throw new Error("Informe a data da primeira aula.");
    }
    if (weekdayOf(input.first_lesson_date) !== Number(classInfo.class_weekday)) {
      throw new Error("A primeira aula deve cair no dia da semana da turma selecionada.");
    }
    if (classInfo.first_lesson_date
      && input.first_lesson_date < classInfo.first_lesson_date) {
      throw new Error("A data antecede o início da turma.");
    }
    if (!isValidDate(input.first_due_date) || input.first_due_date < today) {
      throw new Error("O primeiro vencimento deve ser hoje ou uma data futura.");
    }
    const fee = Number(input.monthly_fee);
    if (!Number.isFinite(fee) || fee <= 0 || fee > 100000) {
      throw new Error("Informe um valor mensal maior que zero.");
    }
    const lessons = Number(input.classes_per_month);
    const day = Number(input.due_day);
    if (!Number.isInteger(lessons) || lessons < 1 || lessons > 31) {
      throw new Error("Informe a quantidade mensal de aulas (1 a 31).");
    }
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      throw new Error("Informe o dia recorrente de vencimento (1 a 31).");
    }
    return {
      name,
      contact_email: String(input.contact_email || "").trim(),
      whatsapp: String(input.whatsapp || "").replace(/\D/g, ""),
      class_number: Number(classInfo.class_number),
      first_lesson_date: input.first_lesson_date,
      monthly_fee: Math.round(fee * 100) / 100,
      classes_per_month: lessons,
      due_day: day,
      first_due_date: input.first_due_date,
    };
  }

  const api = { isValidDate, weekdayOf, validateEnrollment };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.AdminEnrollmentValidation = api;
})(typeof globalThis === "undefined" ? this : globalThis);
