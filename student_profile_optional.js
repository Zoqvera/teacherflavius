(function () {
  "use strict";

  if (!window.Auth || !Auth.getClient || !Auth.getUser) return;

  const days = ["seg", "ter", "qua", "qui", "sex"];
  const hours = ["09", "10", "12", "13", "15", "17", "18", "20", "21"];

  function onlyDigits(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function normalizePixKey(value) {
    return String(value || "").trim();
  }

  function normalizeAvailability(value) {
    const normalized = {};
    days.forEach(function (day) {
      const selected = Array.isArray(value && value[day]) ? value[day] : [];
      normalized[day] = selected.filter(function (hour) { return hours.includes(hour); });
    });
    return normalized;
  }

  function availabilityColumns(availability) {
    const columns = {};
    days.forEach(function (day) {
      hours.forEach(function (hour) {
        columns["availability_" + day + "_" + hour] = Array.isArray(availability[day]) && availability[day].includes(hour);
      });
    });
    return columns;
  }

  async function saveProfile(data, mode) {
    const client = Auth.getClient();
    const user = await Auth.getUser();
    if (!client || !user) throw new Error("Sua sessão expirou. Entre novamente.");

    const current = mode === "complete"
      ? await Auth.ensureProfileForUser(user)
      : (await Auth.getProfile()) || await Auth.ensureProfileForUser(user);

    const cleanCpf = onlyDigits(data && data.cpf);
    const cleanWhatsapp = onlyDigits(data && data.whatsapp);
    const pixKey = data && Object.prototype.hasOwnProperty.call(data, "pix_key")
      ? normalizePixKey(data.pix_key)
      : normalizePixKey(current && current.pix_key);
    const availability = data && Object.prototype.hasOwnProperty.call(data, "availability")
      ? normalizeAvailability(data.availability)
      : normalizeAvailability(current && current.availability);

    const name = String(data && data.name || "").trim();
    if (!name || !cleanCpf || !cleanWhatsapp) {
      throw new Error("Preencha nome, CPF e WhatsApp.");
    }
    if (cleanCpf.length !== 11) throw new Error("CPF inválido. Informe 11 dígitos.");
    if (cleanWhatsapp.length < 10) throw new Error("WhatsApp inválido.");

    const payload = Object.assign({
      id: user.id,
      name: name,
      email: user.email || current && current.email || "",
      cpf: cleanCpf,
      whatsapp: cleanWhatsapp,
      pix_key: pixKey,
      availability: availability,
      enrollment_code: current && current.enrollment_code || "",
      enrolled: current && current.enrolled === true,
      profile_completed: true
    }, availabilityColumns(availability));

    const saved = await client.from("profiles").upsert(payload).select().single();
    if (saved.error) throw saved.error;

    const metadataResponse = await client.auth.updateUser({
      data: {
        name: name,
        cpf: cleanCpf,
        whatsapp: cleanWhatsapp,
        pix_key: pixKey,
        availability: availability,
        enrollment_code: payload.enrollment_code,
        enrolled: payload.enrolled,
        profile_completed: true
      }
    });
    if (metadataResponse.error) throw metadataResponse.error;

    return saved.data;
  }

  Auth.completeProfile = function (data) {
    return saveProfile(data || {}, "complete");
  };

  Auth.updateProfile = function (data) {
    return saveProfile(data || {}, "update");
  };
})();
