(function () {
  "use strict";

  const MONTH_NAMES = Object.freeze([
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
  ]);
  const MIN_YEAR = 1900;
  const MAX_YEAR = 2199;
  const nodes = {
    status: document.getElementById("calendarStatus"),
    workspace: document.getElementById("calendarWorkspace"),
    yearInput: document.getElementById("yearInput"),
    count: document.getElementById("holidayCount"),
    monthTitle: document.getElementById("monthTitle"),
    monthGrid: document.getElementById("monthGrid"),
    monthDetails: document.getElementById("monthDetails"),
    holidayList: document.getElementById("holidayList")
  };

  const today = getBrazilianToday();
  const state = {
    year: today.year,
    monthIndex: today.month - 1,
    holidays: [],
    requestId: 0
  };

  function getBrazilianToday() {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(function (part) { return [part.type, Number(part.value)]; }));
    return { year: values.year, month: values.month, day: values.day };
  }

  function parseCalendarDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return { year: year, month: month, day: day, weekday: date.getUTCDay(), iso: value };
  }

  function formatWeekday(value) {
    const parsed = parseCalendarDate(value);
    if (!parsed) return "";
    const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day, 12));
    return new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "UTC" }).format(date);
  }

  function setStatus(message, isError) {
    nodes.status.textContent = message;
    nodes.status.classList.toggle("error", Boolean(isError));
    nodes.status.hidden = !message;
  }

  function createElement(tag, className, textValue) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (textValue !== undefined) element.textContent = textValue;
    return element;
  }

  function getMonthHolidays() {
    return state.holidays.filter(function (holiday) { return holiday.parsed.month === state.monthIndex + 1; });
  }

  function renderMonthDetails() {
    nodes.monthDetails.replaceChildren();
    const monthHolidays = getMonthHolidays();
    if (!monthHolidays.length) {
      nodes.monthDetails.textContent = "Este mês não tem feriados nacionais.";
      return;
    }
    monthHolidays.forEach(function (holiday) {
      const item = createElement("p");
      const title = createElement("strong", "", String(holiday.parsed.day).padStart(2, "0") + "/" + String(holiday.parsed.month).padStart(2, "0") + " — " + holiday.name);
      item.appendChild(title);
      nodes.monthDetails.appendChild(item);
    });
  }

  function renderMonth() {
    nodes.monthTitle.textContent = MONTH_NAMES[state.monthIndex] + " de " + state.year;
    nodes.monthGrid.replaceChildren();
    const firstWeekday = new Date(Date.UTC(state.year, state.monthIndex, 1)).getUTCDay();
    const startOffset = (firstWeekday + 6) % 7;
    const daysInMonth = new Date(Date.UTC(state.year, state.monthIndex + 1, 0)).getUTCDate();
    const cellCount = Math.ceil((startOffset + daysInMonth) / 7) * 7;
    const byDay = new Map(getMonthHolidays().map(function (holiday) { return [holiday.parsed.day, holiday]; }));

    for (let cell = 0; cell < cellCount; cell += 1) {
      const day = cell - startOffset + 1;
      if (day < 1 || day > daysInMonth) {
        const blank = createElement("span", "day empty");
        blank.setAttribute("aria-hidden", "true");
        nodes.monthGrid.appendChild(blank);
        continue;
      }
      const weekday = new Date(Date.UTC(state.year, state.monthIndex, day)).getUTCDay();
      const holiday = byDay.get(day);
      const isToday = state.year === today.year && state.monthIndex === today.month - 1 && day === today.day;
      const classes = ["day"];
      if (weekday === 0 || weekday === 6) classes.push("weekend");
      if (holiday) classes.push("holiday");
      if (isToday) classes.push("today");
      const dayCell = createElement("span", classes.join(" "), String(day));
      dayCell.setAttribute("role", "gridcell");
      dayCell.setAttribute("aria-label", (holiday ? holiday.name + ": " : "") + String(day) + " de " + MONTH_NAMES[state.monthIndex] + " de " + state.year + (holiday ? ", sem aula" : ""));
      if (holiday) dayCell.title = holiday.name + " — sem aula";
      nodes.monthGrid.appendChild(dayCell);
    }
    renderMonthDetails();
  }

  function renderHolidayList() {
    nodes.count.textContent = String(state.holidays.length);
    nodes.holidayList.replaceChildren();
    state.holidays.forEach(function (holiday) {
      const item = createElement("li");
      const tile = createElement("div", "date-tile");
      const number = createElement("span", "number", String(holiday.parsed.day).padStart(2, "0"));
      const month = createElement("span", "month", MONTH_NAMES[holiday.parsed.month - 1].slice(0, 3).toUpperCase());
      const info = createElement("div", "holiday-info");
      const title = createElement("strong", "", holiday.name);
      const weekday = createElement("span", "", formatWeekday(holiday.parsed.iso));
      tile.append(number, month);
      info.append(title, weekday);
      item.append(tile, info);
      nodes.holidayList.appendChild(item);
    });
  }

  function validateHolidays(rows, targetYear) {
    if (!Array.isArray(rows)) throw new Error("A resposta do calendário é inválida.");
    const holidays = rows.map(function (row) {
      const parsed = parseCalendarDate(row && row.holiday_date);
      const name = String((row && row.holiday_name) || "").trim();
      if (!parsed || parsed.year !== targetYear || !name) {
        throw new Error("O calendário retornou uma data inválida.");
      }
      return { parsed: parsed, name: name };
    });
    holidays.sort(function (a, b) { return a.parsed.iso.localeCompare(b.parsed.iso); });
    return holidays;
  }

  async function loadYear(nextYear) {
    if (!Number.isInteger(nextYear) || nextYear < MIN_YEAR || nextYear > MAX_YEAR) {
      nodes.yearInput.value = String(state.year);
      setStatus("Informe um ano entre " + MIN_YEAR + " e " + MAX_YEAR + ".", true);
      return;
    }
    const requestId = ++state.requestId;
    setStatus("Consultando feriados nacionais de " + nextYear + "...");
    try {
      const client = window.Auth && window.Auth.getClient();
      if (!client) throw new Error("Conexão com o calendário indisponível.");
      const response = await client.rpc("get_national_holidays", { target_year: nextYear });
      if (response.error) throw response.error;
      if (requestId !== state.requestId) return;
      state.holidays = validateHolidays(response.data, nextYear);
      state.year = nextYear;
      nodes.yearInput.value = String(nextYear);
      renderHolidayList();
      renderMonth();
      setStatus("");
    } catch (error) {
      if (requestId !== state.requestId) return;
      nodes.yearInput.value = String(state.year);
      setStatus("Não foi possível consultar os feriados. Atualize a página ou tente novamente.", true);
      console.error("Falha ao consultar feriados nacionais:", error);
    }
  }

  function changeMonth(delta) {
    const next = new Date(Date.UTC(state.year, state.monthIndex + delta, 1));
    const year = next.getUTCFullYear();
    const month = next.getUTCMonth();
    if (year < MIN_YEAR || year > MAX_YEAR) return;
    state.monthIndex = month;
    if (year === state.year) {
      renderMonth();
      return;
    }
    loadYear(year);
  }

  function bindControls() {
    document.getElementById("previousYear").addEventListener("click", function () { loadYear(state.year - 1); });
    document.getElementById("nextYear").addEventListener("click", function () { loadYear(state.year + 1); });
    document.getElementById("previousMonth").addEventListener("click", function () { changeMonth(-1); });
    document.getElementById("nextMonth").addEventListener("click", function () { changeMonth(1); });
    nodes.yearInput.addEventListener("change", function () { loadYear(Number(nodes.yearInput.value)); });
  }

  async function initialize() {
    bindControls();
    nodes.yearInput.value = String(state.year);
    if (!window.Auth || !window.Auth.isConfigured()) {
      setStatus("Autenticação indisponível. Volte à Área do Professor.", true);
      return;
    }
    try {
      const session = await window.Auth.getVerifiedSession();
      if (!session || !session.user) {
        setStatus("Faça login na Área do Professor para visualizar este calendário.", true);
        return;
      }
      if (!(await window.Auth.isTeacherAdmin())) {
        setStatus("Acesso restrito ao professor.", true);
        return;
      }
      nodes.workspace.hidden = false;
      await loadYear(state.year);
    } catch (error) {
      setStatus("Não foi possível validar sua sessão. Entre novamente na Área do Professor.", true);
      console.error("Falha na autenticação do calendário letivo:", error);
    }
  }

  initialize();
})();
