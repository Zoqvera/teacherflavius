const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const classes = fs.readFileSync(path.join(root, "turmas.js"), "utf8");
const classesPage = fs.readFileSync(path.join(root, "turmas.html"), "utf8");
const cleanRoutePage = fs.readFileSync(path.join(root, "turmas/index.html"), "utf8");
const classVisual = fs.readFileSync(path.join(root, "turmas/turmas_visual.css"), "utf8");

test("keeps the classes script syntactically valid", function () {
  assert.doesNotThrow(function () {
    new vm.Script(classes);
  });
});

test("allows the teacher to rename a class independently", function () {
  assert.match(classes, /data-save-class-name=/);
  assert.match(classes, /async function saveClassName\(/);
  assert.match(classes, /class_name: className/);
  assert.match(classes, /\.eq\("is_active", true\)/);
  assert.match(classes, /data-class-name-status=/);
});

test("supports keyboard save and visible feedback for class names", function () {
  assert.match(classes, /event\.key !== "Enter"/);
  assert.match(classes, /Nome atualizado\./);
  assert.match(classVisual, /\.class-name-save-button/);
  assert.match(classVisual, /\.class-name-status\.success/);
  assert.match(classVisual, /\.class-name-status\.error/);
});

test("busts cached class editing assets", function () {
  assert.match(classesPage, /turmas\.js\?v=20260925-rename-1/);
  assert.match(cleanRoutePage, /turmas_visual\.css\?v=20260925-rename-1/);
});
