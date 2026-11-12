(function () {
  "use strict";

  const BUCKET_NAME = "listening-audios";
  const TRACK_COUNT = 90;
  const SIGNED_URL_TTL_SECONDS = 3600;
  const AUTH_MAX_ATTEMPTS = 40;
  const AUTH_RETRY_DELAY_MS = 150;
  const TRACK_PAGE_PATH = "/listening-tracks/";

  const state = {
    client: null,
    isTeacher: false,
    selectedTrack: 1,
    requestId: 0
  };

  function trackTitle(number) {
    return "Listening Track " + number;
  }

  function trackObjectPath(number) {
    return "Conversation Lesson " + number + ".mp3";
  }

  function trackLink(number) {
    return window.location.origin + TRACK_PAGE_PATH + "?track=" + number;
  }

  function validTrackNumber(value) {
    if (!/^\d+$/.test(String(value || ""))) return null;
    const number = Number(value);
    return Number.isInteger(number) && number >= 1 && number <= TRACK_COUNT ? number : null;
  }

  function element(id) {
    return document.getElementById(id);
  }

  function setPlayerStatus(message, isError) {
    const status = element("listeningPlayerStatus");
    status.textContent = message;
    status.dataset.state = isError ? "error" : "ready";
  }

  function setAuthStatus(message, isError) {
    const status = element("listeningAuthStatus");
    status.textContent = message;
    status.dataset.state = isError ? "error" : "loading";
  }

  async function waitForAuthentication() {
    return window.ResourceWaiter.waitUntil(
      function () {
        return !!(
          window.Auth &&
          window.SUPABASE_CONFIG &&
          window.Auth.isConfigured() &&
          typeof window.Auth.requireAuth === "function"
        );
      },
      { maxAttempts: AUTH_MAX_ATTEMPTS, delayMs: AUTH_RETRY_DELAY_MS }
    );
  }

  async function detectTeacherAccess() {
    try {
      const response = await state.client.rpc("is_teacher_admin");
      return !response.error && response.data === true;
    } catch (error) {
      console.warn("Não foi possível verificar a permissão do professor:", error);
      return false;
    }
  }

  function makeTrackButton(number) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "listening-track-button";
    button.textContent = trackTitle(number);
    button.dataset.track = String(number);
    button.addEventListener("click", function () {
      selectTrack(number, true);
    });
    return button;
  }

  function makeCopyButton(number) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "listening-copy-button";
    button.textContent = "COPIAR LINK";
    button.setAttribute("aria-label", "Copiar link de " + trackTitle(number));
    button.addEventListener("click", function () {
      copyTrackLink(number);
    });
    return button;
  }

  function renderTrackGrid() {
    const grid = element("listeningTrackGrid");
    const fragment = document.createDocumentFragment();

    for (let number = 1; number <= TRACK_COUNT; number += 1) {
      const item = document.createElement("div");
      item.className = "listening-track-item";
      item.dataset.track = String(number);
      item.appendChild(makeTrackButton(number));
      if (state.isTeacher) item.appendChild(makeCopyButton(number));
      fragment.appendChild(item);
    }

    grid.replaceChildren(fragment);
    updateSelectedTrack();
  }

  function updateSelectedTrack() {
    const buttons = document.querySelectorAll(".listening-track-button");
    buttons.forEach(function (button) {
      const isSelected = Number(button.dataset.track) === state.selectedTrack;
      button.setAttribute("aria-pressed", String(isSelected));
      button.parentElement.classList.toggle("is-selected", isSelected);
    });
  }

  function filterTrackGrid() {
    const query = element("listeningSearch").value.trim();
    let visibleCount = 0;

    document.querySelectorAll(".listening-track-item").forEach(function (item) {
      const matches = !query || String(item.dataset.track).includes(query);
      item.hidden = !matches;
      if (matches) visibleCount += 1;
    });

    element("listeningEmpty").hidden = visibleCount !== 0;
  }

  function setNavigationState() {
    element("listeningPrevious").disabled = state.selectedTrack === 1;
    element("listeningNext").disabled = state.selectedTrack === TRACK_COUNT;
    element("listeningPlayerTitle").textContent = trackTitle(state.selectedTrack);
  }

  async function loadTrackAudio(number) {
    const requestId = ++state.requestId;
    const audio = element("listeningAudio");
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    setPlayerStatus("Carregando " + trackTitle(number) + "...", false);

    try {
      const response = await state.client.storage
        .from(BUCKET_NAME)
        .createSignedUrl(trackObjectPath(number), SIGNED_URL_TTL_SECONDS);

      if (requestId !== state.requestId) return;
      if (response.error || !response.data || !response.data.signedUrl) {
        throw response.error || new Error("URL de reprodução indisponível.");
      }

      audio.src = response.data.signedUrl;
      audio.playbackRate = Number(element("listeningSpeed").value);
      audio.load();
      setPlayerStatus("Faixa pronta. Pressione reproduzir para ouvir.", false);
    } catch (error) {
      if (requestId !== state.requestId) return;
      console.warn("Falha ao carregar Listening Track:", error);
      setPlayerStatus("Não foi possível carregar este áudio. Verifique seu acesso e tente selecionar a faixa novamente.", true);
    }
  }

  function selectTrack(number, updateHistory) {
    const selected = validTrackNumber(number);
    if (selected === null) return;

    state.selectedTrack = selected;
    updateSelectedTrack();
    setNavigationState();

    if (updateHistory) {
      window.history.pushState({ track: selected }, "", TRACK_PAGE_PATH + "?track=" + selected);
    }

    loadTrackAudio(selected);
  }

  function fallbackCopy(text) {
    const input = document.createElement("textarea");
    input.value = text;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();

    try {
      return document.execCommand("copy");
    } finally {
      input.remove();
    }
  }

  async function copyTrackLink(number) {
    if (!state.isTeacher) return;
    const url = trackLink(number);

    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(url);
      } else if (!fallbackCopy(url)) {
        throw new Error("A cópia foi bloqueada.");
      }
      setPlayerStatus("Link de " + trackTitle(number) + " copiado.", false);
    } catch (error) {
      console.warn("Não foi possível copiar o link:", error);
      setPlayerStatus("Não foi possível copiar o link neste dispositivo.", true);
    }
  }

  function bindControls() {
    element("listeningPrevious").addEventListener("click", function () {
      selectTrack(state.selectedTrack - 1, true);
    });
    element("listeningNext").addEventListener("click", function () {
      selectTrack(state.selectedTrack + 1, true);
    });
    element("listeningCopySelected").addEventListener("click", function () {
      copyTrackLink(state.selectedTrack);
    });
    element("listeningSpeed").addEventListener("change", function () {
      element("listeningAudio").playbackRate = Number(this.value);
    });
    element("listeningSearch").addEventListener("input", filterTrackGrid);
    element("listeningAudio").addEventListener("error", function () {
      if (this.getAttribute("src")) {
        setPlayerStatus("O navegador não conseguiu reproduzir esta faixa. Selecione a faixa novamente para tentar de novo.", true);
      }
    });
    window.addEventListener("popstate", function () {
      const params = new URLSearchParams(window.location.search);
      selectTrack(validTrackNumber(params.get("track")) || 1, false);
    });
  }

  async function initialize() {
    try {
      const ready = await waitForAuthentication();
      if (!ready) throw new Error("Autenticação não carregada.");

      const user = await window.Auth.requireAuth();
      if (!user) return;

      state.client = window.Auth.getClient();
      if (!state.client) throw new Error("Cliente de áudio indisponível.");

      state.isTeacher = await detectTeacherAccess();
      element("listeningProfessorBack").hidden = !state.isTeacher;
      element("listeningCopySelected").hidden = !state.isTeacher;

      renderTrackGrid();
      bindControls();
      element("listeningApp").hidden = false;
      element("listeningAuthStatus").hidden = true;

      const params = new URLSearchParams(window.location.search);
      selectTrack(validTrackNumber(params.get("track")) || 1, false);
    } catch (error) {
      console.error("Falha ao iniciar Listening Tracks:", error);
      setAuthStatus("Não foi possível carregar os áudios. Atualize a página e tente novamente.", true);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
