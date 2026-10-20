#!/usr/bin/env python3
"""Real-Chromium smoke tests for the gated two-part student preparation flow.

All students and backend responses are synthetic. Production remains unmodified.
"""

from __future__ import annotations

import functools
import http.server
import re
import shutil
import subprocess
import sys
import tempfile
import threading
from pathlib import Path
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "_student_preparation_visual_artifacts"
SCENARIOS = (
    ("legacy", 390, 844),
    ("welcome", 320, 740),
    ("welcome", 390, 844),
    ("welcome", 1280, 900),
    ("unpublished", 390, 844),
    ("second", 320, 740),
    ("second", 390, 844),
    ("second-dialog", 320, 740),
    ("second-dialog", 390, 844),
    ("second-stable", 390, 844),
    ("second-dialog", 1280, 900),
    ("second", 1280, 900),
    ("lesson", 320, 740),
    ("lesson", 390, 844),
    ("lesson", 1280, 900),
    ("lesson-disabled", 390, 844),
    ("roadmap", 320, 740),
    ("roadmap", 390, 844),
    ("roadmap", 1280, 900),
    ("roadmap-past", 390, 844),
    ("roadmap-last", 390, 844),
    ("roadmap-disabled", 390, 844),
)

BOOTSTRAP = r"""
(function () {
  "use strict";
  const scenario = new URLSearchParams(location.search).get("scenario") || "legacy";
  const enabled = !["legacy", "lesson-disabled", "roadmap-disabled"].includes(scenario);
  window.StudentPreparationFlow = { enabled };
  window.SUPABASE_CONFIG = {};
  window.ResourceWaiter = { waitUntil: async () => true };
  window.Auth = {
    isConfigured: () => true,
    getSession: async () => ({ user: { id: "synthetic-student" } }),
    getClient: () => ({})
  };
  const plan = {
    lesson: { number: 7, prepared: false, has_material: scenario !== "unpublished" },
    questions: [
      {
        id: "pending", display_order: 2, text: "Where are you from?", translation: "De onde você é?",
        examples: [{ answer: "I study English.", translation: "Eu estudo inglês." }],
        marked_studied: false, studied: false, worked: false
      },
      {
        id: "already", display_order: 1, text: "How are you?",
        marked_studied: true, studied: true, worked: false
      }
    ]
  };
  if (scenario === "roadmap-past" || scenario === "roadmap-last") {
    plan.lesson.number = 8;
  }
  if (scenario === "second-stable") {
    plan.questions.push({
      id: "later", display_order: 12, text: "Do you have any brothers or sisters?",
      marked_studied: false, studied: false, worked: false, examples: []
    });
  }
  const reviews = [
    { id: "due-1", display_order: 20, text: "Where are you from?", examples: [], marked_studied: true },
    { id: "due-2", display_order: 4, text: "Do you work?", examples: [], marked_studied: true }
  ];
  const calls = { studied: [], prepared: [] };
  window.__qa = { scenario, plan, calls };
  const academic = {
    getMyActionPlan: async () => plan,
    getMyReviewQuestions: async () => reviews,
    async markQuestionStudied(id) {
      calls.studied.push(id);
      const item = plan.questions.find(question => question.id === id);
      if (item) item.marked_studied = true;
    },
    async markLessonPrepared(number) { calls.prepared.push(number); }
  };
  window.AcademicWorkflowService = {
    create: () => academic,
    lessonUrl: number => "/licao/?lesson=" + number,
    normalizeLessonNumber: value => Number(value) || null,
    legacyLessonPreviewUrl: () => ""
  };
  window.StudyLessonService = {
    lessonPageUrl: id => "/licao/?id=" + id,
    create: () => ({
      getLinkedPageByLessonNumber: async number => number === 8
        ? (scenario === "roadmap-last" ? null : { id: "22222222-2222-4222-8222-222222222222" })
        : ({
        lesson_number_label: "LIÇÃO 7",
        title: "Presentation practice",
        objective: "Introduce yourself clearly",
        example: "My name is Ana and I work as a teacher.",
        translation: "Meu nome é Ana e trabalho como professora.",
        practical_exercise: "Introduce yourself in three sentences.",
        useful_vocabulary: "name, work, live, learn"
      })
    })
  };
})();
"""

VERIFIER = r"""
(function () {
  "use strict";
  function visible(id) {
    const node = document.getElementById(id);
    return !!node && !node.hidden && getComputedStyle(node).display !== "none" &&
      node.getClientRects().length > 0;
  }
  function result(ok, details) {
    document.body.dataset.qaResult = ok ? "PASS" : "FAIL";
    document.body.dataset.qaDetail = details;
  }
  setTimeout(async function () {
    const { scenario, calls } = window.__qa;
    const widthIsSafe = document.documentElement.scrollWidth <= innerWidth + 2;
    let ok = widthIsSafe;
    let detail = "viewport=" + innerWidth + ", document=" + document.documentElement.scrollWidth;
    if (scenario.startsWith("lesson") || scenario.startsWith("roadmap")) {
      const link = document.querySelector(".lesson-all-lessons-button");
      const status = document.getElementById("lessonPageStatus");
      const divider = document.querySelector(".lesson-page-container > .divider");
      const rect = link && link.getBoundingClientRect();
      const offsetX = rect && Math.abs(rect.left + rect.width / 2 - innerWidth / 2);
      ok = ok && !!link && !!status && !!divider &&
        link.getAttribute("href") === "/roteiro-de-estudos/" &&
        !!rect && rect.width > 0 && rect.height >= 44 &&
        offsetX <= 3 &&
        status.getBoundingClientRect().bottom <= rect.top &&
        rect.bottom <= divider.getBoundingClientRect().top;
      detail += ", allLessonsCenteredOffset=" + (offsetX === null ? "missing" : offsetX.toFixed(1));
    }
    if (scenario === "legacy") {
      ok = ok && !visible("studentPreparationWelcome") &&
        visible("legacyActionPlan") &&
        document.querySelectorAll("#reviewQuestionList .conversation-card").length === 2 &&
        document.querySelectorAll("#actionQuestionList .conversation-card").length === 1;
    } else if (scenario === "welcome") {
      ok = ok && visible("studentPreparationWelcome") && !visible("legacyActionPlan") &&
        !document.getElementById("startPreparationButton").disabled &&
        !visible("startConversationFallback");
    } else if (scenario === "unpublished") {
      ok = ok && visible("studentPreparationWelcome") &&
        document.getElementById("startPreparationButton").disabled &&
        visible("startConversationFallback");
    } else if (scenario === "second" || scenario === "second-dialog" ||
               scenario === "second-stable") {
      const pendingCount = scenario === "second-stable" ? "2" : "1";
      const remainingCount = scenario === "second-stable" ? "1" : "0";
      const numbers = () => Array.from(
        document.querySelectorAll("#actionQuestionList .conversation-card-number")
      ).map(node => node.textContent.trim());
      const studiedButton = document.querySelector(
        "#actionQuestionList .academic-question-study-actions button:not(:disabled)"
      );
      ok = ok && !!studiedButton &&
        document.getElementById("reviewQuestionsCount").textContent === "2" &&
        document.getElementById("questionsCount").textContent === pendingCount &&
        document.getElementById("returnToLessonLink").getAttribute("href") === "/licao/?lesson=7" &&
        JSON.stringify(numbers()) === JSON.stringify(
          scenario === "second-stable" ? ["2.", "12."] : ["2."]
        );
      if (studiedButton) studiedButton.click();
      await new Promise(resolve => setTimeout(resolve, 120));
      ok = ok && calls.studied.length === 1 &&
        document.getElementById("questionsCount").textContent === remainingCount &&
        JSON.stringify(numbers()) === JSON.stringify(
          scenario === "second-stable" ? ["12."] : []
        ) &&
        Array.from(document.querySelectorAll("#reviewQuestionList .conversation-card-number"))
          .map(node => node.textContent.trim()).join(",") === "20.,4." &&
        document.querySelectorAll("#reviewQuestionList .conversation-card").length === 2;
      const dialog = document.getElementById("questionStudiedDialog");
      ok = ok && !!dialog && dialog.open &&
        document.getElementById("questionStudiedDialogTitle").textContent === "Great job!" &&
        document.getElementById("studyAnotherQuestionButton").textContent.trim() ===
          "ESTUDAR MAIS UMA PERGUNTA" &&
        document.getElementById("finishQuestionStudyLink").getAttribute("href") ===
          "/area-do-estudante/";
      if (dialog && dialog.open) {
        const rect = dialog.getBoundingClientRect();
        const offsetX = Math.abs(rect.left + rect.width / 2 - innerWidth / 2);
        const offsetY = Math.abs(rect.top + rect.height / 2 - innerHeight / 2);
        ok = ok && offsetX <= 3 && offsetY <= 3;
        detail += ", dialogOffsets=" + offsetX.toFixed(1) + "/" + offsetY.toFixed(1);
      }
      if (scenario === "second") {
        document.getElementById("studyAnotherQuestionButton").click();
        ok = ok && !dialog.open;
      }
    } else if (scenario === "lesson") {
      ok = ok && visible("lessonFlowProgress") &&
        visible("lessonNextPartLink") &&
        visible("lessonPreparationSection") &&
        !visible("lessonPreparedButton") && !visible("lessonNextLessonLink") &&
        document.getElementById("lessonNextPartLink").getAttribute("href") ===
        "/o-que-fazer/segunda-parte/" &&
        calls.prepared.length === 0;
    } else if (scenario === "lesson-disabled") {
      ok = ok && !visible("lessonFlowProgress") &&
        !visible("lessonNextPartLink") &&
        visible("lessonPreparationSection") && visible("lessonPreparedButton");
    } else if (scenario === "roadmap") {
      ok = ok && visible("lessonFlowProgress") &&
        !visible("lessonPreparedButton") && visible("lessonNextPartLink") &&
        !visible("lessonNextLessonLink") &&
        document.getElementById("lessonNextPartLink").getAttribute("href") ===
          "/o-que-fazer/segunda-parte/";
    } else if (scenario === "roadmap-past") {
      ok = ok && !visible("lessonFlowProgress") &&
        !visible("lessonPreparedButton") && !visible("lessonNextPartLink") &&
        visible("lessonNextLessonLink") &&
        document.getElementById("lessonNextLessonLink").getAttribute("href") ===
          "/licao/?id=22222222-2222-4222-8222-222222222222&source=roteiro-de-estudos";
    } else if (scenario === "roadmap-last") {
      ok = ok && !visible("lessonPreparedButton") && !visible("lessonNextPartLink") &&
        !visible("lessonNextLessonLink") && visible("lessonRoadmapNavigation") &&
        /Não há uma próxima lição/.test(document.getElementById("lessonRoadmapStatus").textContent);
    } else if (scenario === "roadmap-disabled") {
      ok = ok && visible("lessonPreparedButton") && !visible("lessonNextPartLink") &&
        !visible("lessonNextLessonLink");
    }
    result(ok, detail + ", scenario=" + scenario);
  }, 240);
})();
"""


def locate_browser() -> str:
    for candidate in ("google-chrome-stable", "google-chrome", "chromium", "chromium-browser"):
        executable = shutil.which(candidate)
        if executable:
            return executable
    raise RuntimeError("Chrome/Chromium is not available on the CI runner.")


def copy_fixture_files(root: Path) -> None:
    assets = (
        "aula_template.css",
        "academic_workflow.css",
        "conversation_question_cards.css",
        "student_preparation_flow.css",
        "study_lesson_page.css",
        "brand_palette.css",
        "o-que-fazer/app.js",
        "licao.js",
        "conversation_question_card_renderer.js",
    )
    for name in assets:
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, target)

    specs = (
        ("o-que-fazer/index.html", "/o-que-fazer/app.js"),
        ("o-que-fazer/segunda-parte/index.html", "/o-que-fazer/app.js"),
        ("licao/index.html", "/licao.js"),
    )
    for page_name, controller in specs:
        html = (ROOT / page_name).read_text(encoding="utf-8")
        match = re.search(r'<main\b[^>]*>[\s\S]*?</main>', html)
        if match is None:
            raise RuntimeError(f"Could not locate the production main element: {page_name}")
        main_markup = match.group(0)
        dialog_markup = "".join(re.findall(r'<dialog\b[^>]*>[\s\S]*?</dialog>', html))
        is_lesson = page_name.startswith("licao/")
        if is_lesson:
            header = re.search(r'<header class="header">[\s\S]*?</header>', html)
            if header is None:
                raise RuntimeError(f"Missing shared lesson header: {page_name}")
            main_markup = (
                '<div class="container lesson-page-container">'
                + header.group(0) + '<div class="divider"></div>'
                + main_markup + '</div>'
            )
        files = [
            "aula_template.css",
            "academic_workflow.css",
            "student_preparation_flow.css",
        ]
        if is_lesson:
            files += ["study_lesson_page.css"]
        else:
            files += ["conversation_question_cards.css"]
        css_links = "".join(f'<link rel="stylesheet" href="/{filename}">' for filename in files)
        scripts = (
            '<script>' + BOOTSTRAP + '</script>' +
            ('' if is_lesson else '<script src="/conversation_question_card_renderer.js"></script>') +
            f'<script src="{controller}"></script>' +
            '<script>' + VERIFIER + '</script>'
        )
        page = (
            '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">' +
            css_links + '</head><body class="auth-checking">' +
            main_markup + dialog_markup + scripts +
            '</body></html>'
        )
        target = root / page_name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(page, encoding="utf-8")


def run_case(browser: str, port: int, scenario: str, width: int, height: int) -> None:
    route = "/licao/" if scenario.startswith(("lesson", "roadmap")) else (
        "/o-que-fazer/segunda-parte/" if scenario.startswith("second") else "/o-que-fazer/"
    )
    query = {"scenario": scenario, "lesson": "7"}
    if scenario.startswith("roadmap"):
        query["source"] = "roteiro-de-estudos"
    url = f"http://127.0.0.1:{port}{route}?" + urlencode(query)
    ARTIFACTS.mkdir(exist_ok=True)
    image_name = ARTIFACTS / f"{scenario}-{width}.png"
    cmd = [
        browser, "--headless=new", "--no-sandbox", "--disable-gpu",
        "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check",
        "--hide-scrollbars", "--force-device-scale-factor=1",
        f"--window-size={width},{height}", "--virtual-time-budget=1800",
        f"--screenshot={image_name}", "--dump-dom", url,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=35, check=False)
    if result.returncode:
        raise RuntimeError(f"Chrome failed: {scenario} {width}px: {result.stderr[-350:]}")
    marker = re.search(r'data-qa-result="([^"]+)"', result.stdout)
    if marker is None or marker.group(1) != "PASS":
        detail = re.search(r'data-qa-detail="([^"]+)"', result.stdout)
        raise AssertionError(
            f"Scenario {scenario} {width}px failed: "
            + (detail.group(1) if detail else "missing test result")
        )
    print(f"PASS: {scenario} at {width}px")


def main() -> int:
    browser = locate_browser()
    with tempfile.TemporaryDirectory(prefix="tf-student-flow-") as tmp:
        fixture = Path(tmp)
        copy_fixture_files(fixture)
        handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(fixture))
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            for scenario, width, height in SCENARIOS:
                run_case(browser, server.server_port, scenario, width, height)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
    print(f"PASS: {len(SCENARIOS)} browser and viewport scenarios.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, AssertionError, subprocess.TimeoutExpired) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
