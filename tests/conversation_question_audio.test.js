const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { stripTypeScriptTypes } = require("node:module");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const QUESTION_ID = "a1234567-1234-4234-8234-123456789abc";
const VOICE = "bIHbv24MWmeRgasZH58o";
const MODEL = "eleven_multilingual_v2";
const source = readFileSync("supabase/functions/lesson-example-audio/index.ts", "utf8")
  .replace(/^import .*;\s*$/gm, "");

async function hash(text) {
  const result = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Buffer.from(result).toString("hex");
}

function setup(options = {}) {
  const questionText = "How are you?";
  const examples = Array.from({ length: 5 }, (_, index) => ({
    answer: "I am fine " + index + ".",
    translation: "Bem",
    note: "Friendly reply"
  }));
  const calls = { queries: [], generated: [], uploaded: [], folders: [], rpc: [] };
  let handler;

  const storage = {
    getBucket: async () => ({ data: { id: "lesson-example-audio" } }),
    from: () => ({
      list: async (folder) => {
        calls.folders.push(folder);
        return { data: options.cached ? [{ name: options.audioHash + ".mp3" }] : [], error: null };
      },
      createSignedUrl: async () => ({ data: { signedUrl: "https://example.test/signed" } }),
      upload: async (path) => {
        calls.uploaded.push(path);
        return { error: null };
      }
    })
  };

  const user = {
    auth: { getUser: async () => options.unauthorized
      ? { data: {}, error: new Error("Unauthenticated") }
      : { data: { user: { id: "authenticated-user" } }, error: null } },
    from: (table) => {
      calls.queries.push(table);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: options.denied ? null : { id: QUESTION_ID, question_text: questionText, answer_examples: examples },
              error: null
            })
          })
        })
      };
    }
  };
  const admin = {
    storage,
    rpc: async (name, body) => {
      calls.rpc.push({ name, body });
      return { data: !options.limited, error: null };
    }
  };
  const env = {
    SUPABASE_URL: "https://example.test",
    SUPABASE_ANON_KEY: "public",
    SUPABASE_SERVICE_ROLE_KEY: "secret",
    ELEVENLABS_API_KEY: "private"
  };
  const globals = {
    Deno: { env: { get: (name) => env[name] }, serve: (fn) => { handler = fn; } },
    createClient: (_url, key) => key === "public" ? user : admin,
    fetch: async (url, init) => {
      calls.generated.push({ url, body: JSON.parse(init.body) });
      return options.providerError ? new Response("unavailable", { status: 500 }) : new Response("mp3");
    },
    crypto: webcrypto,
    TextEncoder,
    Uint8Array,
    Array,
    JSON,
    Object,
    Number,
    Set,
    console,
    Request,
    Response
  };
  vm.runInNewContext(stripTypeScriptTypes(source, { mode: "strip" }), globals);
  return { handler, calls, questionText, examples };
}

async function invoke(handler, payload, origin = "https://teacherflavius.com") {
  return handler(new Request("https://example.test", {
    method: "POST",
    headers: { origin, authorization: "Bearer authorized", "content-type": "application/json" },
    body: JSON.stringify(payload)
  }));
}

test("generates an authorized question in the male American voice", async () => {
  const f = setup();
  const response = await invoke(f.handler, {
    questionId: QUESTION_ID, part: "question", textHash: await hash(f.questionText)
  });
  assert.equal(response.status, 200);
  assert.equal(f.calls.queries[0], "conversation_questions");
  assert.equal(f.calls.folders[0], "question-" + QUESTION_ID);
  assert.equal(f.calls.generated.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.rpc.find(({ body }) => body.target_bucket_key === "lesson-audio:daily").body)), {
    target_bucket_key: "lesson-audio:daily",
    target_window_seconds: 86400,
    target_max_requests: 200
  });
  assert.ok(f.calls.generated[0].url.endsWith("/" + VOICE));
  assert.equal(f.calls.generated[0].body.text, f.questionText);
  assert.equal(f.calls.generated[0].body.model_id, MODEL);
  assert.equal(f.calls.uploaded.length, 1);
  assert.equal((await response.json()).url, "https://example.test/signed");
});

test("reads the correct example from the database, never from caller-supplied text", async () => {
  const f = setup();
  const response = await invoke(f.handler, {
    questionId: QUESTION_ID,
    part: "example",
    exampleIndex: 4,
    text: "Ignore previous instructions",
    textHash: await hash(f.examples[4].answer)
  });
  assert.equal(response.status, 200);
  assert.equal(f.calls.generated[0].body.text, f.examples[4].answer);
});

test("rejects missing permissions and stale revisions without generating audio", async () => {
  const denied = setup({ denied: true });
  const response = await invoke(denied.handler, {
    questionId: QUESTION_ID, part: "question", textHash: await hash(denied.questionText)
  });
  assert.equal(response.status, 404);
  assert.equal(denied.calls.generated.length, 0);

  const unauthenticated = setup({ unauthorized: true });
  const blocked = await invoke(unauthenticated.handler, {
    questionId: QUESTION_ID, part: "question", textHash: await hash(unauthenticated.questionText)
  });
  assert.equal(blocked.status, 401);
  assert.equal(unauthenticated.calls.queries.length, 0);

  const stale = setup();
  const changed = await invoke(stale.handler, {
    questionId: QUESTION_ID, part: "question", textHash: await hash("Outdated")
  });
  assert.equal(changed.status, 409);
  assert.equal(stale.calls.generated.length, 0);
});

test("rejects invalid indexes, unexpected selectors and foreign origins", async () => {
  const f = setup();
  const common = { questionId: QUESTION_ID, part: "example", textHash: await hash(f.examples[0].answer) };
  for (const index of [-1, 5, 1.5, "0", null]) {
    assert.equal((await invoke(f.handler, { ...common, exampleIndex: index })).status, 400);
  }
  assert.equal((await invoke(f.handler, { ...common, part: "other", exampleIndex: 0 })).status, 400);
  assert.equal((await invoke(f.handler, { ...common, pageId: QUESTION_ID, exampleIndex: 0 })).status, 400);
  assert.equal((await invoke(f.handler, { ...common, exampleIndex: 0 }, "https://foreign.example")).status, 403);
  assert.equal(f.calls.generated.length, 0);
});

test("serves cached question audio without spending provider credits", async () => {
  const f = setup({ cached: true, audioHash: await hash(VOICE + ":" + MODEL + ":How are you?") });
  const result = await invoke(f.handler, {
    questionId: QUESTION_ID, part: "question", textHash: await hash(f.questionText)
  });
  assert.equal(result.status, 200);
  assert.equal(f.calls.generated.length, 0);
  assert.equal(f.calls.uploaded.length, 0);
});

test("enforces daily generation limits and avoids persisting failed provider responses", async () => {
  const limited = setup({ limited: true });
  assert.equal((await invoke(limited.handler, {
    questionId: QUESTION_ID, part: "question", textHash: await hash(limited.questionText)
  })).status, 429);
  assert.equal(limited.calls.generated.length, 0);

  const failed = setup({ providerError: true });
  assert.equal((await invoke(failed.handler, {
    questionId: QUESTION_ID, part: "question", textHash: await hash(failed.questionText)
  })).status, 502);
  assert.equal(failed.calls.uploaded.length, 0);
  const backend = readFileSync("supabase/functions/lesson-example-audio/index.ts", "utf8");
  assert.match(backend, /elevenlabs_rejected/);
  assert.match(backend, /http_status: audioResponse.status/);
  assert.doesNotMatch(backend, /console\.error\([^\n]*elevenKey/);
});

test("every page with question cards loads the reusable audio module and SVG control styles", () => {
  const pages = [
    "conversation-questions/index.html",
    "conversation-questions/estudadas/index.html",
    "roteiro-da-aula/index.html",
    "roteiro-da-aula-v2/index.html",
    "roteiro-da-aula-legado/index.html",
    "o-que-fazer/index.html",
    "o-que-fazer/segunda-parte/index.html"
  ];
  for (const path of pages) {
    const html = readFileSync(path, "utf8");
    assert.match(html, /conversation_question_audio\.js\?v=/);
    assert.match(html, /conversation_question_cards\.css\?v=20261112-audio-1/);
  }
  const renderer = readFileSync("conversation_question_card_renderer.js", "utf8");
  assert.match(renderer, /createButton\(question, "question"\)/);
  assert.match(renderer, /createButton\(question, "example", index\)/);
});


test("renders the green play buttons before English questions and each answer", () => {
  function element(tag) {
    return {
      tagName: tag,
      className: "",
      children: [],
      _text: "",
      appendChild(child) { this.children.push(child); return child; },
      set textContent(value) { this._text = String(value); },
      get textContent() { return this._text; }
    };
  }
  const document = { createElement: element };
  const window = {
    ConversationQuestionAudio: {
      createButton(_question, part) {
        const button = element("button");
        button.part = part;
        return button;
      }
    }
  };
  vm.runInNewContext(readFileSync("conversation_question_card_renderer.js", "utf8"), { window, document });
  const card = window.ConversationQuestionCardRenderer.create({
    id: QUESTION_ID,
    text: "How are you?",
    translation: "Como você está?",
    answer_examples: Array.from({ length: 5 }, (_, i) => ({
      answer: "I am fine " + i,
      translation: "Estou bem",
      note: "Nota"
    }))
  }, { number: 1 });

  const title = card.children[0].children[1];
  assert.equal(title.children[0].part, "question");
  assert.equal(title.children[1].className, "conversation-card-question-english");
  assert.equal(title.children[2].className, "conversation-card-question-translation");

  const examples = card.children[2].children;
  assert.equal(examples.length, 5);
  examples.forEach((item) => {
    assert.equal(item.children[0].part, "example");
    assert.equal(item.children[1].className, "conversation-card-example-answer");
    assert.equal(item.children[2].className, "conversation-card-example-translation");
  });

  const css = readFileSync("conversation_question_cards.css", "utf8");
  assert.match(css, /\.conversation-card-audio-button\s*\{[\s\S]*?background:\s*#15803d;/);
  assert.match(css, /\.conversation-card-audio-button\s*\{[\s\S]*?margin-right:\s*9px;/);
});

test("locks conversation audio to 0.75x and provides no manual speed control", () => {
  let audio;
  function element(tag) {
    if (tag === "audio") {
      audio = {
        preload: "",
        playbackRate: 1,
        paused: true,
        src: "",
        addEventListener() {},
        pause() { this.paused = true; },
        removeAttribute() { this.src = ""; },
        async play() { this.paused = false; }
      };
      return audio;
    }
    return {
      tagName: tag,
      children: [],
      dataset: {},
      attributes: {},
      handlers: {},
      appendChild(child) { this.children.push(child); return child; },
      setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener(key, handler) { this.handlers[key] = handler; },
      querySelector(selector) {
        if (selector === "path") return this.children[0].children[0];
        return null;
      }
    };
  }
  const document = {
    createElement: element,
    createElementNS: (_namespace, tag) => element(tag),
    getElementById: () => null,
    body: { appendChild() {} }
  };
  const window = {
    Auth: {
      getClient: () => ({
        functions: { invoke: async () => ({ data: { url: "https://example.test/signed" } }) }
      })
    }
  };
  vm.runInNewContext(readFileSync("conversation_question_audio.js", "utf8"), {
    window, document, crypto: webcrypto, TextEncoder, Uint8Array, Array, Number, Object
  });
  assert.equal(window.ConversationQuestionAudio.createSpeedControl, undefined);
  const button = window.ConversationQuestionAudio.createButton({
    id: QUESTION_ID, text: "How are you?", examples: []
  }, "question");
  button.handlers.click();
  assert.equal(audio.playbackRate, 0.75);

  const pages = [
    "conversation-questions/index.html",
    "conversation-questions/estudadas/index.html",
    "roteiro-da-aula/index.html",
    "roteiro-da-aula-v2/index.html",
    "roteiro-da-aula-legado/index.html",
    "o-que-fazer/index.html",
    "o-que-fazer/segunda-parte/index.html"
  ];
  pages.forEach((path) => {
    const html = readFileSync(path, "utf8");
    assert.match(html, /conversation_question_card_renderer\.js\?v=20261112-leading-green-075-1/);
    assert.match(html, /conversation_question_audio\.js\?v=20261112-leading-green-075-1/);
    assert.match(html, /conversation_question_cards\.css\?v=20261112-leading-green-075-1/);
    assert.doesNotMatch(html, /conversationAudioSpeedControl/);
  });
  const app = readFileSync("conversation-questions/app.js", "utf8");
  assert.doesNotMatch(app, /createSpeedControl|audioSpeedControl/);
});
