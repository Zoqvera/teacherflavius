(function () {
  "use strict";

  const PAYMENT_PATH = "/pagamento/?matricula80=1";
  const OFFER_MONTHLY_FEE = 80;
  const OFFER_CLASSES_PER_MONTH = 4;
  const MIN_BIRTH_YEAR = 1900;

  const elements = {
    status: document.getElementById("pageStatus"),
    google: document.getElementById("googleStep"),
    details: document.getElementById("detailsStep"),
    existing: document.getElementById("existingEnrollmentStep"),
    resume: document.getElementById("resumePaymentStep"),
    form: document.getElementById("enrollmentForm"),
    submit: document.getElementById("submitEnrollment"),
    name: document.getElementById("fullName"),
    cpf: document.getElementById("cpf"),
    birthDate: document.getElementById("birthDate"),
    whatsapp: document.getElementById("whatsapp"),
    email: document.getElementById("signedInEmail")
  };

  function setStatus(message, kind) {
    elements.status.textContent = message || "";
    elements.status.dataset.kind = kind || "";
  }

  function showStep(step) {
    [elements.google, elements.details, elements.existing, elements.resume].forEach(function (section) {
      section.hidden = section !== step;
    });
  }

  function onlyDigits(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function formatCpf(value) {
    return onlyDigits(value).slice(0, 11)
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  }

  function isValidCpf(cpf) {
    if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;

    function checkDigit(length) {
      let sum = 0;
      for (let index = 0; index < length; index += 1) {
        sum += Number(cpf[index]) * (length + 1 - index);
      }
      const remainder = (sum * 10) % 11;
      return remainder === 10 ? 0 : remainder;
    }

    return checkDigit(9) === Number(cpf[9]) && checkDigit(10) === Number(cpf[10]);
  }

  function normalizeWhatsapp(value) {
    let digits = onlyDigits(value);
    if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
      digits = digits.slice(2);
    }
    if (!/^\d{10,11}$/.test(digits) || digits.startsWith("00")) {
      throw new Error("Informe um WhatsApp válido com DDD.");
    }
    return digits;
  }

  function formatWhatsapp(value) {
    const digits = onlyDigits(value).slice(0, 11);
    if (digits.length < 3) return digits;
    const ddd = "(" + digits.slice(0, 2) + ") ";
    if (digits.length <= 6) return ddd + digits.slice(2);
    const phoneLength = digits.length === 11 ? 5 : 4;
    return ddd + digits.slice(2, phoneLength + 2) + "-" + digits.slice(phoneLength + 2);
  }

  function brazilToday() {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(function (part) {
      return [part.type, part.value];
    }));
    return values.year + "-" + values.month + "-" + values.day;
  }

  function validateDateOfBirth(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!match || Number(match[1]) < MIN_BIRTH_YEAR || value > brazilToday()) {
      throw new Error("Informe uma data de nascimento válida.");
    }

    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (date.getUTCFullYear() !== Number(match[1]) ||
        date.getUTCMonth() !== Number(match[2]) - 1 ||
        date.getUTCDate() !== Number(match[3])) {
      throw new Error("Informe uma data de nascimento válida.");
    }
    return value;
  }

  function validateForm() {
    const name = elements.name.value.trim().replace(/\s+/g, " ");
    if (name.length < 3 || !/^\S+\s+\S+/.test(name)) {
      throw new Error("Informe seu nome completo.");
    }

    const cpf = onlyDigits(elements.cpf.value);
    if (!isValidCpf(cpf)) throw new Error("Informe um CPF válido.");

    return {
      name: name,
      cpf: cpf,
      dateOfBirth: validateDateOfBirth(elements.birthDate.value),
      whatsapp: normalizeWhatsapp(elements.whatsapp.value)
    };
  }

  async function waitForAuthentication() {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (window.Auth && window.Auth.isConfigured && window.Auth.isConfigured()) return window.Auth;
      await new Promise(function (resolve) { window.setTimeout(resolve, 150); });
    }
    throw new Error("Não foi possível carregar a autenticação. Atualize a página.");
  }

  async function authorizePromotion() {
    const response = await window.Auth.getClient().rpc("authorize_my_matricula80");
    if (response.error) throw response.error;

    const offer = response.data || {};
    if (offer.ok !== true ||
        offer.class_mode !== "group" ||
        Number(offer.monthly_fee) !== OFFER_MONTHLY_FEE ||
        Number(offer.classes_per_month) !== OFFER_CLASSES_PER_MONTH ||
        offer.origin !== "anúncio80") {
      throw new Error(offer.error || "Não foi possível validar a oferta de matrícula.");
    }
  }

  async function canResumeFirstPayment(profile) {
    if (profile.archived === true) return false;
    const client = window.Auth.getClient();
    const origin = await client.rpc("get_my_student_acquisition");
    if (origin.error || !origin.data || origin.data.source !== "anúncio80") return false;

    const pending = await client.rpc("get_my_pending_tuitions");
    if (pending.error || !Array.isArray(pending.data)) return false;
    return pending.data.some(function (tuition) {
      return Number(tuition.amount_due) === OFFER_MONTHLY_FEE &&
        tuition.due_date === profile.tuition_first_due_date;
    });
  }

  function populateForm(profile, user) {
    elements.name.value = profile.name || user.user_metadata && (
      user.user_metadata.full_name || user.user_metadata.name
    ) || "";
    elements.cpf.value = formatCpf(profile.cpf || "");
    elements.birthDate.value = profile.date_of_birth || "";
    elements.whatsapp.value = formatWhatsapp(profile.whatsapp || "");
    elements.birthDate.max = brazilToday();
    elements.email.textContent = user.email || profile.email || "";
  }

  async function initialize() {
    await waitForAuthentication();
    const session = await window.Auth.getSession();
    if (!session || !session.user) {
      showStep(elements.google);
      setStatus("");
      return;
    }

    const profile = await window.Auth.ensureProfileForUser(session.user);
    if (!profile) throw new Error("Não foi possível localizar seu cadastro.");

    if (profile.enrolled === true || profile.profile_completed === true || profile.archived === true) {
      showStep(await canResumeFirstPayment(profile) ? elements.resume : elements.existing);
      setStatus("");
      return;
    }

    await authorizePromotion();
    populateForm(profile, session.user);
    showStep(elements.details);
    setStatus("");
  }

  async function completeEnrollment(values) {
    const client = window.Auth.getClient();
    const user = await window.Auth.getUser();
    if (!user) throw new Error("Sua sessão expirou. Entre novamente com Google.");

    await authorizePromotion();

    const birthday = await client.from("profiles")
      .update({ date_of_birth: values.dateOfBirth })
      .eq("id", user.id)
      .select("date_of_birth")
      .single();
    if (birthday.error) throw birthday.error;

    const category = await client.rpc("set_my_enrollment_class_mode", { target_mode: "group" });
    if (category.error) throw category.error;
    if (!category.data || category.data.class_type !== "QUINTETO") {
      throw new Error("Não foi possível registrar a modalidade do curso.");
    }

    const billing = await client.rpc("set_my_enrollment_billing_terms");
    if (billing.error) throw billing.error;
    if (!billing.data || Number(billing.data.monthly_fee) !== OFFER_MONTHLY_FEE ||
        Number(billing.data.classes_per_month) !== OFFER_CLASSES_PER_MONTH) {
      throw new Error("Não foi possível registrar a mensalidade promocional.");
    }

    const completed = await window.Auth.completeProfile({
      name: values.name,
      cpf: values.cpf,
      whatsapp: values.whatsapp
    });
    if (!completed || completed.enrolled !== true) {
      throw new Error("O cadastro ainda não foi ativado. Verifique seus dados e tente novamente.");
    }
  }

  elements.cpf.addEventListener("input", function () {
    elements.cpf.value = formatCpf(elements.cpf.value);
  });

  elements.whatsapp.addEventListener("input", function () {
    elements.whatsapp.value = formatWhatsapp(elements.whatsapp.value);
  });

  elements.form.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (elements.submit.disabled) return;

    elements.submit.disabled = true;
    setStatus("Registrando sua matrícula com segurança...");
    try {
      const values = validateForm();
      await completeEnrollment(values);
      setStatus("Cadastro concluído. Abrindo o pagamento Pix...", "success");
      window.location.replace(PAYMENT_PATH);
    } catch (error) {
      setStatus(error.message || "Não foi possível concluir a matrícula.", "error");
      elements.submit.disabled = false;
    }
  });

  initialize().catch(function (error) {
    setStatus(error.message || "Não foi possível carregar a matrícula.", "error");
    showStep(elements.google);
  });
})();
