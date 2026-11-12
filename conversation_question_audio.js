(function () {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const FUNCTION_NAME = "lesson-example-audio";
  const PLAY_PATH = "M8 5v14l11-7z";
  const PAUSE_PATH = "M7 5h3v14H7zM14 5h3v14h-3z";
  const SPEEDS = [0.5, 0.75, 1, 1.25];
  let current = null;
  let player = null;
  let playbackSpeed = 0.75;
  let requestSequence = 0;

  function labelFor(part, index) {
    return part === "question" ? "Ouvir pergunta" : "Ouvir exemplo " + (index + 1);
  }

  function setButtonState(button, state) {
    button.dataset.audioState = state;
    button.disabled = state === "loading";
    button.setAttribute("aria-pressed", state === "playing" ? "true" : "false");
    const description = button.dataset.audioLabel;
    button.setAttribute("aria-label", state === "loading" ? "Carregando " + description.toLowerCase() : (
      state === "playing" ? "Pausar áudio" : description
    ));
    button.querySelector("path").setAttribute("d", state === "playing" ? PAUSE_PATH : PLAY_PATH);
  }

  function reportError(message) {
    let status = document.getElementById("conversationAudioStatus");
    if (!status) {
      status = document.createElement("p");
      status.id = "conversationAudioStatus";
      status.className = "conversation-audio-status";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      document.body.appendChild(status);
    }
    status.textContent = message;
    status.hidden = !message;
  }

  function ensurePlayer() {
    if (player) return player;
    player = document.createElement("audio");
    player.preload = "none";
    player.playbackRate = playbackSpeed;
    player.addEventListener("play", function () {
      if (current) setButtonState(current.button, "playing");
    });
    player.addEventListener("pause", function () {
      if (current) setButtonState(current.button, "ready");
    });
    player.addEventListener("ended", function () {
      if (current) setButtonState(current.button, "ready");
    });
    return player;
  }

  async function textHash(text) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(bytes), function (byte) {
      return byte.toString(16).padStart(2, "0");
    }).join("");
  }

  async function fetchAudioUrl(segment) {
    const hash = await textHash(segment.text);
    const body = {
      questionId: segment.questionId,
      part: segment.part,
      textHash: hash
    };
    if (segment.part === "example") body.exampleIndex = segment.index;
    const client = window.Auth && window.Auth.getClient && window.Auth.getClient();
    if (!client) throw new Error("Sessão indisponível.");
    const result = await client.functions.invoke(FUNCTION_NAME, { body: body });
    if (result.error) {
      const response = result.error.context;
      const payload = response && typeof response.json === "function"
        ? await response.json().catch(() => null)
        : null;
      throw new Error(payload && typeof payload.error === "string"
        ? payload.error
        : "Não foi possível preparar o áudio.");
    }
    if (!result.data || !result.data.url) {
      throw new Error("A resposta do serviço não contém um áudio válido.");
    }
    return result.data.url;
  }

  async function startPlayback(button, segment) {
    const audio = ensurePlayer();

    if (current && current.button === button && !audio.paused) {
      audio.pause();
      return;
    }
    if (current && current.button === button && audio.src && !button.disabled) {
      try {
        await audio.play();
      } catch {
        reportError("A reprodução foi bloqueada pelo navegador.");
      }
      return;
    }

    requestSequence += 1;
    const sequence = requestSequence;
    if (current) setButtonState(current.button, "ready");
    audio.pause();
    audio.removeAttribute("src");
    current = { button: button, sequence: sequence };
    setButtonState(button, "loading");
    reportError("");

    try {
      const url = await fetchAudioUrl(segment);
      if (!current || current.sequence !== sequence) return;
      audio.src = url;
      audio.playbackRate = playbackSpeed;
      await audio.play();
    } catch (error) {
      if (current && current.sequence === sequence) {
        setButtonState(button, "ready");
        const message = error instanceof Error && error.message
          ? error.message : "Áudio indisponível no momento. Tente novamente.";
        reportError(message);
      }
    }
  }

  function createButton(question, part, index) {
    const text = part === "question"
      ? question.text
      : question.examples[index] && question.examples[index].answer;
    if (!question.id || typeof text !== "string" || !text.trim()) return null;
    if (part !== "question" && (part !== "example" || !Number.isInteger(index) || index < 0 || index > 4)) return null;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "conversation-card-audio-button";
    button.dataset.audioLabel = labelFor(part, index);
    button.title = button.dataset.audioLabel;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(NS, "path");
    svg.appendChild(path);
    button.appendChild(svg);
    setButtonState(button, "ready");
    const segment = { questionId: question.id, part: part, index: index, text: text.trim() };
    button.addEventListener("click", function () {
      void startPlayback(button, segment);
    });
    return button;
  }

  function stop() {
    requestSequence += 1;
    if (current) setButtonState(current.button, "ready");
    current = null;
    if (player) {
      player.pause();
      player.removeAttribute("src");
    }
  }

  window.ConversationQuestionAudio = Object.freeze({
    createButton: createButton,
    stop: stop
  });
})();
