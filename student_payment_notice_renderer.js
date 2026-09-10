(function () {
  "use strict";

  const BANNER_ID = "tf-tuition-payment-banner";
  const MODAL_ID = "tf-tuition-payment-modal";
  const STYLE_ID = "tf-tuition-payment-notice-styles";
  const PAYMENT_PATH = "/pagamento/";
  const HTML_EXTENSION = "." + "html";
  const INDEX_SUFFIX = "/index" + HTML_EXTENSION;

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      "#" + BANNER_ID + ", #" + BANNER_ID + " *, #" + MODAL_ID + ", #" + MODAL_ID + " * { box-sizing: border-box; }",
      "#" + BANNER_ID + " { position: sticky; top: 0; z-index: 45000; display: flex; align-items: center; justify-content: center; gap: 16px; width: 100%; min-height: 58px; padding: 10px 18px; font-family: Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; text-align: left; }",
      "#" + BANNER_ID + ".tf-tuition-payment-banner--warning { color: #422006; background: linear-gradient(135deg,#fde047,#f59e0b); border-bottom: 1px solid rgba(120,53,15,.28); box-shadow: 0 10px 28px rgba(161,98,7,.24); }",
      "#" + BANNER_ID + ".tf-tuition-payment-banner--overdue { color: #fff; background: linear-gradient(135deg,#991b1b,#dc2626); border-bottom: 1px solid rgba(254,202,202,.42); box-shadow: 0 10px 30px rgba(127,29,29,.28); }",
      "#" + BANNER_ID + " strong { font-size: 14px; line-height: 1.45; }",
      "#" + BANNER_ID + " a { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; min-height: 38px; padding: 9px 15px; border-radius: 999px; font-size: 12px; font-weight: 900; letter-spacing: .03em; text-decoration: none; text-transform: uppercase; transition: transform 160ms ease, background 160ms ease; }",
      "#" + BANNER_ID + ".tf-tuition-payment-banner--warning a { color: #fef3c7; background: #422006; border: 1px solid rgba(66,32,6,.75); }",
      "#" + BANNER_ID + ".tf-tuition-payment-banner--warning a:hover { background: #713f12; transform: translateY(-1px); }",
      "#" + BANNER_ID + ".tf-tuition-payment-banner--overdue a { color: #991b1b; background: #fff; border: 1px solid rgba(255,255,255,.72); }",
      "#" + BANNER_ID + ".tf-tuition-payment-banner--overdue a:hover { background: #fef2f2; transform: translateY(-1px); }",
      "#" + BANNER_ID + " a:focus-visible, #" + MODAL_ID + " button:focus-visible, #" + MODAL_ID + " a:focus-visible { outline: 3px solid #fde047; outline-offset: 3px; }",
      "#" + MODAL_ID + " { position: fixed; inset: 0; z-index: 50000; display: flex; align-items: center; justify-content: center; padding: 22px; background: rgba(2,6,23,.76); backdrop-filter: blur(8px); font-family: Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }",
      "#" + MODAL_ID + "[hidden] { display: none; }",
      "#" + MODAL_ID + " .tf-tuition-modal__box { width: min(100%,500px); padding: 28px; border: 1px solid rgba(248,113,113,.45); border-radius: 22px; color: #e5e7eb; background: linear-gradient(145deg,#111827,#1e293b); box-shadow: 0 28px 80px rgba(2,6,23,.58); position: relative; }",
      "#" + MODAL_ID + " .tf-tuition-modal__icon { display: inline-flex; align-items: center; justify-content: center; width: 48px; height: 48px; margin-bottom: 16px; border-radius: 15px; color: #fff; background: #dc2626; font-size: 24px; font-weight: 900; }",
      "#" + MODAL_ID + " h2 { margin: 0 42px 10px 0; color: #fff; font-size: clamp(23px,5vw,30px); line-height: 1.15; }",
      "#" + MODAL_ID + " p { margin: 0; color: #cbd5e1; font-size: 15px; line-height: 1.65; }",
      "#" + MODAL_ID + " .tf-tuition-modal__note { margin-top: 14px; padding: 12px 14px; border-radius: 12px; color: #fecaca; background: rgba(220,38,38,.12); font-size: 13px; }",
      "#" + MODAL_ID + " .tf-tuition-modal__actions { display: flex; gap: 10px; margin-top: 22px; }",
      "#" + MODAL_ID + " .tf-tuition-modal__pay { flex: 1; display: inline-flex; align-items: center; justify-content: center; min-height: 47px; padding: 11px 17px; border-radius: 999px; color: #fff; background: linear-gradient(135deg,#dc2626,#991b1b); font-size: 13px; font-weight: 900; text-decoration: none; text-transform: uppercase; }",
      "#" + MODAL_ID + " .tf-tuition-modal__later { min-height: 47px; padding: 11px 17px; border: 1px solid rgba(148,163,184,.35); border-radius: 999px; color: #cbd5e1; background: rgba(255,255,255,.04); font-size: 13px; font-weight: 800; cursor: pointer; }",
      "#" + MODAL_ID + " .tf-tuition-modal__close { position: absolute; top: 18px; right: 18px; width: 38px; height: 38px; border: 1px solid rgba(148,163,184,.28); border-radius: 50%; color: #fff; background: rgba(255,255,255,.05); font-size: 23px; line-height: 1; cursor: pointer; }",
      "@media (max-width:620px) { #" + BANNER_ID + " { align-items: stretch; flex-direction: column; gap: 8px; padding: 11px 14px; } #" + BANNER_ID + " strong { text-align: center; } #" + BANNER_ID + " a { width: 100%; } #" + MODAL_ID + " .tf-tuition-modal__box { padding: 24px 20px; } #" + MODAL_ID + " .tf-tuition-modal__actions { flex-direction: column; } }",
      "@media (prefers-reduced-motion: reduce) { #" + BANNER_ID + " a { transition: none; } }",
      "@media print { #" + BANNER_ID + ", #" + MODAL_ID + " { display: none !important; } }"
    ].join("\n");
    document.head.appendChild(style);
  }

  function createPaymentLink(className, text) {
    const link = document.createElement("a");
    if (className) link.className = className;
    link.href = PAYMENT_PATH;
    link.textContent = text;
    return link;
  }

  function showBanner(summary, tone) {
    if (document.getElementById(BANNER_ID)) return;

    const isWarning = tone === "warning";
    const banner = document.createElement("aside");
    const message = document.createElement("strong");

    banner.id = BANNER_ID;
    banner.className = isWarning
      ? "tf-tuition-payment-banner--warning"
      : "tf-tuition-payment-banner--overdue";
    banner.setAttribute("role", "alert");
    banner.setAttribute(
      "aria-label",
      isWarning ? "Aviso de vencimento da mensalidade" : "Aviso de mensalidade vencida"
    );
    message.textContent = summary.banner;
    banner.appendChild(message);
    banner.appendChild(createPaymentLink("", "Pagar mensalidade"));
    document.body.insertBefore(banner, document.body.firstChild);
  }

  function closeModal() {
    const modal = document.getElementById(MODAL_ID);
    if (modal) modal.hidden = true;
  }

  function normalizeCurrentPath() {
    const pathname = window.location.pathname;
    if (!pathname.endsWith(INDEX_SUFFIX)) return pathname;
    return pathname.slice(0, -INDEX_SUFFIX.length) + "/";
  }

  function shouldSkipModal(session, oldestTuition) {
    const storageKey = "tf-tuition-payment-popup:" + session.user.id + ":" + oldestTuition.tuition_id;
    try {
      if (window.sessionStorage.getItem(storageKey) === "shown") return true;
      window.sessionStorage.setItem(storageKey, "shown");
    } catch (_error) {
      // O aviso continua funcionando mesmo quando o navegador bloqueia sessionStorage.
    }
    return false;
  }

  function createButton(className, label, text) {
    const button = document.createElement("button");
    button.className = className;
    button.type = "button";
    button.textContent = text;
    if (label) button.setAttribute("aria-label", label);
    return button;
  }

  function buildModal(summary) {
    const modal = document.createElement("div");
    const box = document.createElement("div");
    const closeButton = createButton("tf-tuition-modal__close", "Fechar aviso", "×");
    const icon = document.createElement("div");
    const title = document.createElement("h2");
    const description = document.createElement("p");
    const note = document.createElement("p");
    const actions = document.createElement("div");
    const laterButton = createButton("tf-tuition-modal__later", "", "Ver depois");
    const paymentLink = createPaymentLink("tf-tuition-modal__pay", "Pagar agora");

    modal.id = MODAL_ID;
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "tf-tuition-modal-title");

    box.className = "tf-tuition-modal__box";
    icon.className = "tf-tuition-modal__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "!";
    title.id = "tf-tuition-modal-title";
    title.textContent = summary.title;
    description.textContent = summary.description;
    note.className = "tf-tuition-modal__note";
    note.textContent = "O pagamento pode ser feito com Pix ou cartão de crédito em ambiente protegido pelo Mercado Pago.";
    actions.className = "tf-tuition-modal__actions";

    closeButton.addEventListener("click", closeModal);
    laterButton.addEventListener("click", closeModal);
    actions.appendChild(paymentLink);
    actions.appendChild(laterButton);
    box.appendChild(closeButton);
    box.appendChild(icon);
    box.appendChild(title);
    box.appendChild(description);
    box.appendChild(note);
    box.appendChild(actions);
    modal.appendChild(box);

    modal.addEventListener("click", function (event) {
      if (event.target === modal) closeModal();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeModal();
    });

    return modal;
  }

  function showOverdueModal(summary, session, oldestTuition) {
    if (normalizeCurrentPath() === PAYMENT_PATH) return;
    if (document.getElementById(MODAL_ID)) return;
    if (shouldSkipModal(session, oldestTuition)) return;

    const modal = buildModal(summary);
    document.body.appendChild(modal);
    modal.querySelector(".tf-tuition-modal__pay").focus();
  }

  window.StudentPaymentNoticeRenderer = Object.freeze({
    installStyles: installStyles,
    showBanner: showBanner,
    showOverdueModal: showOverdueModal
  });
})();
