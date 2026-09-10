(function () {
  "use strict";

  const AVAILABILITY_DAYS = Object.freeze(["seg", "ter", "qua", "qui", "sex"]);
  const AVAILABILITY_HOURS = Object.freeze(["09", "10", "12", "13", "15", "17", "18", "20", "21"]);

  function normalizeDigits(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function normalizeAvailability(availability) {
    const normalized = {};

    AVAILABILITY_DAYS.forEach(function (day) {
      const selected = Array.isArray(availability && availability[day]) ? availability[day] : [];
      normalized[day] = selected.filter(function (hour) {
        return AVAILABILITY_HOURS.includes(hour);
      });
    });

    return normalized;
  }

  function normalizeStudentInput(data) {
    const source = data || {};

    return {
      name: source.name || "",
      email: source.email || "",
      password: source.password || "",
      cpf: normalizeDigits(source.cpf),
      whatsapp: normalizeDigits(source.whatsapp),
      pixKey: String(source.pix_key || "").trim(),
      availability: normalizeAvailability(source.availability)
    };
  }

  function countAvailabilitySlots(availability) {
    return Object.keys(availability || {}).reduce(function (total, day) {
      return total + (Array.isArray(availability[day]) ? availability[day].length : 0);
    }, 0);
  }

  function validateStudentInput(input, requiredFieldsMessage, options) {
    const settings = options || {};
    const hasRequiredIdentity = input.name && input.cpf && input.whatsapp && input.pixKey;
    const hasEnrollmentCredentials = !settings.requireEnrollmentCredentials || (input.email && input.password);

    if (!hasRequiredIdentity || !hasEnrollmentCredentials) throw new Error(requiredFieldsMessage);
    if (input.cpf.length !== 11) throw new Error("CPF inválido. Informe 11 dígitos.");
    if (input.whatsapp.length < 10) throw new Error("WhatsApp inválido.");
    if (countAvailabilitySlots(input.availability) === 0) {
      throw new Error("Selecione pelo menos um horário disponível para aulas durante a semana.");
    }
  }

  function availabilityToProfileColumns(availability) {
    const columns = {};

    AVAILABILITY_DAYS.forEach(function (day) {
      AVAILABILITY_HOURS.forEach(function (hour) {
        columns["availability_" + day + "_" + hour] = Array.isArray(availability[day]) && availability[day].includes(hour);
      });
    });

    return columns;
  }

  function buildProfilePayload(options) {
    const input = options.input;

    return Object.assign({
      id: options.userId,
      name: input.name,
      email: options.email || "",
      cpf: input.cpf,
      whatsapp: input.whatsapp,
      pix_key: input.pixKey,
      availability: input.availability,
      enrollment_code: options.enrollmentCode || "",
      enrolled: options.enrolled === true,
      profile_completed: true
    }, availabilityToProfileColumns(input.availability));
  }

  function buildUserMetadata(input, enrollmentCode, enrolled) {
    return {
      name: input.name,
      cpf: input.cpf,
      whatsapp: input.whatsapp,
      pix_key: input.pixKey,
      availability: input.availability,
      enrollment_code: enrollmentCode || "",
      enrolled: enrolled === true,
      profile_completed: true
    };
  }

  window.StudentDataUtils = Object.freeze({
    normalizeStudentInput: normalizeStudentInput,
    validateStudentInput: validateStudentInput,
    buildProfilePayload: buildProfilePayload,
    buildUserMetadata: buildUserMetadata
  });
})();
