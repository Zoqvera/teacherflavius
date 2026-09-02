(function () {
  "use strict";

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
    const requiredFunctions = ["getClient", "getUser"];

    requiredFunctions.forEach(function (name) {
      if (typeof dependencies[name] !== "function") {
        throw new Error("Dependência inválida do serviço de perfil: " + name + ".");
      }
    });
  }

  function getStudentDataUtils() {
    if (!window.StudentDataUtils) {
      throw new Error("Os utilitários de dados do aluno não foram inicializados.");
    }
    return window.StudentDataUtils;
  }

  function create(dependencies) {
    const deps = dependencies || {};
    const studentData = getStudentDataUtils();
    assertDependencies(deps);

    async function updateAuthMetadata(client, input, enrollmentCode, enrolled) {
      const response = await client.auth.updateUser({
        data: studentData.buildUserMetadata(input, enrollmentCode, enrolled)
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

      const input = studentData.normalizeStudentInput(data);
      studentData.validateStudentInput(input, "Preencha nome, CPF, WhatsApp e chave PIX.");

      const currentProfile = await getProfile();
      const enrollmentCode = currentProfile && currentProfile.enrollment_code || "";
      const enrolled = currentProfile && currentProfile.enrolled === true;
      const profilePayload = studentData.buildProfilePayload({
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

      const input = studentData.normalizeStudentInput(data);
      studentData.validateStudentInput(input, "Preencha todos os campos obrigatórios.");

      const current = await ensureProfileForUser(user);
      const enrollmentCode = current.enrollment_code || "";
      const enrolled = current.enrolled === true;
      const payload = studentData.buildProfilePayload({
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
      getProfile: getProfile,
      updateProfile: updateProfile,
      completeProfile: completeProfile
    });
  }

  window.StudentProfileService = Object.freeze({
    create: create
  });
})();
