const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const PAGE_ID = 'a1234567-1234-4234-8234-123456789abc';

const source = readFileSync('supabase/functions/lesson-example-audio/index.ts', 'utf8')
  .replace(/^import .*;\s*$/gm, '');

function fixture(options = {}) {
  const text = options.text || 'Hello, students.';
  const calls = { tts: 0, uploads: 0, signed: 0, query: null, folder: null };
  let handler;
  let cached = Boolean(options.cached);
  let limited = Boolean(options.limited);
  const storage = {
    getBucket: async () => ({ data: { id: 'lesson-example-audio' } }),
    from: () => ({
      list: async (folder) => (calls.folder = folder, { data: cached ? [{ name: `${options.audioHash}.mp3` }] : [], error: null }),
      upload: async () => { calls.uploads++; cached = true; return { error: null }; },
      createSignedUrl: async () => { calls.signed++; return { data: { signedUrl: 'https://example.test/audio' } }; }
    })
  };
  const user = {
    auth: { getUser: async () => options.unauthorized ? { error: {}, data: {} } : { data: { user: { id: 'user' } } } },
    from: () => ({ select: () => ({ eq: (field, value) => (calls.query = { field, value }, { maybeSingle: async () => ({ data: options.noAccess ? null : { id: PAGE_ID, roadmap_lesson_number: options.lessonNumber || 1, example: text }, error: null }) }) }) })
  };
  const admin = { storage, rpc: async () => ({ data: !limited, error: null }) };
  const env = { SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'public', SUPABASE_SERVICE_ROLE_KEY: 'secret', ELEVENLABS_API_KEY: 'private' };
  const ctx = {
    Deno: { env: { get: (name) => env[name] }, serve: (fn) => { handler = fn; } },
    createClient: (_url, token) => token === 'public' ? user : admin,
    fetch: async () => { calls.tts++; return options.providerError ? new Response('', { status: 500 }) : new Response('mp3'); },
    crypto: webcrypto, TextEncoder, Uint8Array, Array, Set, JSON, Object, console, Request, Response
  };
  vm.runInNewContext(stripTypeScriptTypes(source, { mode: 'strip' }), ctx);
  return { handler, calls, text };
}

async function hash(value) {
  const bytes = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Buffer.from(bytes).toString('hex');
}
async function request(handler, textHash, origin = 'https://teacherflavius.com', pageId = PAGE_ID) {
  return handler(new Request('https://example.test', { method: 'POST', headers: { origin, authorization: 'Bearer token', 'content-type': 'application/json' }, body: JSON.stringify({ textHash, pageId }) }));
}

test('generates only the authorized presentation and stores audio', async () => {
  const f = fixture();
  const response = await request(f.handler, await hash(f.text));
  assert.equal(response.status, 200);
  assert.equal(f.calls.tts, 1);
  assert.equal(f.calls.uploads, 1);
  assert.equal(f.calls.query.field, 'id');
  assert.equal(f.calls.query.value, PAGE_ID);
  assert.equal(f.calls.folder, 'presentation-1');
  assert.equal((await response.json()).url, 'https://example.test/audio');
});

test('uses the requested page and a separate storage folder', async () => {
  const f = fixture({ lessonNumber: 2 });
  const response = await request(f.handler, await hash(f.text));
  assert.equal(response.status, 200);
  assert.equal(f.calls.folder, `presentation-${PAGE_ID}`);
  assert.equal(f.calls.query.value, PAGE_ID);
});

test('supports older clients and rejects invalid page IDs', async () => {
  const f = fixture();
  const old = new Request('https://example.test', { method: 'POST', headers: { origin: 'https://teacherflavius.com', authorization: 'Bearer token', 'content-type': 'application/json' }, body: JSON.stringify({ textHash: await hash(f.text) }) });
  assert.equal((await f.handler(old)).status, 200);
  assert.equal(f.calls.query.field, 'roadmap_lesson_number');
  assert.equal(f.calls.query.value, 1);
  assert.equal((await request(f.handler, await hash(f.text), 'https://teacherflavius.com', 'invalid')).status, 400);
});

test('reuses cached audio without calling ElevenLabs', async () => {
  const text = 'Hello, students.';
  const audioHash = await hash(`hpp4J3VqNfWAUOO0d1Us:eleven_multilingual_v2:${text}`);
  const f = fixture({ cached: true, audioHash });
  const response = await request(f.handler, await hash(text));
  assert.equal(response.status, 200);
  assert.equal(f.calls.tts, 0);
});

test('rejects unauthenticated access and a changed text', async () => {
  const auth = fixture({ unauthorized: true });
  assert.equal((await request(auth.handler, 'x')).status, 401);
  const changed = fixture();
  assert.equal((await request(changed.handler, await hash('old text'))).status, 409);
  assert.equal(changed.calls.tts, 0);
});

test('does not generate when rate limited or access is denied', async () => {
  const limited = fixture({ limited: true });
  assert.equal((await request(limited.handler, await hash(limited.text))).status, 429);
  const denied = fixture({ noAccess: true });
  assert.equal((await request(denied.handler, await hash(denied.text))).status, 404);
  assert.equal(limited.calls.tts + denied.calls.tts, 0);
});

test('does not store provider failures and rejects foreign origins', async () => {
  const f = fixture({ providerError: true });
  assert.equal((await request(f.handler, await hash(f.text))).status, 502);
  assert.equal(f.calls.uploads, 0);
  assert.equal((await request(f.handler, 'x', 'https://bad.example')).status, 403);
});

test('player loads audio once and supports pause and speed', async () => {
  const app = readFileSync('licao.js', 'utf8');
  const snippet = app.slice(app.indexOf('  function setupExampleAudio(page)'), app.indexOf('  function renderDynamicPage(page)'));
  const elements = {};
  for (const id of ['lessonAudioControls', 'lessonAudioButton', 'lessonAudioSpeed', 'lessonAudio', 'lessonAudioStatus']) {
    elements[id] = { hidden: true, value: '1', textContent: '', listeners: {}, setAttribute(name, value) { this[name] = value; }, addEventListener(type, fn) { this.listeners[type] = fn; } };
  }
  const audio = elements.lessonAudio;
  audio.paused = true;
  audio.src = '';
  audio.play = async () => { audio.paused = false; audio.listeners.play(); };
  audio.pause = () => { audio.paused = true; audio.listeners.pause(); };
  audio.removeAttribute = () => { audio.src = ''; };
  let requests = 0;
  const ctx = { document: { getElementById: (id) => elements[id] }, window: { Auth: { getClient: () => ({ functions: { invoke: async (_name, params) => { requests++; assert.equal(params.body.textHash, await hash('Example')); assert.equal(params.body.pageId, PAGE_ID); return { data: { url: 'https://example.test/audio' } }; } } }) } }, crypto: webcrypto, TextEncoder, Uint8Array, Array, Number, Error };
  vm.runInNewContext(`${snippet}\nsetupExampleAudio({ id: '${PAGE_ID}', roadmap_lesson_number: 2, example: 'Example' });`, ctx);
  assert.equal(elements.lessonAudioControls.hidden, false);
  await elements.lessonAudioButton.listeners.click();
  assert.equal(elements.lessonAudioButton.textContent, 'PAUSAR ÁUDIO');
  assert.equal(elements.lessonAudioButton['aria-pressed'], 'true');
  await elements.lessonAudioButton.listeners.click();
  assert.equal(elements.lessonAudioButton.textContent, 'OUVIR EXEMPLO');
  assert.equal(elements.lessonAudioButton['aria-pressed'], 'false');
  elements.lessonAudioSpeed.value = '0.75';
  elements.lessonAudioSpeed.listeners.change();
  assert.equal(audio.playbackRate, 0.75);
  await elements.lessonAudioButton.listeners.click();
  assert.equal(requests, 1);
});

test('all presentation audio buttons match the green conversation theme', () => {
  const lessonCss = readFileSync('study_lesson_page.css', 'utf8');
  const conversationCss = readFileSync('conversation_question_cards.css', 'utf8');
  const lessonHtml = readFileSync('licao/index.html', 'utf8');
  const lessonJs = readFileSync('licao.js', 'utf8');

  const lessonButton = lessonCss.match(/\.lesson-audio-button\s*\{([^}]+)\}/)?.[1];
  const questionButton = conversationCss.match(/\.conversation-card-audio-button\s*\{([^}]+)\}/)?.[1];
  assert.ok(lessonButton, 'Presentation audio button style must exist');
  assert.ok(questionButton, 'Conversation audio button style must exist');
  for (const declaration of ['border: 1px solid #4ade80;', 'background: #15803d;', 'color: #fff;']) {
    assert.ok(lessonButton.includes(declaration), declaration);
    assert.ok(questionButton.includes(declaration), declaration);
  }

  const activeStyle = lessonCss.match(/\.lesson-audio-button:hover:not\(:disabled\),\s*\.lesson-audio-button\[aria-pressed="true"\]\s*\{([^}]+)\}/)?.[1];
  assert.ok(activeStyle, 'Hover and active playback must share the green state');
  assert.match(activeStyle, /border-color:\s*#86efac;/);
  assert.match(activeStyle, /background:\s*#16a34a;/);
  assert.match(lessonCss, /\.lesson-audio-button:focus-visible\s*\{\s*outline:\s*2px solid #86efac;/);

  assert.match(lessonHtml, /study_lesson_page\.css\?v=20261112-presentation-green-1/);
  assert.match(lessonHtml, /class="lesson-audio-button" id="lessonAudioButton"/);
  assert.match(lessonHtml, /class="lesson-audio-speed" id="lessonAudioSpeed"/);
  assert.match(lessonJs, /setupExampleAudio\(page\);/);
});
