"use strict";

const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const REPOSITORY_ROOT = path.resolve(__dirname, "..");
const ALLOWLIST_FILE = path.join(REPOSITORY_ROOT, ".github/legacy-sql-class-type-lock.json");
const OBSOLETE_CLASS_TYPES = /QUARTETO|8[ \t]+ALUNOS|quartet|eight_students/i;

function gitBlobSha(content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  return createHash("sha1")
    .update("blob " + bytes.length + "\0")
    .update(bytes)
    .digest("hex");
}

function checkSqlFile(relativePath, content, historicalFiles) {
  const expectedSha = historicalFiles[relativePath];
  if (expectedSha) {
    if (gitBlobSha(content) !== expectedSha) {
      return [relativePath + ": arquivo SQL historico alterado. Preserve as migracoes originais."];
    }
    return [];
  }

  const source = content.toString("utf8");
  const match = OBSOLETE_CLASS_TYPES.exec(source);
  if (!match) return [];

  const line = source.slice(0, match.index).split("\n").length;
  return [
    relativePath + ":" + line + ": identificador de turma obsoleto: " + match[0]
  ];
}

function listSqlFiles(root) {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root }
  ).toString("utf8").split("\0").filter(file => file.endsWith(".sql")).sort();
}

function validateRepository(
  root = REPOSITORY_ROOT,
  historicalFiles = JSON.parse(fs.readFileSync(ALLOWLIST_FILE, "utf8"))
) {
  const errors = [];

  for (const archivedPath of Object.keys(historicalFiles)) {
    if (!fs.existsSync(path.join(root, archivedPath))) {
      errors.push(archivedPath + ": migracao historica ausente.");
    }
  }

  for (const file of listSqlFiles(root)) {
    errors.push(...checkSqlFile(file, fs.readFileSync(path.join(root, file)), historicalFiles));
  }

  return errors;
}

if (require.main === module) {
  const errors = validateRepository();
  if (errors.length > 0) {
    console.error("SQL class taxonomy guard failed:");
    for (const error of errors) console.error("- " + error);
    process.exitCode = 1;
  } else {
    console.log("SQL class taxonomy guard passed: only current identifiers in executable SQL.");
  }
}

module.exports = { checkSqlFile, gitBlobSha, validateRepository };
