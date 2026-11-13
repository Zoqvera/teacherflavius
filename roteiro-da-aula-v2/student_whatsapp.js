(function (root) {
  "use strict";

  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const BRAZIL_LOCAL_PHONE = /^[1-9][0-9]{1}[0-9]{8,9}$/;
  const BRAZIL_INTERNATIONAL_PHONE = /^55[1-9][0-9]{1}[0-9]{8,9}$/;

  function normalizePhone(value) {
    const raw = String(value || "").trim();
    const digits = raw.replace(/\D/g, "");

    if (BRAZIL_INTERNATIONAL_PHONE.test(digits)) return digits;
    if (BRAZIL_LOCAL_PHONE.test(digits)) return "55" + digits;
    if (raw.startsWith("+") && !digits.startsWith("55") &&
        digits.length >= 8 && digits.length <= 15) {
      return digits;
    }
    return "";
  }

  function studentIds(items) {
    const uniqueIds = new Set();
    (Array.isArray(items) ? items : []).forEach(function (item) {
      const id = String(item && item.student_id || "").toLowerCase();
      if (UUID_PATTERN.test(id)) uniqueIds.add(id);
    });
    return Array.from(uniqueIds);
  }

  async function load(client, items) {
    const ids = studentIds(items);
    if (!ids.length) return new Map();

    const response = await client.from("profiles")
      .select("id,whatsapp")
      .in("id", ids);
    if (response.error) throw response.error;

    const requestedIds = new Set(ids);
    const contacts = new Map();
    (Array.isArray(response.data) ? response.data : []).forEach(function (row) {
      const id = String(row && row.id || "").toLowerCase();
      if (!requestedIds.has(id)) return;

      const number = normalizePhone(row.whatsapp);
      if (number) contacts.set(id, number);
    });
    return contacts;
  }

  function createButton(studentName, phone, contactsAvailable) {
    const control = document.createElement("button");
    control.type = "button";
    control.className = "academic-button workspace-whatsapp-action";
    control.textContent = "CHAMAR NO WHATSAPP";
    control.setAttribute("aria-label",
      "Chamar " + String(studentName || "aluno") + " no WhatsApp");

    const number = normalizePhone(phone);
    if (!number) {
      control.disabled = true;
      control.title = contactsAvailable === false
        ? "Não foi possível carregar o contato. Atualize o roteiro."
        : "WhatsApp não cadastrado ou inválido para este aluno.";
      return control;
    }

    control.addEventListener("click", function () {
      root.open("https://wa.me/" + number, "_blank", "noopener,noreferrer");
    });
    return control;
  }

  root.TeacherStudentWhatsapp = Object.freeze({
    normalizePhone: normalizePhone,
    load: load,
    createButton: createButton
  });
})(typeof window !== "undefined" ? window : globalThis);
