"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const FUNCTIONS_DIRECTORY = path.join(__dirname, "..", "supabase", "functions");
const REPLY_TO_EMAIL = "contato@teacherflavius.com";
const RESEND_ENDPOINT = "https://api.resend.com/emails";

test("all Resend email payloads route replies to the Workspace mailbox", () => {
  let coveredFunctions = 0;

  for (const entry of fs.readdirSync(FUNCTIONS_DIRECTORY, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sourcePath = path.join(FUNCTIONS_DIRECTORY, entry.name, "index.ts");
    if (!fs.existsSync(sourcePath)) continue;

    const source = fs.readFileSync(sourcePath, "utf8");
    if (!source.includes(RESEND_ENDPOINT)) continue;

    coveredFunctions += 1;
    assert.match(
      source,
      /\breply_to:\s*"contato@teacherflavius\.com"/,
      `Missing ${REPLY_TO_EMAIL} reply-to in ${entry.name}`,
    );
  }

  assert.ok(coveredFunctions >= 7, "Expected all existing Resend integrations");
});
