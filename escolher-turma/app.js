(function () {
  "use strict";

  const STORAGE_KEY = "teacherflavius_class_seat_hold_v1";
  const REFRESH_INTERVAL_MS = 10000;
  const weekdays = Object.freeze({
    1: "Segunda-feira", 2: "Terça-feira", 3: "Quarta-feira",
    4: "Quinta-feira", 5: "Sexta-feira", 6: "Sábado", 7: "Domingo"
  });
  const elements = {
    message: document.getElementById("message"),
    reservationPanel: document.getElementById("reservationPanel"),
    vacancyPanel: document.getElementById("vacancyPanel"),
    formPanel: document.getElementById("formPanel"),
    classList: document.getElementById("classList"),
    summary: document.getElementById("summary"),
    leadForm: document.getElementById("leadForm"),
    formTitle: document.getElementById("formTitle"),
    chosenClass: document.getElementById("chosenClass"),
    reservedClass: document.getElementById("reservedClass"),
    countdown: document.getElementById("countdown"),
    submitLead: document.getElementById("submitLead"),
    refresh: document.getElementById("refresh")
  };
  let availableClasses = [];
  let selectedClass = null;
  let formMode = "reserve";
  let currentHold = null;
  let loading = false;

  function classDescription(row) {
    const parts = String(row.class_start_time || "").split(":");
    const hours = Number(parts[0]);
    const minutes = Number(parts[1]);
    const time = Number.isFinite(hours) && Number.isFinite(minutes)
      ? hours + "h" + (minutes ? String(minutes).padStart(2, "0") : "")
      : "Horário a confirmar";
    return (weekdays[row.class_weekday] || "Dia a confirmar") + " às " + time;
  }

  function setMessage(text, isError) {
    elements.message.textContent = text;
    elements.message.classList.toggle("error", Boolean(isError));
    elements.message.hidden = !text;
  }

  async function callRpc(name, payload) {
    const config = window.SUPABASE_CONFIG;
    if (!config || !config.url || !config.anonKey) {
      throw new Error("Não foi possível conectar ao serviço de matrículas.");
    }
    const response = await fetch(config.url + "/rest/v1/rpc/" + name, {
      method: "POST",
      cache: "no-store",
      headers: {
        apikey: config.anonKey,
        Authorization: "Bearer " + config.anonKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload || {})
    });
    const result = await response.json().catch(function () { return null; });
    if (!response.ok) throw new Error((result && result.message) || "Não foi possível concluir a solicitação.");
    return result;
  }

  function createClassCard(row) {
    const card = document.createElement("article");
    card.className = "class-card";
    const title = document.createElement("h3");
    title.textContent = classDescription(row);
    const subtitle = document.createElement("p");
    subtitle.className = "class-time";
    subtitle.textContent = "Turma " + row.class_number + " · 60 minutos";
    const spots = Number(row.available_spots) || 0;
    const counter = document.createElement("p");
    counter.className = "seats" + (spots === 0 ? " soldout" : spots === 1 ? " low" : "");
    counter.textContent = spots === 0 ? "Vagas esgotadas" :
      spots === 1 ? "Última vaga" : spots + " vagas disponíveis";
    const button = document.createElement("button");
    button.type = "button";
    button.className = spots > 0 ? "primary" : "secondary";
    button.textContent = spots > 0 ? "RESERVAR VAGA" : "ENTRAR NA LISTA DE ESPERA";
    button.addEventListener("click", function () {
      if (currentHold) {
        setMessage("Você já tem uma reserva. Libere-a antes de escolher outra turma.", true);
        return;
      }
      selectedClass = row;
      formMode = spots > 0 ? "reserve" : "waitlist";
      elements.formTitle.textContent = formMode === "reserve" ? "Reservar por 15 minutos" : "Entrar na lista de espera";
      elements.submitLead.textContent = formMode === "reserve"
        ? "RESERVAR POR 15 MINUTOS" : "CONFIRMAR LISTA DE ESPERA";
      elements.chosenClass.textContent = classDescription(row);
      elements.formPanel.hidden = false;
      elements.formPanel.scrollIntoView({ behavior: "smooth", block: "start" });
      setMessage("");
    });
    card.append(title, subtitle, counter, button);
    return card;
  }

  function renderVacancies(rows) {
    availableClasses = Array.isArray(rows) ? rows : [];
    elements.classList.replaceChildren();
    const available = availableClasses.filter(function (row) { return Number(row.available_spots) > 0; });
    const count = available.reduce(function (total, row) {
      return total + Number(row.available_spots || 0);
    }, 0);
    elements.summary.textContent = available.length + " turmas disponíveis · " + count +
      " vagas livres. Atualização automática a cada 10 segundos.";
    if (!availableClasses.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "Nenhuma turma disponível para consulta neste momento.";
      elements.classList.append(empty);
      return;
    }
    availableClasses.forEach(function (row) {
      elements.classList.append(createClassCard(row));
    });
  }

  async function refreshVacancies() {
    if (loading) return;
    loading = true;
    elements.refresh.disabled = true;
    try {
      renderVacancies(await callRpc("get_public_class_seat_availability"));
    } catch (error) {
      setMessage(error.message, true);
      elements.summary.textContent = "Não foi possível atualizar as vagas neste momento.";
    } finally {
      elements.refresh.disabled = false;
      loading = false;
    }
  }

  function saveHold(hold) {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(hold)); }
    catch (_error) { /* The current tab still tracks the hold. */ }
  }

  function clearHold() {
    currentHold = null;
    try { sessionStorage.removeItem(STORAGE_KEY); }
    catch (_error) { /* Storage may be disabled in private browsing. */ }
  }

  function showHold(hold) {
    currentHold = hold;
    elements.formPanel.hidden = true;
    elements.reservationPanel.hidden = false;
    elements.reservedClass.textContent = "Turma " + hold.class_number +
      (availableClasses.find(function (row) { return row.class_number === hold.class_number; })
        ? " · " + classDescription(availableClasses.find(function (row) {
          return row.class_number === hold.class_number;
        })) : "");
    elements.reservationPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    updateCountdown();
  }

  function updateCountdown() {
    if (!currentHold) return;
    const remaining = Math.max(0, new Date(currentHold.expires_at).getTime() - Date.now());
    const seconds = Math.ceil(remaining / 1000);
    const minutes = Math.floor(seconds / 60);
    elements.countdown.textContent = String(minutes).padStart(2, "0") + ":" +
      String(seconds % 60).padStart(2, "0");
    if (remaining === 0) {
      clearHold();
      elements.reservationPanel.hidden = true;
      setMessage("O prazo de 15 minutos terminou. Você pode consultar novamente as vagas.", true);
      refreshVacancies();
    }
  }

  async function refreshHoldStatus() {
    if (!currentHold) return;
    try {
      const result = await callRpc("get_public_class_seat_hold", { target_token: currentHold.token });
      if (result.status === "active") return;
      clearHold();
      elements.reservationPanel.hidden = true;
      setMessage(result.status === "claimed"
        ? "Sua vaga foi vinculada à matrícula pelo professor."
        : "A reserva não está mais ativa. Consulte novamente as vagas.", result.status !== "claimed");
      refreshVacancies();
    } catch (_error) {
      // A temporary network error must not discard a valid reservation.
    }
  }

  async function restoreHold() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
      if (!saved || !saved.token || !saved.expires_at) return;
      if (Date.parse(saved.expires_at) <= Date.now()) {
        clearHold();
        return;
      }
      const remote = await callRpc("get_public_class_seat_hold", { target_token: saved.token });
      if (remote.status === "active") showHold(saved);
      else clearHold();
    } catch (_error) {
      // A failed restore must not prevent public availability from loading.
    }
  }

  async function submitLead(event) {
    event.preventDefault();
    if (!selectedClass) return;
    const name = document.getElementById("studentName").value.trim();
    const whatsapp = document.getElementById("studentPhone").value.trim();
    if (!name || !whatsapp) return;

    elements.submitLead.disabled = true;
    setMessage("");
    try {
      if (formMode === "reserve") {
        const hold = await callRpc("create_public_class_seat_hold", {
          target_class_number: selectedClass.class_number,
          target_name: name,
          target_whatsapp: whatsapp
        });
        saveHold(hold);
        showHold(hold);
        setMessage("Reserva temporária registrada. Conclua a matrícula com o professor antes do prazo.");
      } else {
        await callRpc("join_public_class_seat_waitlist", {
          target_class_number: selectedClass.class_number,
          target_name: name,
          target_whatsapp: whatsapp
        });
        elements.formPanel.hidden = true;
        setMessage("Seu interesse foi registrado na lista de espera. O professor poderá entrar em contato quando houver vaga.");
      }
      elements.leadForm.reset();
      await refreshVacancies();
    } catch (error) {
      setMessage(error.message, true);
      await refreshVacancies();
    } finally {
      elements.submitLead.disabled = false;
    }
  }

  async function cancelHold() {
    if (!currentHold) return;
    const token = currentHold.token;
    document.getElementById("cancelHold").disabled = true;
    try {
      await callRpc("cancel_public_class_seat_hold", { target_token: token });
      clearHold();
      elements.reservationPanel.hidden = true;
      setMessage("A reserva foi liberada.");
      await refreshVacancies();
    } catch (error) {
      setMessage(error.message, true);
    } finally {
      document.getElementById("cancelHold").disabled = false;
    }
  }

  async function copyProof() {
    if (!currentHold) return;
    const message = "Reserva temporária Teacher Flávio\nTurma: " +
      currentHold.class_number + "\nCódigo: " + currentHold.reservation_id +
      "\nVálida até: " + new Date(currentHold.expires_at).toLocaleString("pt-BR") +
      "\nEncaminhar ao professor para concluir a matrícula.";
    try {
      await navigator.clipboard.writeText(message);
      setMessage("Comprovante copiado. Envie-o ao professor no WhatsApp.");
    } catch (_error) {
      setMessage("Não foi possível copiar. Informe o código: " + currentHold.reservation_id, true);
    }
  }

  elements.leadForm.addEventListener("submit", submitLead);
  elements.refresh.addEventListener("click", refreshVacancies);
  document.getElementById("closeForm").addEventListener("click", function () {
    elements.formPanel.hidden = true;
  });
  document.getElementById("copyProof").addEventListener("click", copyProof);
  document.getElementById("cancelHold").addEventListener("click", cancelHold);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) {
      refreshVacancies();
      refreshHoldStatus();
    }
  });
  refreshVacancies().then(restoreHold);
  setInterval(function () {
    updateCountdown();
    if (!document.hidden) {
      refreshVacancies();
      refreshHoldStatus();
    }
  }, REFRESH_INTERVAL_MS);
  setInterval(updateCountdown, 1000);
})();
