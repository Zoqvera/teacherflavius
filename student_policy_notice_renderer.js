(function () {
  "use strict";

  const MODAL_ID = "tf-required-student-policy-modal";
  const STYLE_ID = "tf-required-student-policy-styles";
  const LOCK_CLASS = "tf-required-student-policy-locked";
  let inertSnapshot = [];
  let previousBodyOverflow = "";
  let previousHtmlOverflow = "";
  let locked = false;

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      "html." + LOCK_CLASS + ", body." + LOCK_CLASS + " { overflow: hidden !important; }",
      "#" + MODAL_ID + ", #" + MODAL_ID + " * { box-sizing: border-box; }",
      "#" + MODAL_ID + " { position: fixed; inset: 0; z-index: 70000; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(2,10,30,.9); backdrop-filter: blur(10px); font-family: Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }",
      "#" + MODAL_ID + " .tf-policy-box { width: min(100%,720px); max-height: calc(100dvh - 32px); overflow: auto; overscroll-behavior: contain; padding: 28px; border: 1px solid rgba(96,165,250,.38); border-radius: 22px; color: #dbeafe; background: linear-gradient(150deg,#071a3a,#0b244f); box-shadow: 0 32px 90px rgba(0,0,0,.58); }",
      "#" + MODAL_ID + " h2 { margin: 0 0 20px; color: #fff; font-size: clamp(22px,5vw,30px); line-height: 1.2; }",
      "#" + MODAL_ID + " h3 { margin: 26px 0 10px; color: #93c5fd; font-size: 16px; line-height: 1.35; letter-spacing: .04em; }",
      "#" + MODAL_ID + " p { margin: 0 0 16px; color: #dbeafe; font-size: 15px; line-height: 1.72; }",
      "#" + MODAL_ID + " .tf-policy-thanks { margin-top: 22px; }",
      "#" + MODAL_ID + " .tf-policy-status { min-height: 20px; margin: 14px 0 0; color: #fecaca; font-size: 13px; }",
      "#" + MODAL_ID + " .tf-policy-actions { display: flex; justify-content: stretch; margin-top: 22px; padding-top: 18px; border-top: 1px solid rgba(148,163,184,.22); }",
      "#" + MODAL_ID + " button { width: 100%; min-height: 50px; padding: 12px 18px; border: 1px solid rgba(147,197,253,.6); border-radius: 999px; color: #fff; background: linear-gradient(135deg,#1d4ed8,#2563eb); font: inherit; font-size: 15px; font-weight: 800; cursor: pointer; }",
      "#" + MODAL_ID + " button:disabled { cursor: wait; opacity: .68; }",
      "#" + MODAL_ID + " button:focus-visible { outline: 3px solid #bfdbfe; outline-offset: 3px; }",
      "@media (max-width:620px) { #" + MODAL_ID + " { align-items: stretch; padding: 10px; } #" + MODAL_ID + " .tf-policy-box { max-height: calc(100dvh - 20px); padding: 22px 18px; border-radius: 18px; } }",
      "@media (prefers-reduced-motion: reduce) { #" + MODAL_ID + " { backdrop-filter: none; } }",
      "@media print { #" + MODAL_ID + " { display: none !important; } }"
    ].join("\n");
    document.head.appendChild(style);
  }

  function paragraph(text, className) {
    const element = document.createElement("p");
    if (className) element.className = className;
    element.textContent = text;
    return element;
  }

  function heading(level, text) {
    const element = document.createElement(level);
    const strong = document.createElement("strong");
    strong.textContent = text;
    element.appendChild(strong);
    return element;
  }

  function lockBackground(modal) {
    if (locked) return;
    locked = true;
    previousBodyOverflow = document.body.style.overflow;
    previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.classList.add(LOCK_CLASS);
    document.documentElement.classList.add(LOCK_CLASS);

    inertSnapshot = Array.from(document.body.children)
      .filter(function (element) { return element !== modal; })
      .map(function (element) {
        const snapshot = { element: element, inert: element.inert === true };
        element.inert = true;
        return snapshot;
      });

    document.addEventListener("keydown", blockDismissKeys, true);
  }

  function unlockBackground() {
    if (!locked) return;
    locked = false;

    inertSnapshot.forEach(function (snapshot) {
      snapshot.element.inert = snapshot.inert;
    });
    inertSnapshot = [];

    document.body.classList.remove(LOCK_CLASS);
    document.documentElement.classList.remove(LOCK_CLASS);
    document.body.style.overflow = previousBodyOverflow;
    document.documentElement.style.overflow = previousHtmlOverflow;
    document.removeEventListener("keydown", blockDismissKeys, true);
  }

  function blockDismissKeys(event) {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return;

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    if (event.key === "Tab") {
      const button = modal.querySelector("button");
      if (button) {
        event.preventDefault();
        button.focus();
      }
    }
  }

  function buildModal(onAccept) {
    const modal = document.createElement("div");
    const box = document.createElement("section");
    const actions = document.createElement("div");
    const status = paragraph("", "tf-policy-status");
    const button = document.createElement("button");

    modal.id = MODAL_ID;
    modal.setAttribute("role", "alertdialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "tf-required-policy-title");
    modal.setAttribute("aria-describedby", "tf-required-policy-description");

    box.className = "tf-policy-box";
    box.setAttribute("tabindex", "-1");

    const title = heading("h2", "Atualização sobre cancelamento e reposição de aulas.");
    title.id = "tf-required-policy-title";
    box.appendChild(title);

    const description = paragraph(
      "No momento o teacher está com todas as turmas cheias e também está dando aula na Universidade Federal de Uberlândia."
    );
    description.id = "tf-required-policy-description";
    box.appendChild(description);
    box.appendChild(paragraph(
      "Diante disso, o teacher está com poucos horários disponíveis para reposição e tivemos que alterar regras sobre cancelamento de aulas e reposições."
    ));
    box.appendChild(paragraph("Novas regras:"));

    box.appendChild(heading("h3", "CENCELAMENTO DE UMA AULA"));
    box.appendChild(paragraph(
      "Os alunos têm direito de cancelar uma aula e marcar reposição. Mas para ter o direito à reposição é preciso cancelar com pelo menos 12 horas de antecedência, pois o professor precisa planejar para colocar outro aluno na vaga."
    ));
    box.appendChild(paragraph(
      "Caso não seja possível cancelar com 12 horas de antecedência, a aula será considerada como dada e não haverá reembolso do valor e nem direito à reposição. Mas o aluno vai poder assistir a versão gravada da aula."
    ));
    box.appendChild(paragraph(
      "Para assistir à aula gravada solicite aqui no whatsapp o link."
    ));

    box.appendChild(heading("h3", "REPOSIÇÃO"));
    box.appendChild(paragraph(
      "As reposições só podem ser feitas se o aluno cancelar uma aula com no mínimo 12 horas de antecedência."
    ));
    box.appendChild(paragraph(
      "Havendo cancelado a aula dentro desse período, o aluno acessa o site ou o aplicativo e visualiza os dias e horários disponíveis para reposição. Se não houver nenhum horário de reposição em que o aluno possa participar, o professor não se responsabiliza, já que o horário escolhido inicialmente estava reservado para o aluno."
    ));
    box.appendChild(paragraph("Portanto, evite cancelar aulas!"));
    box.appendChild(paragraph(
      "Para cancelar ou marcar uma reposição de aula basta clicar no botão MINHAS AULAS, no site ou no aplicativo."
    ));

    const thanks = document.createElement("p");
    thanks.className = "tf-policy-thanks";
    thanks.appendChild(document.createTextNode("Obrigado!"));
    thanks.appendChild(document.createElement("br"));
    thanks.appendChild(document.createTextNode("Teacher Flávio"));
    box.appendChild(thanks);

    button.type = "button";
    button.textContent = "estou de acordo";
    button.addEventListener("click", async function () {
      button.disabled = true;
      status.textContent = "";

      try {
        await onAccept();
      } catch (error) {
        status.textContent = error && error.message
          ? error.message
          : "Não foi possível registrar seu aceite. Tente novamente.";
        button.disabled = false;
      }
    });

    actions.className = "tf-policy-actions";
    actions.appendChild(button);
    box.appendChild(status);
    box.appendChild(actions);
    modal.appendChild(box);
    return modal;
  }

  function show(onAccept) {
    if (document.getElementById(MODAL_ID)) return;
    installStyles();

    const modal = buildModal(onAccept);
    document.body.appendChild(modal);
    lockBackground(modal);

    const button = modal.querySelector("button");
    if (button) button.focus();
  }

  function dismiss() {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return;
    unlockBackground();
    modal.remove();
  }

  window.StudentPolicyNoticeRenderer = Object.freeze({
    show: show,
    dismiss: dismiss
  });
})();
