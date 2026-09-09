(function () {
  "use strict";

  const TOTP_FACTOR_TYPE = "totp";
  const DEFAULT_FRIENDLY_NAME = "Teacher Flavius - Professor";
  const TOTP_CODE_PATTERN = /^\d{6}$/;
  const AAL2_LEVEL = "aal2";
  const PROMOTION_MAX_ATTEMPTS = 6;
  const PROMOTION_RETRY_DELAY_MS = 80;

  function assertDependencies(dependencies) {
    if (!dependencies || typeof dependencies.getClient !== "function") {
      throw new Error("Dependência inválida do serviço MFA: getClient.");
    }
  }

  function requireMfaClient(getClient) {
    const client = getClient();
    if (!client || !client.auth || !client.auth.mfa) {
      throw new Error("O serviço de autenticação em duas etapas não está disponível.");
    }
    return client;
  }

  function normalizeFactorType(factor) {
    return String(
      (factor && (factor.factor_type || factor.factorType || factor.type)) || ""
    ).toLowerCase();
  }

  function isVerifiedFactor(factor) {
    return String((factor && factor.status) || "").toLowerCase() === "verified";
  }

  function getAllFactors(data) {
    if (data && Array.isArray(data.all)) return data.all;

    const totp = data && Array.isArray(data.totp) ? data.totp : [];
    const phone = data && Array.isArray(data.phone) ? data.phone : [];
    return totp.concat(phone);
  }

  function findVerifiedTotpFactor(data) {
    if (data && Array.isArray(data.totp) && data.totp.length) {
      return data.totp.find(isVerifiedFactor) || data.totp[0] || null;
    }

    return getAllFactors(data).find(function (factor) {
      return normalizeFactorType(factor) === TOTP_FACTOR_TYPE && isVerifiedFactor(factor);
    }) || null;
  }

  function findUnverifiedTotpFactors(data) {
    return getAllFactors(data).filter(function (factor) {
      return normalizeFactorType(factor) === TOTP_FACTOR_TYPE && !isVerifiedFactor(factor);
    });
  }

  function normalizeTotpCode(code) {
    const normalizedCode = String(code || "").replace(/\s+/g, "");
    if (!TOTP_CODE_PATTERN.test(normalizedCode)) {
      throw new Error("Digite o código de 6 dígitos do aplicativo autenticador.");
    }
    return normalizedCode;
  }

  function sleep(milliseconds) {
    return new Promise(function (resolve) {
      setTimeout(resolve, milliseconds);
    });
  }

  function create(dependencies) {
    const deps = dependencies || {};
    assertDependencies(deps);

    async function getAssuranceLevel() {
      const client = requireMfaClient(deps.getClient);
      const response = await client.auth.mfa.getAuthenticatorAssuranceLevel();
      if (response.error) throw response.error;
      return response.data || {};
    }

    async function listFactors() {
      const client = requireMfaClient(deps.getClient);
      const response = await client.auth.mfa.listFactors();
      if (response.error) throw response.error;
      return response.data || {};
    }

    async function getState() {
      const assurance = await getAssuranceLevel();
      if (assurance.currentLevel === AAL2_LEVEL) {
        return Object.freeze({ status: "verified", factor: null, assurance: assurance });
      }

      const factors = await listFactors();
      const verifiedFactor = findVerifiedTotpFactor(factors);
      if (verifiedFactor) {
        return Object.freeze({ status: "challenge", factor: verifiedFactor, assurance: assurance });
      }

      if (assurance.nextLevel === AAL2_LEVEL) {
        throw new Error("Existe um segundo fator cadastrado, mas ele não pôde ser carregado.");
      }

      return Object.freeze({ status: "enroll", factor: null, assurance: assurance });
    }

    async function removeStaleUnverifiedFactors() {
      const client = requireMfaClient(deps.getClient);
      const factors = await listFactors();
      const staleFactors = findUnverifiedTotpFactors(factors);

      for (const factor of staleFactors) {
        if (!factor || !factor.id) continue;
        const response = await client.auth.mfa.unenroll({ factorId: factor.id });
        if (response.error) throw response.error;
      }
    }

    async function enrollTotp() {
      const client = requireMfaClient(deps.getClient);
      await removeStaleUnverifiedFactors();

      const response = await client.auth.mfa.enroll({
        factorType: TOTP_FACTOR_TYPE,
        friendlyName: deps.friendlyName || DEFAULT_FRIENDLY_NAME
      });
      if (response.error) throw response.error;

      const data = response.data || {};
      if (!data.id || !data.totp || !data.totp.qr_code || !data.totp.secret) {
        throw new Error("O Supabase não retornou os dados necessários para configurar o autenticador.");
      }
      return data;
    }

    async function waitForAal2() {
      for (let attempt = 0; attempt < PROMOTION_MAX_ATTEMPTS; attempt += 1) {
        const assurance = await getAssuranceLevel();
        if (assurance.currentLevel === AAL2_LEVEL) return assurance;
        if (attempt < PROMOTION_MAX_ATTEMPTS - 1) {
          await sleep(PROMOTION_RETRY_DELAY_MS);
        }
      }
      throw new Error("A sessão não foi promovida para autenticação em duas etapas.");
    }

    async function verifyFactor(factorId, code) {
      if (!factorId) throw new Error("Fator de autenticação inválido.");

      const client = requireMfaClient(deps.getClient);
      const normalizedCode = normalizeTotpCode(code);
      const challenge = await client.auth.mfa.challenge({ factorId: factorId });
      if (challenge.error) throw challenge.error;
      if (!challenge.data || !challenge.data.id) {
        throw new Error("Não foi possível iniciar a verificação em duas etapas.");
      }

      const verification = await client.auth.mfa.verify({
        factorId: factorId,
        challengeId: challenge.data.id,
        code: normalizedCode
      });
      if (verification.error) throw verification.error;

      await waitForAal2();
      return verification.data;
    }

    return Object.freeze({
      getAssuranceLevel: getAssuranceLevel,
      listFactors: listFactors,
      getState: getState,
      enrollTotp: enrollTotp,
      verifyFactor: verifyFactor
    });
  }

  window.ProfessorMfaService = Object.freeze({
    create: create
  });
})();
