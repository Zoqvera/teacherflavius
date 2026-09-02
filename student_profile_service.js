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

  function buildFallbackProfile(user) {
    const metadata = user.user_metadata || {};

    return {
      id: user.id,
      name: metadata.full_name || metadata.name || "",
      email: user.email,
      cpf: metadata.cpf || "",
      whatsapp: metadata.whatsapp || "",
      pix_key: metadata.pix_key || "",
      availability: metadata.availability || {},
      enrollment_code: metadata.enrollment_code || "",
      enrolled: metadata.enrolled || false,
      profile_completed: metadata.profile_completed || false
    };
  }

  function assertDependencies(dependencies) {
    const requiredFunctions = [
      "getClient",
      "requireClient",
      "getUser",
      "getRedirectUrl",
      "generateEnrollmentCode"
    ];

    requiredFunctions.forEach(function (name) {
      if (typeof dependencies[name] !== "function") {
        throw new Error("Dependência inválida do serviço de perfil: " + name + ".");
      }
    });
  }

  function create(dependencies) {
    const deps = dependencies || {};
    assertDependencies(deps);

    async function updateAuthMetadata(client, input, enrollmentCode, enrolled) {
      const response = await client.auth.updateUser({
        data: buildUserMetadata(input, enrollmentCode, enrolled)
      });
      if (response.error) throw response.error;
    }

    async function ensureProfileForUser(user) {
      const client = deps.getClient();
      if (!client || !user) return null;

      const existing = await client.from("profiles").select("*").eq("id", user.id).maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data) return existing.data;

      const metadata = user.user_metadata || {};
      const payload = {
        id: user.id,
        name: metadata.full_name || metadata.name || metadata.user_name || "",
        email: user.email || "",
        enrolled: false,
        profile_completed: false
      };
      const created = await client.from("profiles").insert(payload).select().single();
      if (created.error) throw created.error;
      return created.data;
    }

    async function enrollStudent(data) {
      const client = deps.requireClient();
      const input = normalizeStudentInput(data);
      validateStudentInput(input, "Preencha todos os campos da matrícula.", {
        requireEnrollmentCredentials: true
      });

      const enrollmentCode = deps.generateEnrollmentCode();
      const enrollmentMetadata = buildUserMetadata(input, enrollmentCode, true);
      const response = await client.auth.signUp({
        email: input.email,
        password: input.password,
        options: {
          data: enrollmentMetadata,
          emailRedirectTo: deps.getRedirectUrl()
        }
      });
      if (response.error) throw response.error;

      if (response.data && response.data.user) {
        const profilePayload = buildProfilePayload({
          userId: response.data.user.id,
          email: input.email,
          input: input,
          enrollmentCode: enrollmentCode,
          enrolled: true
        });
        const profileResponse = await client.from("profiles").upsert(profilePayload).select().single();
        if (profileResponse.error) {
          console.warn("Não foi possível atualizar profiles com os dados de matrícula:", profileResponse.error.message);
        }
      }

      return {
        user: response.data ? response.data.user : null,
        enrollment_code: enrollmentCode
      };
    }

    async function getProfile() {
      const client = deps.getClient();
      const user = await deps.getUser();
      if (!client || !user) return null;

      const response = await client.from("profiles").select("*").eq("id", user.id).maybeSingle();
      const fallbackProfile = buildFallbackProfile(user);
      if (response.error || !response.data) return fallbackProfile;
      return Object.assign({}, fallbackProfile, response.data);
    }

    async function updateProfile(data) {
      const client = deps.getClient();
      const user = await deps.getUser();
      if (!client || !user) throw new Error("Usuário não autenticado.");

      const input = normalizeStudentInput(data);
      validateStudentInput(input, "Preencha nome, CPF, WhatsApp e chave PIX.");

      const currentProfile = await getProfile();
      const enrollmentCode = currentProfile && currentProfile.enrollment_code || "";
      const enrolled = currentProfile && currentProfile.enrolled === true;
      const profilePayload = buildProfilePayload({
        userId: user.id,
        email: user.email,
        input: input,
        enrollmentCode: enrollmentCode,
        enrolled: enrolled
      });

      const profileResponse = await client.from("profiles").upsert(profilePayload).select().single();
      if (profileResponse.error) throw profileResponse.error;
      await updateAuthMetadata(client, input, enrollmentCode, enrolled);
      return profileResponse.data;
    }

    async function completeProfile(data) {
      const client = deps.getClient();
      const user = await deps.getUser();
      if (!client || !user) throw new Error("Sua sessão expirou. Entre novamente.");

      const input = normalizeStudentInput(data);
      validateStudentInput(input, "Preencha todos os campos obrigatórios.");

      const current = await ensureProfileForUser(user);
      const enrollmentCode = current.enrollment_code || "";
      const enrolled = current.enrolled === true;
      const payload = buildProfilePayload({
        userId: user.id,
        email: user.email || current.email || "",
        input: input,
        enrollmentCode: enrollmentCode,
        enrolled: enrolled
      });

      const saved = await client.from("profiles").upsert(payload).select().single();
      if (saved.error) throw saved.error;
      await updateAuthMetadata(client, input, enrollmentCode, enrolled);
      return saved.data;
    }

    return Object.freeze({
      ensureProfileForUser: ensureProfileForUser,
      enrollStudent: enrollStudent,
      getProfile: getProfile,
      updateProfile: updateProfile,
      completeProfile: completeProfile
    });
  }

  window.StudentProfileService = Object.freeze({
    create: create
  });
})();