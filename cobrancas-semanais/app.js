(function () {
  "use strict";
  const pageStatus = document.getElementById("pageStatus");
  const content = document.getElementById("content");
  const invoiceList = document.getElementById("invoices");
  const paymentForm = document.getElementById("paymentForm");
  const paymentStatus = document.getElementById("paymentStatus");
  const statusFilter = document.getElementById("statusFilter");
  let invoices = [];

  function showStatus(message, isError) {
    pageStatus.textContent = message;
    pageStatus.className = isError ? "error" : "";
  }
  function money(amount) {
    return Number(amount || 0).toLocaleString("pt-BR", {
      style: "currency", currency: "BRL",
    });
  }
  function dateLabel(value) {
    if (!value) return "Sem data";
    const [year, month, day] = String(value).slice(0,10).split("-");
    return day + "/" + month + "/" + year;
  }
  function localToday() {
    const fields = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
    const map = Object.fromEntries(fields.map(field => [field.type,field.value]));
    return [map.year,map.month,map.day].join("-");
  }

  function renderSummary() {
    const expected = invoices.reduce((sum,row) => sum + Number(row.amount_due), 0);
    const received = invoices.reduce((sum,row) => sum + Number(row.amount_paid || 0), 0);
    const unpaid = invoices.filter(row => !row.payment_date)
      .reduce((sum,row) => sum + Number(row.amount_due), 0);
    document.getElementById("totalAmount").textContent = money(expected);
    document.getElementById("paidAmount").textContent = money(received);
    document.getElementById("openAmount").textContent = money(unpaid);
  }

  function renderInvoice(invoice) {
    const section = document.createElement("article");
    section.className = "invoice";
    const head = document.createElement("div");
    head.className = "invoice-head";
    const identity = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = invoice.student_name;
    const details = document.createElement("p");
    details.textContent = "Vencimento: " + dateLabel(invoice.due_date);
    identity.append(title,details);
    const amount = document.createElement("strong");
    amount.textContent = money(invoice.amount_due);
    head.append(identity,amount);
    const meta = document.createElement("div");
    meta.className = "details";
    const status = invoice.payment_date
      ? "Pago em " + dateLabel(invoice.payment_date)
        + " — " + money(invoice.amount_paid)
      : (invoice.status === "overdue" ? "Atrasado" : "Em aberto");
    meta.textContent = status + (invoice.payment_method
      ? " — " + invoice.payment_method.toUpperCase() : "");
    section.append(head,meta);
    if (!invoice.payment_date) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Registrar pagamento";
      button.addEventListener("click", () => openPayment(invoice));
      section.appendChild(button);
    }
    return section;
  }

  function render() {
    renderSummary();
    invoiceList.replaceChildren();
    const filtered = invoices.filter(invoice => {
      if (statusFilter.value === "paid") return !!invoice.payment_date;
      if (statusFilter.value === "open") return !invoice.payment_date;
      return true;
    });
    if (!filtered.length) {
      const empty = document.createElement("p");
      empty.textContent = "Nenhuma cobrança semanal encontrada.";
      invoiceList.appendChild(empty);
      return;
    }
    filtered.forEach(invoice => invoiceList.appendChild(renderInvoice(invoice)));
  }

  async function load() {
    showStatus("Consultando cobranças semanais...", false);
    const { data, error } = await Auth.getClient().rpc(
      "get_teacher_administrative_weekly_tuition"
    );
    if (error) throw error;
    invoices = data || [];
    render();
    showStatus(invoices.length + " cobrança(s) semanal(is) no histórico.", false);
  }

  function openPayment(invoice) {
    paymentForm.hidden = false;
    paymentForm.elements.namedItem("tuition_id").value = invoice.tuition_id;
    paymentForm.elements.namedItem("payment_date").value = localToday();
    paymentForm.elements.namedItem("amount_paid").value = Number(invoice.amount_due);
    paymentForm.elements.namedItem("payment_method").value = "pix";
    paymentForm.elements.namedItem("payment_notes").value = "";
    document.getElementById("paymentTitle").textContent =
      "Registrar pagamento de " + invoice.student_name;
    paymentStatus.textContent = "";
    paymentForm.scrollIntoView({ behavior: "smooth" });
  }

  async function registerPayment(event) {
    event.preventDefault();
    const button = document.getElementById("confirmPayment");
    button.disabled = true;
    paymentStatus.textContent = "Salvando pagamento...";
    try {
      const fields = new FormData(paymentForm);
      const amount = Number(fields.get("amount_paid"));
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Valor inválido.");
      }
      const {error} = await Auth.getClient().rpc(
        "record_teacher_administrative_weekly_payment", {
          target_tuition_id: fields.get("tuition_id"),
          target_payment_date: fields.get("payment_date"),
          target_amount_paid: amount,
          target_payment_method: fields.get("payment_method"),
          target_payment_notes: fields.get("payment_notes") || null,
        }
      );
      if (error) throw error;
      paymentForm.hidden = true;
      await load();
      showStatus("Pagamento semanal registrado com sucesso.", false);
    } catch (error) {
      paymentStatus.textContent = error.message || "Não foi possível registrar.";
      paymentStatus.className = "error";
    } finally {
      button.disabled = false;
    }
  }

  async function initialize() {
    try {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (window.Auth && window.SUPABASE_CONFIG && Auth.isConfigured()) break;
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      if (!window.Auth?.isConfigured()) throw new Error("Serviço indisponível.");
      const session = await Auth.getSession();
      if (!session?.user) {
        window.location.replace("/login/?next=" + encodeURIComponent("/cobrancas-semanais/"));
        return;
      }
      const { data, error } = await Auth.getClient().rpc("is_teacher_admin");
      if (error || data !== true) throw new Error("Acesso exclusivo do professor.");
      content.hidden = false;
      statusFilter.addEventListener("change",render);
      document.getElementById("refreshButton").addEventListener("click",
        () => load().catch(error => showStatus(error.message,true)));
      document.getElementById("cancelPayment").addEventListener("click",() => {
        paymentForm.hidden = true;
      });
      paymentForm.addEventListener("submit",registerPayment);
      await load();
    } catch (error) {
      showStatus(error.message,true);
    } finally {
      document.body.classList.remove("auth-checking");
    }
  }
  initialize();
})();
