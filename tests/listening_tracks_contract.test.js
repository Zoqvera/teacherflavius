const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");

const app = readFileSync("listening_tracks.js", "utf8");
const page = readFileSync("listening-tracks/index.html", "utf8");
const studentDashboard = readFileSync("area_do_estudante.html", "utf8");
const teacherDashboard = readFileSync("professor.html", "utf8");

function createElement(tagName = "div") {
  const attributes = {};
  const element = {
    tagName,
    children: [],
    listeners: {},
    style: {},
    dataset: {},
    hidden: false,
    value: "1",
    textContent: "",
    paused: true,
    classList: { toggle() {} },
    setAttribute(name, value) { attributes[name] = value; },
    getAttribute(name) { return attributes[name] || this[name] || null; },
    removeAttribute(name) { delete attributes[name]; delete this[name]; },
    appendChild(child) {
      if (child.tagName === "fragment") {
        child.children.forEach(item => this.appendChild(item));
      } else {
        this.children.push(child);
        child.parentElement = this;
      }
    },
    replaceChildren(fragment) {
      this.children = [];
      this.appendChild(fragment);
    },
    addEventListener(eventName, callback) { this.listeners[eventName] = callback; },
    pause() { this.paused = true; },
    load() {},
    remove() {}
  };
  return element;
}

async function mount(options = {}) {
  const elements = {};
  const ids = [
    "listeningPlayerStatus", "listeningAuthStatus", "listeningAudio",
    "listeningSpeed", "listeningTrackGrid", "listeningEmpty",
    "listeningPrevious", "listeningNext", "listeningPlayerTitle",
    "listeningSearch", "listeningCopySelected", "listeningProfessorBack",
    "listeningApp"
  ];
  ids.forEach(id => { elements[id] = createElement(); });
  const signCalls = [];
  const copies = [];
  const history = [];
  const user = options.user === false ? null : { id: "student-1" };
  const client = {
    rpc: async () => ({ data: Boolean(options.teacher), error: null }),
    storage: {
      from(name) {
        assert.equal(name, "listening-audios");
        return {
          async createSignedUrl(path, expiration) {
            signCalls.push({ path, expiration });
            return { data: { signedUrl: "https://storage.test/signed/" + path }, error: null };
          }
        };
      }
    }
  };
  const document = {
    readyState: "complete",
    body: { appendChild() {} },
    getElementById: id => elements[id],
    createElement,
    createDocumentFragment: () => createElement("fragment"),
    querySelectorAll(selector) {
      const rows = elements.listeningTrackGrid.children;
      if (selector === ".listening-track-button") return rows.map(row => row.children[0]);
      if (selector === ".listening-track-item") return rows;
      return [];
    }
  };
  const window = {
    location: {
      origin: "https://teacherflavius.com",
      search: options.search || "?track=19"
    },
    history: { pushState(_state, _title, url) { history.push(url); } },
    ResourceWaiter: { waitUntil: async () => true },
    SUPABASE_CONFIG: {},
    Auth: {
      isConfigured: () => true,
      requireAuth: async () => user,
      getClient: () => client
    },
    addEventListener() {}
  };
  const navigator = { clipboard: { writeText: async url => { copies.push(url); } } };
  vm.runInNewContext(app, { window, document, navigator, URLSearchParams, console });
  await new Promise(resolve => setImmediate(resolve));
  return { elements, signCalls, copies, history };
}

test("uses an unindexed private route linked from existing student and teacher areas", () => {
  assert.match(page, /name="robots" content="noindex,nofollow"/);
  assert.match(page, /src="\/listening_tracks.js\?/);
  assert.match(studentDashboard, /href="\/listening-tracks\//);
  assert.match(teacherDashboard, /data-card-id="listening-tracks"/);
  assert.doesNotMatch(page, /transcri[cç][aã]o/i);
});

test("loads the matching original audio in a signed URL and renders 90 renamed tracks", async () => {
  const result = await mount();
  const { elements, signCalls } = result;
  assert.equal(elements.listeningTrackGrid.children.length, 90);
  assert.equal(elements.listeningPlayerTitle.textContent, "Listening Track 19");
  assert.deepEqual(signCalls[0], { path: "Conversation Lesson 19.mp3", expiration: 3600 });
  assert.equal(elements.listeningTrackGrid.children[0].children[0].textContent, "Listening Track 1");
  assert.equal(elements.listeningTrackGrid.children[89].children[0].textContent, "Listening Track 90");
  assert.equal(elements.listeningTrackGrid.children[0].children.length, 1);
  assert.equal(elements.listeningCopySelected.hidden, true);
});

test("only confirmed teachers see copy links, and links point to exact players", async () => {
  const result = await mount({ teacher: true });
  const { elements, copies, history, signCalls } = result;
  assert.equal(elements.listeningTrackGrid.children[0].children.length, 2);
  assert.equal(elements.listeningCopySelected.hidden, false);
  await elements.listeningTrackGrid.children[24].children[1].listeners.click();
  assert.equal(copies[0], "https://teacherflavius.com/listening-tracks/?track=25");

  elements.listeningTrackGrid.children[89].children[0].listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(history[0], "/listening-tracks/?track=90");
  assert.equal(signCalls.at(-1).path, "Conversation Lesson 90.mp3");
});

test("does not initialize the player without an authorized session", async () => {
  const result = await mount({ user: false });
  assert.equal(result.signCalls.length, 0);
  assert.equal(result.elements.listeningApp.hidden, false === true);
});
