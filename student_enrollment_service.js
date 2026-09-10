(function () {
  "use strict";

  const ENROLLMENT_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const ENROLLMENT_CODE_LENGTH = 5;

  function assertDependencies(dependencies) {
    const requiredFunctions = ["requireClient", "getRedirectUrl"];

    requiredFunctions.forEach(function (name) {
      if (typeof dependencies[name] !== "function") {
        throw new Error("Dependência inválida do serviço de matrícula: " + name + ".");
      }
    });
  }

  function getStudentDataUtils() {
    if (!window.StudentDataUtils) {
      throw new Error("Os utilitários de dados do aluno não foram inicializados.");
    }
    return window.StudentDataUtils;
  }

  function generateEnrollmentCode() {
    let code = "";

    for (let index = 0; index < ENROLLMENT_CODE_LENGTH; index += 1) {
      const randomIndex = Math.floor(Math.random() * ENROLLMENT_CODE_ALPHABET.length);
      code += ENROLLMENT_CODE_ALPHABET[randomIndex];
    }

    return code;
  }

  function create(dependencies) {
    const deps = dependencies || {};
    const studentData = getStudentDataUtils();
    assertDependencies(deps);

    async function signUp(name, email, password) {
      const client = deps.requireClient();
      const response = await client.auth.signUp({
        email: email,
        password: password,
        options: {
          data: { name: name },
          emailRedirectTo: deps.getRedirectUrl()
        }
      });
      if (response.error) throw response.error;

      if (response.data && response.data.user) {
        await client.from("profiles").upsert({
          id: response.data.user.id,
          name: name,
          email: email,
          profile_completed: true
        });
      }

      return response.data;
    }

    async function enrollStudent(data) {
      const client = deps.requireClient();
      const input = studentData.normalizeStudentInput(data);
      studentData.validateStudentInput(input, "Preencha todos os campos da matrícula.", {
        requireEnrollmentCredentials: true
      });

      const enrollmentCode = generateEnrollmentCode();
      const enrollmentMetadata = studentData.buildUserMetadata(input, enrollmentCode, true);
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
        const profilePayload = studentData.buildProfilePayload({
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

    return Object.freeze({
      signUp: signUp,
      enrollStudent: enrollStudent
    });
  }

  window.StudentEnrollmentService = Object.freeze({
    create: create,
    generateEnrollmentCode: generateEnrollmentCode
  });
})();
