(function () {
  "use strict";

  const PURCHASES_KEY = "tf_analytics_purchases_v1";
  const RETRY_INTERVAL_MS = 250;
  const MAX_RETRY_ATTEMPTS = 60;

  function assertDependencies(dependencies) {
    if (!dependencies || typeof dependencies.track !== "function") {
      throw new Error("Analytics payment instrumentation requires track().");
    }
    if (!dependencies.utils) {
      throw new Error("Analytics payment instrumentation requires utilities.");
    }
  }

  function create(dependencies) {
    assertDependencies(dependencies);
    const deps = dependencies;
    const checkoutSeen = Object.create(null);
    let paymentContext = null;

    function parseBrlAmount(text) {
      const normalized = String(text || "")
        .replace(/[^0-9,.-]/g, "")
        .replace(/\./g, "")
        .replace(",", ".");
      const value = Number(normalized);
      return Number.isFinite(value) ? value : 0;
    }

    function paymentDomContext(tuitionId) {
      const selectedCard = document.querySelector(".tuition-card.selected");
      const amountNode = selectedCard && selectedCard.querySelector(".tuition-card__amount");
      return {
        tuition_id: deps.utils.cleanText(
          tuitionId || (selectedCard && selectedCard.getAttribute("data-tuition-id")),
          80
        ),
        value: parseBrlAmount(amountNode && amountNode.textContent),
        currency: "BRL"
      };
    }

    function checkoutItems(context) {
      return [{
        item_id: "monthly_tuition",
        item_name: "Mensalidade Teacher Flávio",
        item_variant: context.tuition_id || "tuition",
        price: context.value || 0,
        quantity: 1
      }];
    }

    function trackBeginCheckoutIfReady() {
      if (deps.utils.classifyArea(deps.utils.currentPath()) !== "payment") return false;

      const workspace = document.getElementById("paymentWorkspace");
      const selectedCard = document.querySelector(".tuition-card.selected");
      if (!workspace || workspace.hidden || !selectedCard) return false;

      const tuitionId = deps.utils.cleanText(
        selectedCard.getAttribute("data-tuition-id"),
        80
      ) || "selected";
      if (checkoutSeen[tuitionId]) return true;

      checkoutSeen[tuitionId] = true;
      const context = paymentDomContext(tuitionId);
      deps.track("begin_checkout", {
        currency: context.currency,
        value: context.value,
        tuition_id: context.tuition_id,
        items: checkoutItems(context)
      });
      return true;
    }

    function purchaseAlreadyTracked(transactionId) {
      const ids = deps.utils.safeJsonParse(
        deps.utils.safeStorageGet(window.localStorage, PURCHASES_KEY),
        []
      );
      return Array.isArray(ids) && ids.indexOf(transactionId) !== -1;
    }

    function rememberPurchase(transactionId) {
      let ids = deps.utils.safeJsonParse(
        deps.utils.safeStorageGet(window.localStorage, PURCHASES_KEY),
        []
      );
      if (!Array.isArray(ids)) ids = [];
      if (ids.indexOf(transactionId) === -1) ids.push(transactionId);
      deps.utils.safeStorageSet(
        window.localStorage,
        PURCHASES_KEY,
        JSON.stringify(ids.slice(-50))
      );
    }

    function trackPurchase(paidTuitionId) {
      if (!paymentContext || !paymentContext.transaction_id) return;

      const transactionId = String(paymentContext.transaction_id);
      if (purchaseAlreadyTracked(transactionId)) return;

      const context = Object.assign({}, paymentContext, {
        tuition_id: deps.utils.cleanText(
          paidTuitionId || paymentContext.tuition_id,
          80
        )
      });
      rememberPurchase(transactionId);
      deps.track("purchase", {
        transaction_id: transactionId,
        currency: "BRL",
        value: context.value || 0,
        payment_type: context.payment_type || "unknown",
        tuition_id: context.tuition_id,
        items: checkoutItems(context)
      });
    }

    function installInvokePaymentInstrumentation() {
      if (
        typeof window.invokePaymentFunction !== "function" ||
        window.invokePaymentFunction.__tfAnalyticsWrapped
      ) {
        return;
      }

      const originalInvoke = window.invokePaymentFunction;
      const wrappedInvoke = async function (payload) {
        const isPayment = payload && payload.action === "pay";
        const context = isPayment ? paymentDomContext(payload.tuition_id) : null;

        if (isPayment) {
          context.payment_type = deps.utils.cleanText(
            payload.selected_payment_method,
            80
          ) || "unknown";
          deps.track("add_payment_info", {
            currency: "BRL",
            value: context.value,
            payment_type: context.payment_type,
            tuition_id: context.tuition_id,
            items: checkoutItems(context)
          });
        }

        try {
          const result = await originalInvoke.apply(this, arguments);
          if (isPayment && result && result.payment_id) {
            paymentContext = Object.assign({}, context, {
              transaction_id: String(result.payment_id)
            });
          }
          return result;
        } catch (error) {
          if (isPayment) {
            deps.track("payment_error", {
              payment_type: context && context.payment_type || "unknown",
              tuition_id: context && context.tuition_id || "unknown",
              error_type: "payment_creation_failed"
            });
          }
          throw error;
        }
      };

      wrappedInvoke.__tfAnalyticsWrapped = true;
      window.invokePaymentFunction = wrappedInvoke;
    }

    function installRefreshInstrumentation() {
      if (
        typeof window.refreshAfterPayment !== "function" ||
        window.refreshAfterPayment.__tfAnalyticsWrapped
      ) {
        return;
      }

      const originalRefresh = window.refreshAfterPayment;
      const wrappedRefresh = async function (paidTuitionId) {
        const completed = await originalRefresh.apply(this, arguments);
        if (completed === true) trackPurchase(paidTuitionId);
        return completed;
      };

      wrappedRefresh.__tfAnalyticsWrapped = true;
      window.refreshAfterPayment = wrappedRefresh;
    }

    function installPaymentInstrumentation() {
      if (deps.utils.classifyArea(deps.utils.currentPath()) !== "payment") return true;

      installInvokePaymentInstrumentation();
      installRefreshInstrumentation();
      trackBeginCheckoutIfReady();
      return (
        typeof window.invokePaymentFunction === "function" &&
        typeof window.refreshAfterPayment === "function"
      );
    }

    function handleClick(event) {
      const target = event.target && event.target.closest
        ? event.target.closest("a[href],button")
        : null;
      if (!target || !target.classList || !target.classList.contains("tuition-card")) return;
      window.setTimeout(trackBeginCheckoutIfReady, 0);
    }

    function retryPaymentInstrumentation() {
      if (deps.utils.classifyArea(deps.utils.currentPath()) !== "payment") return;
      let attempts = 0;
      const timer = window.setInterval(function () {
        attempts += 1;
        const ready = installPaymentInstrumentation();
        trackBeginCheckoutIfReady();
        if (ready || attempts >= MAX_RETRY_ATTEMPTS) {
          window.clearInterval(timer);
        }
      }, RETRY_INTERVAL_MS);
    }

    function initialize() {
      document.addEventListener("click", handleClick, true);
      installPaymentInstrumentation();
      retryPaymentInstrumentation();
    }

    return Object.freeze({
      initialize: initialize,
      trackBeginCheckoutIfReady: trackBeginCheckoutIfReady
    });
  }

  window.TeacherAnalyticsPayments = Object.freeze({
    create: create
  });
})();
