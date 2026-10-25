"use strict";

const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const PREVIEW_PATH = "/roteiro-da-aula-v2/";
const IGNORED_RUNTIME_SCRIPTS = new Set([
  "/supabase_config.js",
  "/module_loader.js",
  "/auth.js",
  "/resource_waiter.js",
  "/conversation_question_card_renderer.js",
  "/academic_workflow_service.js",
  "/teacher_lesson_presentations.js"
]);
const MIME_TYPES = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".html": "text/html; charset=utf-8"
});

let server;
let baseUrl;

function serveStaticFixture(request, response) {
  const requestedPath = new URL(request.url, "http://localhost").pathname;
  if (requestedPath === "/login/" || requestedPath === "/acesso-negado/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<!doctype html><html lang='pt-BR'><title>Destino de autenticação</title><body>Destino de autenticação</body></html>");
    return;
  }

  if (IGNORED_RUNTIME_SCRIPTS.has(requestedPath)) {
    response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
    response.end("/* Stub only for isolated browser rehearsal. */");
    return;
  }

  const relativePath = requestedPath.endsWith("/")
    ? requestedPath.slice(1) + "index.html" : requestedPath.slice(1);
  const absolutePath = path.resolve(ROOT, relativePath);
  if (!absolutePath.startsWith(ROOT + path.sep)) {
    response.writeHead(403);
    response.end();
    return;
  }

  let content;
  try {
    content = fs.readFileSync(absolutePath);
  } catch {
    response.writeHead(404);
    response.end();
    return;
  }

  response.writeHead(200, {
    "Content-Type": MIME_TYPES[path.extname(absolutePath)] || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  response.end(content);
}

test.beforeAll(async () => {
  server = http.createServer(serveStaticFixture);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = "http://127.0.0.1:" + server.address().port;
});

test.afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function openPreview(page, role = "teacher") {
  await page.route("https://cdn.jsdelivr.net/**", (route) => {
    // Supabase SDK is replaced by an isolated fake before any page script runs.
    return route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: "/* No remote backend is used by browser homologation. */"
    });
  });

  await page.addInitScript(({ userRole }) => {
    const teacherId = "98000000-0000-4000-8000-000000000001";
    const studentId = "99000000-0000-4000-8000-000000000006";
    const questionId = "97000000-0000-4000-8000-000000000016";
    const entryId = "97000000-0000-4000-8000-000000000017";

    window.__teacherV2Calls = [];
    window.__teacherV2NetworkError = false;
    window.ResourceWaiter = {
      waitUntil: async (predicate) => Boolean(predicate())
    };

    const fakeClient = {
      async rpc(name) {
        window.__teacherV2Calls.push(name);
        if (name === "is_teacher_admin") {
          return { data: userRole === "teacher", error: null };
        }
        if (name === "get_teacher_question_rating_history_v2" ||
            name === "get_teacher_v2_closed_sessions") {
          return { data: [], error: null };
        }
        throw new Error("Unexpected write RPC in disabled preview: " + name);
      },
      from(tableName) {
        if (tableName !== "conversation_questions") {
          throw new Error("Unexpected table requested: " + tableName);
        }
        return {
          select() {
            return {
              async in() {
                return {
                  data: [{
                    id: questionId,
                    display_order: 2,
                    question_text: "How are you?",
                    question_translation: "Como você está?",
                    answer_examples: []
                  }],
                  error: null
                };
              }
            };
          }
        };
      }
    };

    window.Auth = {
      isConfigured: () => true,
      getSession: async () => userRole === "guest"
        ? null : { user: { id: teacherId, email: "teacher-v2-fixture@invalid.test" } },
      getClient: () => fakeClient
    };
    window.AcademicWorkflowService = {
      create: () => ({
        async getTeacherLessonPlan(date) {
          if (window.__teacherV2NetworkError) {
            throw new Error("Falha simulada ao obter o roteiro.");
          }
          if (date === "2026-01-01") return [];
          const lesson = {
            class_number: 970007,
            class_name: "TURMA FICTÍCIA",
            starts_at: date + "T18:00:00-03:00",
            lesson_kind: "regular",
            entry_id: entryId,
            student_id: studentId,
            student_name: "ALUNO FICTÍCIO",
            lesson_number: 1,
            lesson_status: "planned",
            attendance_status: "scheduled",
            today_questions: [{
              id: questionId,
              display_order: 1,
              text: "What is your name?",
              translation: "Qual é o seu nome?"
            }],
            review_questions: [],
            previously_studied_numbers: [2]
          };
          return [lesson, {
            ...lesson,
            student_id: "99000000-0000-4000-8000-000000000008",
            entry_id: "97000000-0000-4000-8000-000000000018",
            student_name: "ALUNO CANCELADO",
            attendance_status: "cancelled",
            lesson_status: "cancelled",
            today_questions: [],
            previously_studied_numbers: []
          }];
        }
      })
    };
    window.TeacherLessonPresentations = {
      rosterKey: () => null,
      loadPlan: async () => ({ records: new Map() })
    };
    window.ConversationQuestionCardRenderer = {
      create(question) {
        const item = document.createElement("div");
        item.className = "conversation-card";
        item.textContent = question.text || question.question_text || "";
        return item;
      }
    };
  }, { userRole: role });

  await page.goto(baseUrl + PREVIEW_PATH);
}

async function enterFictionalClass(page, subject) {
  await page.getByRole("button", { name: new RegExp(subject + " DO DIA") }).click();
  await page.getByRole("button", { name: /TURMA FICTÍCIA/ }).click();
}

test("teacher desktop navigates, searches questions, and leaves all writes disabled", async ({ page }) => {
  await openPreview(page);
  await expect(page.locator("#workspaceStatus")).toHaveAttribute("data-tone", "success");
  await enterFictionalClass(page, "APRESENTAÇÕES");
  await expect(page.getByRole("heading", { name: "ALUNO FICTÍCIO" })).toBeVisible();
  await expect(page.getByRole("button", { name: "REGISTRAR APRESENTAÇÃO" })).toBeDisabled();
  await expect(page.getByRole("heading", { name: "AULAS CANCELADAS" })).toBeVisible();

  await page.getByRole("button", { name: "INÍCIO" }).click();
  await enterFictionalClass(page, "PERGUNTAS");
  await expect(page.getByRole("button", { name: "BOM" }).first()).toBeDisabled();
  await page.getByText(/TODAS AS PERGUNTAS ESTUDADAS \(/).click();
  const search = page.getByRole("searchbox", { name: "Buscar entre todas as perguntas estudadas" });
  await search.fill("How are you?");
  await expect(page.locator(".workspace-question:not([hidden]) .conversation-card").filter({
    hasText: "How are you?"
  })).toHaveCount(1);

  const calls = await page.evaluate(() => window.__teacherV2Calls);
  expect(calls).toEqual(["is_teacher_admin",
    "get_teacher_question_rating_history_v2", "get_teacher_v2_closed_sessions"]);
  await expect(page.locator('a[href="/roteiro-da-aula/"]')).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
});

test("guest is sent to login without querying the protected teacher workflow", async ({ page }) => {
  await openPreview(page, "guest");
  await expect(page).toHaveURL(/\/login\/\?next=%2Froteiro-da-aula-v2%2F/);
  const calls = await page.evaluate(() => window.__teacherV2Calls);
  expect(calls).toEqual([]);
});

test("authenticated non-admin is denied access before loading class data", async ({ page }) => {
  await openPreview(page, "student");
  await expect(page).toHaveURL(/\/acesso-negado\/$/);
  const calls = await page.evaluate(() => window.__teacherV2Calls);
  expect(calls).toEqual(["is_teacher_admin"]);
});

test("mobile phone has no horizontal overflow and exposes the legacy fallback", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openPreview(page);
  await expect(page.locator("#workspaceStatus")).toHaveAttribute("data-tone", "success");
  await enterFictionalClass(page, "PERGUNTAS");

  const width = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth
  }));
  expect(width.content).toBeLessThanOrEqual(width.viewport + 1);
  await expect(page.getByRole("button", { name: "BOM" }).first()).toBeDisabled();

  const fallback = page.locator('a[href="/roteiro-da-aula/"]');
  await expect(fallback).toBeVisible();
  await fallback.click();
  await expect(page).toHaveURL(/\/roteiro-da-aula\/$/);
});

test("date changes and transient loading failures recover without enabling writes", async ({ page }) => {
  await openPreview(page);
  await expect(page.locator("#workspaceStatus")).toHaveAttribute("data-tone", "success");
  await page.locator("#workspaceDate").fill("2026-01-01");
  await expect(page.locator("#workspaceStatus")).toHaveAttribute("data-tone", "success");
  await page.getByRole("button", { name: /APRESENTAÇÕES DO DIA/ }).click();
  await expect(page.getByText("Nenhuma turma encontrada para a data selecionada.")).toBeVisible();

  await page.evaluate(() => { window.__teacherV2NetworkError = true; });
  await page.getByRole("button", { name: "ATUALIZAR" }).click();
  await expect(page.locator("#workspaceStatus")).toContainText("Falha simulada");
  await page.evaluate(() => { window.__teacherV2NetworkError = false; });
  await page.getByRole("button", { name: "ATUALIZAR" }).click();
  await expect(page.locator("#workspaceStatus")).toHaveAttribute("data-tone", "success");
  expect(await page.evaluate(() => window.__teacherV2Calls.some(
    (name) => /^(?:mark_|rate_|correct_)/.test(name)
  ))).toBe(false);
});
