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

    return Object.freeze({
      signUp: signUp
    });
  }

  window.StudentEnrollmentService = Object.freeze({
    create: create,
    generateEnrollmentCode: generateEnrollmentCode
  });
})();
