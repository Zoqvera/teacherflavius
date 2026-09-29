(function () {
  "use strict";

  const state = {
    session: null,
    preview: null,
    mercadoPago: null,
    bricksBuilder: null,
    cardBrickController: null,
    checkoutOpen: false,
    submitting: false
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function sleep(milliseconds) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, milliseconds);
    });
  }

  async function waitForResources() {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (
        window.Auth
        && window.MercadoPago
        && typeof Auth.getClient === "function"
        && typeof Auth.getSession === "function"
      ) {
        return true;
      }
      await sleep(250);
    }
    return false;
  }

  function formatCurrency(value) {
    const amount = Number(value);
    return Number.isFinite(amount)
      ? amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
      : "—";
  }

  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(String(value).slice(0, 10) + "T12:00:00");
    return Number.isNaN(date.getTime())
      ? "—"
      : date.toLocaleDateString("pt-BR");
  }

  function subscriptionStatusLabel(status) {
    const labels = {
      draft: "Ativação não concluída",
      pending: "Aguardando confirmação",
      authorized: "Assinatura ativa",
      paused: "Assinatura pausada",
      cancelled: "Assinatura cancelada"
    };
    return labels[String(status || "").toLowerCase()] || "Status indisponível";
  }

  function setMessage(message, type) {
    const element = byId("subscriptionMessage");
    if (!element) return;
    element.hidden = !message;
    element.className = "subscription-message" + (type ? " " + type : "");
    element.textContent = message || "";
  }

  function showSubscriptionSection() {
    const section = byId("subscriptionOffer");
    if (section) section.hidden = false;
  }

  function hideSubscriptionSection() {
    const section = byId("subscriptionOffer");
    if (section) section.hidden = true;
  }

  async function getFunctionFailure(error) {
    const failure = {
      message: error && error.message
        ? error.message
        : "Não foi possível processar a assinatura.",
      code: "",
      status: null
    };

    if (!error) return failure;

    try {
      if (error.context && typeof error.context.clone === "function") {
        const status = Number(error.context.status);
        if (Number.isFinite(status) && status > 0) failure.status = status;
        const data = await error.context.clone().json();
        if (data && data.error) failure.message = String(data.error);
        if (data && data.code) failure.code = String(data.code);
      }
    } catch (_) {
      // Mantém a mensagem original quando o corpo da resposta não está disponível.
    }

    return failure;
  }

  async function invokeSubscription(payload) {
    const response = await Auth.getClient().functions.invoke(
      "create-mercado-pago-subscription",
      { body: payload }
    );
    if (response.error) throw response.error;
    return response.data || {};
  }

  async function destroyCardBrick() {
    if (!state.cardBrickController) return;
    try {
      await state.cardBrickController.unmount();
    } catch (error) {
      console.warn("Não foi possível desmontar o formulário de assinatura:", error);
    }
    state.cardBrickController = null;
    const container = byId("subscriptionCardBrickContainer");
    if (container) container.innerHTML = "";
  }

  function renderPreview(preview) {
    state.preview = preview;
    const current = preview.current_subscription || null;
    const available = preview.subscriptions_enabled === true && !!preview.public_key;

    if (!current && !available) {
      hideSubscriptionSection();
      return;
    }

    showSubscriptionSection();

    const amount = byId("subscriptionAmount");
    const dueDay = byId("subscriptionDueDay");
    const firstCharge = byId("subscriptionFirstCharge");
    const status = byId("subscriptionCurrentStatus");
    const startButton = byId("subscriptionStartButton");

    if (amount) amount.textContent = formatCurrency(current ? current.amount : preview.amount);
    if (dueDay) dueDay.textContent = "Dia " + String(current ? current.due_day : preview.due_day);
    if (firstCharge) {
      firstCharge.textContent = formatDate(
        current ? current.first_charge_date : preview.first_charge_date
      );
    }

    if (current) {
      if (status) {
        status.hidden = false;
        status.textContent = subscriptionStatusLabel(current.status);
        status.dataset.status = String(current.status || "");
      }

      const currentStatus = String(current.status || "").toLowerCase();
      if (startButton) {
        startButton.hidden = !(
          available
          && currentStatus === "draft"
          && !current.provider_subscription_id
        );
        startButton.textContent = "CONTINUAR ATIVAÇÃO";
      }

      if (currentStatus === "authorized") {
        setMessage(
          "Sua assinatura mensal está ativa. As próximas cobranças serão processadas automaticamente no cartão cadastrado.",
          "success"
        );
      } else if (currentStatus === "pending") {
        setMessage(
          "A assinatura foi enviada ao Mercado Pago e está aguardando confirmação.",
          "warning"
        );
      } else if (currentStatus === "paused") {
        setMessage(
          "A assinatura está pausada. Para alterar a situação, entre em contato com o professor.",
          "warning"
        );
      } else if (currentStatus === "draft" && available) {
        setMessage(
          "A ativação anterior não foi concluída. Você pode continuar com um novo token de cartão.",
          ""
        );
      }
      return;
    }

    if (status) status.hidden = true;
    if (startButton) {
      startButton.hidden = false;
      startButton.textContent = "ATIVAR ASSINATURA MENSAL";
    }
    setMessage(
      "Cadastre um cartão para que as próximas mensalidades sejam cobradas automaticamente na data de vencimento.",
      ""
    );
  }

  async function loadPreview() {
    const preview = await invokeSubscription({ action: "preview" });
    renderPreview(preview);
    return preview;
  }

  function setCheckoutVisibility(visible) {
    state.checkoutOpen = visible;
    const checkout = byId("subscriptionCheckout");
    const startButton = byId("subscriptionStartButton");
    if (checkout) checkout.hidden = !visible;
    if (startButton) startButton.hidden = visible;
  }

  function setLoading(visible) {
    const loading = byId("subscriptionBrickLoading");
    if (loading) loading.hidden = !visible;
  }

  async function submitSubscription(formData) {
    if (state.submitting) return;
    const cardTokenId = String(formData && formData.token ? formData.token : "").trim();
    if (!cardTokenId) {
      throw new Error("O Mercado Pago não retornou um token válido para o cartão.");
    }

    state.submitting = true;
    setMessage("Ativando a assinatura mensal com segurança...", "");

    try {
      const result = await invokeSubscription({
        action: "create",
        card_token_id: cardTokenId
      });

      await destroyCardBrick();
      setCheckoutVisibility(false);

      const currentStatus = byId("subscriptionCurrentStatus");
      if (currentStatus) {
        currentStatus.hidden = false;
        currentStatus.dataset.status = String(result.status || "");
        currentStatus.textContent = subscriptionStatusLabel(result.status);
      }

      const firstCharge = byId("subscriptionFirstCharge");
      if (firstCharge) firstCharge.textContent = formatDate(result.first_charge_date);

      const startButton = byId("subscriptionStartButton");
      if (startButton) startButton.hidden = true;

      setMessage(
        result.status === "authorized"
          ? "Assinatura ativada. As próximas mensalidades serão cobradas automaticamente na data de vencimento."
          : "Assinatura criada e aguardando confirmação do Mercado Pago.",
        result.status === "authorized" ? "success" : "warning"
      );

      await loadPreview();
    } catch (error) {
      const failure = await getFunctionFailure(error);
      setMessage(failure.message, "error");
      throw error;
    } finally {
      state.submitting = false;
    }
  }

  async function renderCardBrick() {
    const preview = state.preview;
    if (
      !preview
      || preview.subscriptions_enabled !== true
      || !preview.public_key
    ) {
      setMessage("A assinatura mensal ainda não está disponível.", "warning");
      return;
    }

    await destroyCardBrick();
    setCheckoutVisibility(true);
    setLoading(true);

    if (!state.mercadoPago) {
      state.mercadoPago = new window.MercadoPago(preview.public_key, {
        locale: "pt-BR"
      });
      state.bricksBuilder = state.mercadoPago.bricks();
    }

    const settings = {
      initialization: {
        amount: Number(preview.amount),
        payer: {
          email: state.session && state.session.user
            ? (state.session.user.email || "")
            : ""
        }
      },
      customization: {
        paymentMethods: {
          types: {
            excluded: ["debit_card", "prepaid_card"]
          }
        },
        visual: {
          style: { theme: "dark" }
        }
      },
      callbacks: {
        onReady: function () {
          setLoading(false);
        },
        onSubmit: async function (formData) {
          return submitSubscription(formData);
        },
        onError: function (error) {
          console.error("Erro do Mercado Pago Card Payment Brick:", error);
          setMessage(
            "Não foi possível carregar ou validar os dados do cartão. Tente novamente.",
            "error"
          );
        }
      }
    };

    state.cardBrickController = await state.bricksBuilder.create(
      "cardPayment",
      "subscriptionCardBrickContainer",
      settings
    );
  }

  async function closeCheckout() {
    await destroyCardBrick();
    setCheckoutVisibility(false);

    const startButton = byId("subscriptionStartButton");
    if (startButton && state.preview) {
      const current = state.preview.current_subscription || null;
      const currentStatus = String(current && current.status ? current.status : "");
      startButton.hidden = !(
        state.preview.subscriptions_enabled === true
        && (!current || currentStatus === "draft")
      );
    }
  }

  async function initialize() {
    const ready = await waitForResources();
    if (!ready) return;

    state.session = await Auth.getSession();
    if (!state.session || !state.session.user) return;

    try {
      await loadPreview();
    } catch (error) {
      const failure = await getFunctionFailure(error);
      if (
        failure.code === "subscription_billing_not_ready"
        || failure.status === 403
      ) {
        hideSubscriptionSection();
        return;
      }
      console.warn("Não foi possível carregar a opção de assinatura:", failure.code || failure.message);
      hideSubscriptionSection();
    }
  }

  const startButton = byId("subscriptionStartButton");
  if (startButton) {
    startButton.addEventListener("click", function () {
      renderCardBrick().catch(async function (error) {
        const failure = await getFunctionFailure(error);
        setMessage(failure.message, "error");
        setLoading(false);
        setCheckoutVisibility(false);
      });
    });
  }

  const closeButton = byId("subscriptionCloseButton");
  if (closeButton) {
    closeButton.addEventListener("click", function () {
      closeCheckout();
    });
  }

  window.addEventListener("beforeunload", function () {
    destroyCardBrick();
  });

  initialize();
})();