(function () {
  "use strict";

  const form = document.getElementById("newLinkForm");
  const list = document.getElementById("linksList");
  const status = document.getElementById("adminStatus");

  function setStatus(message) {
    status.textContent = message || "";
  }

  async function request(action, values) {
    const args = Object.assign({ target_action: action }, values || {});
    const response = await Auth.getClient().rpc("manage_enrollment_invite_links", args);
    if (response.error) throw response.error;
    if (!response.data || response.data.ok !== true) {
      throw new Error("Não foi possível gerenciar os links de matrícula.");
    }
    return response.data;
  }

  function createElement(tag, className, label) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (label != null) element.textContent = label;
    return element;
  }

  function createAction(label, handler, className) {
    const button = createElement("button", className, label);
    button.type = "button";
    button.addEventListener("click", async function () {
      button.disabled = true;
      setStatus("");
      try {
        await handler();
      } catch (error) {
        setStatus(error.message || "Não foi possível concluir a operação.");
      } finally {
        button.disabled = false;
      }
    });
    return button;
  }

  function formatPrice(price) {
    return Number(price).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function renderLink(item) {
    const card = createElement("article", "invite-card");
    const heading = createElement("div", "invite-title");
    heading.append(
      createElement("strong", "", item.label),
      createElement("span", "state" + (item.active ? "" : " is-inactive"),
        item.active ? "Ativo" : "Desativado")
    );

    const meta = createElement("p", "invite-meta",
      (item.class_mode === "group" ? "Aulas em grupo" : "Aulas individuais") +
      " · " + item.classes_per_month + " aulas por mês · " + formatPrice(item.monthly_fee));
    const url = window.EnrollmentInviteClient.buildInviteUrl(item.token);
    const address = createElement("div", "invite-url", url);
    const actions = createElement("div", "actions");

    actions.append(createAction("Copiar link", async function () {
      await navigator.clipboard.writeText(url);
      setStatus("Link copiado.");
    }));
    actions.append(createAction(item.active ? "Desativar" : "Ativar", async function () {
      await request("set_active", { target_id: item.id, target_active: !item.active });
      await loadLinks();
    }, "secondary"));
    actions.append(createAction("Renovar endereço", async function () {
      if (!window.confirm("O endereço anterior deixará de funcionar para novas matrículas. Continuar?")) return;
      await request("rotate", { target_id: item.id });
      await loadLinks();
    }, "secondary"));

    card.append(heading, meta, address, actions);
    return card;
  }

  async function loadLinks() {
    const result = await request("list");
    list.replaceChildren();
    const items = Array.isArray(result.links) ? result.links : [];
    if (!items.length) {
      list.append(createElement("p", "", "Nenhum link cadastrado."));
      return;
    }
    items.forEach(function (item) {
      list.append(renderLink(item));
    });
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    const button = document.getElementById("createLink");
    const data = new FormData(form);
    button.disabled = true;
    setStatus("");
    try {
      await request("create", {
        target_label: String(data.get("label") || "").trim(),
        target_class_mode: String(data.get("classMode") || ""),
        target_monthly_fee: Number(data.get("monthlyFee")),
        target_classes_per_month: Number(data.get("classesPerMonth"))
      });
      form.reset();
      await loadLinks();
      setStatus("Plano criado. O novo link já pode ser compartilhado.");
    } catch (error) {
      setStatus(error.message || "Não foi possível criar o link.");
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("refreshLinks").addEventListener("click", function () {
    loadLinks().catch(function (error) { setStatus(error.message); });
  });

  async function initialize() {
    const user = await Auth.requireAuth({ skipProfileCheck: true });
    if (!user) return;
    if (!(await Auth.isTeacherAdmin())) {
      setStatus("Acesso permitido apenas ao professor.");
      return;
    }
    document.getElementById("adminPage").hidden = false;
    await loadLinks();
    setStatus("");
  }

  initialize().catch(function (error) {
    setStatus(error.message || "Não foi possível carregar a página.");
  });
})();
