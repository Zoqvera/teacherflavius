(function () {
  "use strict";

  const PAGE_KEY = "curso-de-ingles-ao-vivo-ou-gravado";
  const TABLE_NAME = "page_content_overrides";
  const LOGIN_PATH = "/login/";
  const AUTH_MAX_ATTEMPTS = 50;
  const AUTH_RETRY_DELAY_MS = 120;

  const FIELD_GROUPS = Object.freeze([
    {
      title: "Abertura da página",
      fields: [
        ["hero_eyebrow", "Categoria acima do título", "short"],
        ["hero_title", "Título principal", "short"],
        ["hero_intro", "Parágrafo de abertura", "long"],
        ["short_answer_label", "Rótulo da resposta curta", "short"],
        ["short_answer_text", "Resposta curta", "long"]
      ]
    },
    {
      title: "Curso gravado",
      fields: [
        ["recorded_title", "Título da seção", "short"],
        ["recorded_p1", "Primeiro parágrafo", "long"],
        ["recorded_p2", "Segundo parágrafo", "long"]
      ]
    },
    {
      title: "Aula ao vivo",
      fields: [
        ["live_title", "Título da seção", "short"],
        ["live_p1", "Primeiro parágrafo", "long"],
        ["live_p2", "Segundo parágrafo", "long"]
      ]
    },
    {
      title: "Conversação",
      fields: [
        ["conversation_title", "Título da seção", "short"],
        ["conversation_p1", "Parágrafo", "long"]
      ]
    },
    {
      title: "Combinação dos formatos",
      fields: [
        ["hybrid_title", "Título da seção", "short"],
        ["hybrid_p1", "Primeiro parágrafo", "long"],
        ["hybrid_p2", "Segundo parágrafo", "long"]
      ]
    },
    {
      title: "Como escolher",
      fields: [
        ["choose_title", "Título da seção", "short"],
        ["choose_item_1", "Item 1", "short"],
        ["choose_item_2", "Item 2", "short"],
        ["choose_item_3", "Item 3", "short"],
        ["choose_item_4", "Item 4", "short"],
        ["choose_item_5", "Item 5", "short"]
      ]
    },
    {
      title: "Leituras relacionadas",
      fields: [
        ["related_title", "Título da seção", "short"],
        ["related_link_1", "Texto do primeiro link", "short"],
        ["related_link_2", "Texto do segundo link", "short"]
      ]
    },
    {
      title: "Chamada final",
      fields: [
        ["cta_title", "Título", "short"],
        ["cta_text", "Parágrafo", "long"],
        ["cta_button", "Texto do botão", "short"]
      ]
    }
  ]);

  const status = document.getElementById("editorStatus");
  const form = document.getElementById("contentEditor");
  const fieldsRoot = document.getElementById("editorFields");
  const saveButton = document.getElementById("saveButton");
  const saveStatus = document.getElementById("saveStatus");
  let currentSession = null;

  function setStatus(message, state) {
    status.textContent = message;
    status.className = "status" + (state ? " is-" + state : "");
  }

  function setSaveStatus(message, state) {
    saveStatus.textContent = message;
    saveStatus.className = "save-status" + (state ? " is-" + state : "");
  }

  function sleep(milliseconds) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, milliseconds);
    });
  }

  function authIsReady() {
    try {
      return Boolean(
        window.Auth &&
        typeof window.Auth.getSession === "function" &&
        typeof window.Auth.getClient === "function" &&
        window.SUPABASE_CONFIG &&
        window.Auth.isConfigured()
      );
    } catch (error) {
      return false;
    }
  }

  async function waitForAuth() {
    for (let attempt = 0; attempt < AUTH_MAX_ATTEMPTS; attempt += 1) {
      if (authIsReady()) return true;
      await sleep(AUTH_RETRY_DELAY_MS);
    }
    return false;
  }

  function redirectToLogin() {
    let nextPath = window.location.pathname;
    if (window.Auth && typeof window.Auth.normalizeNextPath === "function") {
      nextPath = window.Auth.normalizeNextPath(window.location.pathname, window.location.pathname);
    }
    window.location.href = LOGIN_PATH + "?next=" + encodeURIComponent(nextPath);
  }

  function createField(fieldConfig) {
    const key = fieldConfig[0];
    const labelText = fieldConfig[1];
    const size = fieldConfig[2];
    const row = document.createElement("div");
    const label = document.createElement("label");
    const textarea = document.createElement("textarea");

    row.className = "field-row";
    label.htmlFor = "field-" + key;
    label.textContent = labelText;
    textarea.id = "field-" + key;
    textarea.name = key;
    textarea.dataset.contentField = key;
    textarea.dataset.size = size;
    textarea.spellcheck = true;

    row.appendChild(label);
    row.appendChild(textarea);
    return row;
  }

  function renderFields() {
    const fragment = document.createDocumentFragment();

    FIELD_GROUPS.forEach(function (groupConfig) {
      const section = document.createElement("section");
      const title = document.createElement("h2");

      section.className = "field-group";
      title.textContent = groupConfig.title;
      section.appendChild(title);

      groupConfig.fields.forEach(function (fieldConfig) {
        section.appendChild(createField(fieldConfig));
      });

      fragment.appendChild(section);
    });

    fieldsRoot.replaceChildren(fragment);
  }

  function populateFields(content) {
    document.querySelectorAll("[data-content-field]").forEach(function (textarea) {
      const value = content[textarea.dataset.contentField];
      textarea.value = typeof value === "string" ? value : "";
    });
  }

  function collectContent() {
    const content = {};
    document.querySelectorAll("[data-content-field]").forEach(function (textarea) {
      content[textarea.dataset.contentField] = textarea.value.trim();
    });
    return content;
  }

  async function loadContent(client) {
    const response = await client
      .from(TABLE_NAME)
      .select("content,updated_at")
      .eq("page_key", PAGE_KEY)
      .maybeSingle();

    if (response.error) throw response.error;
    if (!response.data || !response.data.content) {
      throw new Error("O conteúdo editável desta página não foi encontrado.");
    }

    populateFields(response.data.content);
    return response.data.updated_at;
  }

  async function guardAdmin() {
    if (!(await waitForAuth())) {
      setStatus("Não foi possível carregar a autenticação administrativa.", "error");
      document.body.classList.remove("auth-checking");
      return;
    }

    currentSession = await window.Auth.getSession();
    if (!currentSession || !currentSession.user) {
      redirectToLogin();
      return;
    }

    const client = window.Auth.getClient();
    const adminResponse = await client.rpc("is_teacher_admin");
    if (adminResponse.error) throw adminResponse.error;
    if (adminResponse.data !== true) {
      setStatus("Acesso negado. Este editor é exclusivo da conta administrativa.", "error");
      document.body.classList.remove("auth-checking");
      return;
    }

    renderFields();
    await loadContent(client);
    form.hidden = false;
    document.body.classList.remove("auth-checking");
    setStatus("Editor carregado. As alterações só são publicadas quando você usa o botão no fim da página.", "success");
  }

  async function saveContent(event) {
    event.preventDefault();
    if (!currentSession || !currentSession.user) return;

    const client = window.Auth.getClient();
    const payload = {
      page_key: PAGE_KEY,
      content: collectContent(),
      updated_at: new Date().toISOString(),
      updated_by: currentSession.user.id
    };

    saveButton.disabled = true;
    setSaveStatus("Salvando e publicando os novos textos...", "");

    try {
      const response = await client
        .from(TABLE_NAME)
        .upsert(payload, { onConflict: "page_key" })
        .select("updated_at")
        .single();

      if (response.error) throw response.error;
      setSaveStatus("Versão publicada. Recarregue a página pública para conferir os textos atualizados.", "success");
    } catch (error) {
      console.error("Falha ao publicar o conteúdo editado.", error);
      setSaveStatus("Não foi possível publicar. Nenhuma alteração parcial foi aplicada.", "error");
    } finally {
      saveButton.disabled = false;
    }
  }

  form.addEventListener("submit", saveContent);

  guardAdmin().catch(function (error) {
    console.error("Falha ao inicializar o editor temporário.", error);
    setStatus("Não foi possível abrir o editor. Verifique sua sessão administrativa e tente novamente.", "error");
    document.body.classList.remove("auth-checking");
  });
})();
