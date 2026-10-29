(function () {
  "use strict";

  const PUBLIC_LINK = "https://teacherflavius.com/escolher-turma/";
  const POLL_MS = 15000;
  const status = document.getElementById("status");
  const content = document.getElementById("content");

  function showStatus(message, isError) {
    status.textContent = message;
    status.classList.toggle("error", Boolean(isError));
    status.hidden = !message;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function phoneLink(value) {
    const digits = String(value || "").replace(/\D/g, "");
    const normalized = digits.startsWith("55") ? digits : "55" + digits;
    const link = element("a", "", "CONTATAR PELO WHATSAPP");
    link.href = "https://wa.me/" + normalized;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
  }

  function classLabel(number) {
    return "Turma " + number;
  }

  function reservationLabel(hold) {
    const expiry = Date.parse(hold.expires_at);
    if (hold.status !== "active") return hold.status === "claimed" ? "Matriculado" : "Encerrada";
    if (expiry <= Date.now()) return "Expirada";
    return "Reservada até " + new Date(expiry).toLocaleString("pt-BR");
  }

  async function changeStatus(id, kind) {
    const response = await window.Auth.getClient().rpc("resolve_teacher_class_seat_lead", {
      target_id: id,
      target_kind: kind
    });
    if (response.error) throw response.error;
    await reload();
  }

  function leadCard(lead, kind) {
    const item = element("article", "class-card");
    const heading = element("h3", "", lead.applicant_name);
    const details = element("p", "", classLabel(lead.class_number) + " · " + lead.whatsapp);
    const meta = element("p", "class-time", kind === "hold"
      ? reservationLabel(lead)
      : "Aguardando abertura de vaga");
    const actions = element("div", "actions");
    const openStudents = element("a", "secondary", "LOCALIZAR ALUNO");
    openStudents.href = "/perfil-dos-alunos/";
    const contact = phoneLink(lead.whatsapp);
    actions.append(openStudents, contact);
    if ((kind === "hold" && lead.status === "active" && Date.parse(lead.expires_at) > Date.now())
      || kind === "waitlist") {
      const action = element("button", "secondary", kind === "hold" ? "LIBERAR VAGA" : "MARCAR RESOLVIDO");
      action.type = "button";
      action.addEventListener("click", async function () {
        action.disabled = true;
        try {
          await changeStatus(lead.id, kind);
          showStatus("Registro atualizado.");
        } catch (error) {
          showStatus(error.message || "Falha ao atualizar.", true);
          action.disabled = false;
        }
      });
      actions.append(action);
    }
    item.append(heading, details, meta, actions);
    return item;
  }

  function render(targetId, leads, kind) {
    const container = document.getElementById(targetId);
    container.replaceChildren();
    if (!leads.length) {
      container.append(element("p", "empty", "Nenhum registro encontrado."));
      return;
    }
    const list = element("div", "class-list");
    leads.forEach(function (lead) { list.append(leadCard(lead, kind)); });
    container.append(list);
  }

  async function reload() {
    const response = await window.Auth.getClient().rpc("get_teacher_class_seat_leads");
    if (response.error) throw response.error;
    const data = response.data || {};
    render("holds", Array.isArray(data.holds) ? data.holds : [], "hold");
    render("waitlist", Array.isArray(data.waitlist) ? data.waitlist : [], "waitlist");
    content.hidden = false;
  }

  async function waitForAuth() {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (window.Auth && window.Auth.isConfigured && window.Auth.isConfigured()) return true;
      await new Promise(function (resolve) { setTimeout(resolve, 100); });
    }
    return false;
  }

  async function initialize() {
    document.getElementById("copyLink").addEventListener("click", async function () {
      try {
        await navigator.clipboard.writeText(PUBLIC_LINK);
        showStatus("Link copiado para envio pelo WhatsApp.");
      } catch (_error) {
        showStatus(PUBLIC_LINK);
      }
    });
    document.getElementById("reload").addEventListener("click", function () {
      reload().catch(function (error) { showStatus(error.message, true); });
    });

    try {
      if (!await waitForAuth()) throw new Error("Autenticação indisponível.");
      const session = await window.Auth.getSession();
      if (!session || !session.user) {
        window.location.assign("/login/?next=" + encodeURIComponent("/reservas-de-turmas/"));
        return;
      }
      const role = await window.Auth.getClient().rpc("is_teacher_admin");
      if (role.error || role.data !== true) throw new Error("Área exclusiva do professor.");
      await reload();
      showStatus("");
      setInterval(function () {
        if (!document.hidden) reload().catch(function () {
          showStatus("Não foi possível atualizar as reservas automaticamente.", true);
        });
      }, POLL_MS);
    } catch (error) {
      showStatus(error.message || "Acesso indisponível.", true);
    } finally {
      document.body.classList.remove("auth-checking");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
