(function () {
  "use strict";

  const MONTH_PATTERN = /^\d{4}-\d{2}-01$/;
  let responsibilities = [];
  let selectedBeneficiary = null;
  let pending = false;

  function escape(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getClient() {
    if (!window.Auth || typeof window.Auth.getClient !== "function") {
      throw new Error("Autenticação administrativa indisponível.");
    }
    return window.Auth.getClient();
  }

  function monthStart(date) {
    const now = date || new Date();
    return now.getFullYear() + "-" +
      String(now.getMonth() + 1).padStart(2, "0") + "-01";
  }

  function nextMonthStart() {
    const now = new Date();
    return monthStart(new Date(now.getFullYear(), now.getMonth() + 1, 1));
  }

  function describeLinks(studentId) {
    const active = responsibilities.filter(function (item) {
      return item.responsibility_state === "active";
    });
    const receiver = active.find(function (item) {
      return item.beneficiary_student_id === studentId;
    });
    if (receiver) {
      return "Mensalidade paga por " + (receiver.payer_name || "outro aluno");
    }

    const coveredStudents = active.filter(function (item) {
      return item.payer_student_id === studentId;
    });
    if (!coveredStudents.length) return "";
    return "Responsável financeiro por: " + coveredStudents.map(function (item) {
      return item.beneficiary_name || "Aluno";
    }).join(", ");
  }

  async function load() {
    const response = await getClient().rpc("get_teacher_financial_responsibilities");
    if (response.error) throw response.error;
    responsibilities = Array.isArray(response.data) ? response.data : [];
    return responsibilities;
  }

  function renderSummary(studentId) {
    const summary = describeLinks(String(studentId || ""));
    return summary ? '<p><b>Responsabilidade financeira:</b> ' + escape(summary) + "</p>" : "";
  }

  function setMessage(message, error) {
    const element = document.getElementById("financialResponsibilityMessage");
    if (!element) return;
    element.textContent = message || "";
    element.className = error ? "error" : "empty";
  }

  function close() {
    const modal = document.getElementById("financialResponsibilityModal");
    if (!modal || pending) return;
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    selectedBeneficiary = null;
  }

  async function open(studentId, studentName) {
    selectedBeneficiary = { id: String(studentId), name: String(studentName || "Aluno") };
    const modal = document.getElementById("financialResponsibilityModal");
    if (!modal) throw new Error("Formulário de responsável financeiro indisponível.");
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");

    document.getElementById("financialResponsibilityStudentName").textContent =
      "Mensalidade do aluno: " + selectedBeneficiary.name;
    document.getElementById("financialResponsibilityStartMonth").value = monthStart();
    document.getElementById("financialResponsibilityEndMonth").value = nextMonthStart();
    document.getElementById("financialResponsibilityStartMonth").min = monthStart();
    document.getElementById("financialResponsibilityEndMonth").min = monthStart();
    setMessage("Carregando os responsáveis financeiros disponíveis...");

    try {
      const [billing, links] = await Promise.all([
        getClient().rpc("get_teacher_billing_students"),
        getClient().rpc("get_teacher_financial_responsibilities")
      ]);
      if (billing.error) throw billing.error;
      if (links.error) throw links.error;
      responsibilities = Array.isArray(links.data) ? links.data : [];

      const active = responsibilities.find(function (item) {
        return item.beneficiary_student_id === selectedBeneficiary.id &&
          item.responsibility_state === "active";
      });
      const activeCovered = new Set(responsibilities.filter(function (item) {
        return item.responsibility_state === "active";
      }).map(function (item) {
        return item.beneficiary_student_id;
      }));
      const payerSelect = document.getElementById("financialResponsibilityPayer");
      const beneficiaryBilling = (billing.data || []).find(function (row) {
        return String(row.student_id) === selectedBeneficiary.id;
      });
      const beneficiaryDueDay = Number(beneficiaryBilling && beneficiaryBilling.due_day);
      const candidates = (billing.data || []).filter(function (row) {
        return row.student_id !== selectedBeneficiary.id &&
          row.billing_active === true &&
          Number(row.monthly_fee) > 0 &&
          Number(row.due_day) === beneficiaryDueDay &&
          !activeCovered.has(row.student_id);
      }).sort(function (a, b) {
        return String(a.name || "").localeCompare(String(b.name || ""), "pt-BR");
      });

      payerSelect.innerHTML = '<option value="">Selecione um aluno pagante</option>' +
        candidates.map(function (item) {
          return '<option value="' + escape(item.student_id) + '">' +
            escape(item.name || item.email || item.student_id) + "</option>";
        }).join("");

      document.getElementById("financialResponsibilityAssignment").hidden = !!active;
      document.getElementById("financialResponsibilityTermination").hidden = !active;
      if (active) {
        document.getElementById("financialResponsibilityCurrentPayer").textContent =
          "Responsável atual: " + (active.payer_name || "Aluno") +
          " (desde " + active.first_reference_month + ").";
        setMessage("Para interromper a cobrança pelo responsável, escolha a primeira competência a voltar para o beneficiário.");
      } else {
        setMessage(candidates.length
          ? "O responsável escolhido deve ter o mesmo dia de vencimento do beneficiário. Ambos mantêm seus planos individuais."
          : "Não há alunos com o mesmo dia de vencimento e cobrança ativa. Ajuste os vencimentos antes de criar o vínculo.", !candidates.length);
      }
    } catch (error) {
      document.getElementById("financialResponsibilityAssignment").hidden = true;
      document.getElementById("financialResponsibilityTermination").hidden = true;
      setMessage("Não foi possível consultar os responsáveis: " + (error.message || "erro desconhecido"), true);
    }
  }

  async function refreshView() {
    await load();
    if (typeof window.renderFilteredStudents === "function") {
      window.renderFilteredStudents();
    }
  }

  async function assign(event) {
    event.preventDefault();
    if (pending || !selectedBeneficiary) return;
    const payerId = document.getElementById("financialResponsibilityPayer").value;
    const startMonth = document.getElementById("financialResponsibilityStartMonth").value;
    if (!payerId || !MONTH_PATTERN.test(startMonth)) {
      setMessage("Escolha o responsável e o primeiro mês de vigência.", true);
      return;
    }

    pending = true;
    const button = document.getElementById("saveFinancialResponsibilityButton");
    button.disabled = true;
    setMessage("Registrando responsabilidade financeira...");
    try {
      const response = await getClient().rpc("set_teacher_financial_responsibility", {
        target_beneficiary_student_id: selectedBeneficiary.id,
        target_payer_student_id: payerId,
        target_first_reference_month: startMonth,
        target_notes: "Mensalidades cobertas por outro aluno"
      });
      if (response.error) throw response.error;
      await refreshView();
      setMessage("Vínculo financeiro registrado. As mensalidades não foram isentadas.");
      pending = false;
      close();
    } catch (error) {
      setMessage("Não foi possível registrar: " + (error.message || "erro desconhecido"), true);
    } finally {
      pending = false;
      button.disabled = false;
    }
  }

  async function terminate(event) {
    event.preventDefault();
    if (pending || !selectedBeneficiary) return;
    const firstUncoveredMonth = document.getElementById("financialResponsibilityEndMonth").value;
    if (!MONTH_PATTERN.test(firstUncoveredMonth)) {
      setMessage("Selecione o primeiro mês sem cobertura.", true);
      return;
    }

    pending = true;
    const button = document.getElementById("endFinancialResponsibilityButton");
    button.disabled = true;
    try {
      const response = await getClient().rpc("end_teacher_financial_responsibility", {
        target_beneficiary_student_id: selectedBeneficiary.id,
        target_first_uncovered_month: firstUncoveredMonth
      });
      if (response.error) throw response.error;
      await refreshView();
      pending = false;
      close();
    } catch (error) {
      setMessage("Não foi possível encerrar o vínculo: " + (error.message || "erro desconhecido"), true);
    } finally {
      pending = false;
      button.disabled = false;
    }
  }

  function install() {
    const modal = document.getElementById("financialResponsibilityModal");
    if (!modal) return;

    document.addEventListener("click", function (event) {
      const button = event.target.closest(".financial-responsibility-button");
      if (!button) return;
      open(button.dataset.studentId, button.dataset.studentName).catch(function (error) {
        setMessage(error.message || "Não foi possível abrir o cadastro.", true);
      });
    });
    modal.addEventListener("click", function (event) {
      if (event.target === modal) close();
    });
    document.getElementById("closeFinancialResponsibilityButton")
      .addEventListener("click", close);
    document.getElementById("cancelFinancialResponsibilityButton")
      .addEventListener("click", close);
    document.getElementById("financialResponsibilityAssignment")
      .addEventListener("submit", assign);
    document.getElementById("financialResponsibilityTermination")
      .addEventListener("submit", terminate);
  }

  window.FinancialResponsibilitiesAdmin = Object.freeze({
    load: load,
    renderSummary: renderSummary
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();