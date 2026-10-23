import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPublicCatalog,
  servePublicCatalog
} from "../supabase/functions/public-study-catalog/catalog_core.mjs";

const lesson = (number, title, objective = "") => ({
  roadmap_lesson_number: number,
  title,
  objective,
  example: "private example",
  translation: "private translation",
  created_by: "private user identifier"
});

test("sorts linked lessons and exposes only approved catalog fields", () => {
  const catalog = createPublicCatalog([
    lesson(41, "  Future lessons ", "  Speak  with  confidence  "),
    lesson(null, "Unlinked"),
    lesson(1, "Introducing yourself", " Introduce yourself "),
    lesson(41, "Duplicated lesson number"),
    lesson(2, "")
  ]);

  assert.deepEqual(catalog, {
    total: 2,
    lessons: [
      { number: 1, title: "Introducing yourself", objective: "Introduce yourself" },
      { number: 41, title: "Future lessons", objective: "Speak with confidence" }
    ]
  });
  assert.equal(JSON.stringify(catalog).includes("private"), false);
});

test("new lessons appear on the following request without manual catalog updates", async () => {
  const rows = [lesson(1, "First lesson")];
  const loadLessons = async () => rows;
  const request = new Request("https://example.test/", {
    headers: { Origin: "https://teacherflavius.com" }
  });

  const first = await servePublicCatalog(request, loadLessons);
  assert.equal((await first.json()).total, 1);
  assert.equal(first.headers.get("Access-Control-Allow-Origin"), "https://teacherflavius.com");
  assert.equal(first.headers.get("Cache-Control"), "no-store, max-age=0");

  rows.push(lesson(2, "Second lesson"));
  const second = await servePublicCatalog(request, loadLessons);
  assert.deepEqual((await second.json()).lessons.map(item => item.number), [1, 2]);
});

test("blocks cross-origin browser requests and unsupported methods", async () => {
  let reads = 0;
  const read = async () => { reads += 1; return []; };

  const blocked = await servePublicCatalog(new Request("https://example.test/", {
    headers: { Origin: "https://untrusted.example" }
  }), read);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.headers.get("Access-Control-Allow-Origin"), null);

  const posted = await servePublicCatalog(new Request("https://example.test/", {
    method: "POST"
  }), read);
  assert.equal(posted.status, 405);
  assert.equal(reads, 0);
});

test("serves preflight and HEAD without a response body", async () => {
  const origin = { Origin: "https://www.teacherflavius.com" };
  const preflight = await servePublicCatalog(new Request("https://example.test/", {
    method: "OPTIONS", headers: origin
  }), async () => []);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Methods"), "GET, HEAD, OPTIONS");

  const head = await servePublicCatalog(new Request("https://example.test/", {
    method: "HEAD", headers: origin
  }), async () => [lesson(1, "One")]);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});

test("does not disclose details of database errors", async () => {
  const response = await servePublicCatalog(new Request("https://example.test/"), async () => {
    throw new Error("sensitive database details");
  });

  assert.equal(response.status, 503);
  const error = await response.json();
  assert.equal(JSON.stringify(error).includes("sensitive"), false);
});
