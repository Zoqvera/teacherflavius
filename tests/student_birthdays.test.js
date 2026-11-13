const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../student_birthdays.js"), "utf8");

function createElement(tagName) {
  const element = {
    tagName: tagName.toUpperCase(),
    id: "",
    className: "",
    textContent: "",
    children: [],
    attributes: {},
    listeners: {},
    style: {},
    dataset: {},
    appendChild: function (child) {
      child.parent = this;
      this.children.push(child);
      return child;
    },
    setAttribute: function (name, value) {
      this.attributes[name] = value;
    },
    addEventListener: function (name, handler) {
      this.listeners[name] = handler;
    },
    querySelector: function (selector) {
      return selector.startsWith("#") ? findById(this, selector.slice(1)) : null;
    },
    remove: function () {
      if (this.parent) {
        this.parent.children = this.parent.children.filter(function (child) {
          return child !== element;
        });
      }
    }
  };

  Object.defineProperty(element, "innerHTML", {
    get: function () { return this.markup || ""; },
    set: function (markup) {
      this.markup = markup;
      if (markup.includes('id="teacherProfessorBirthdayStudents"')) {
        const list = createElement("ul");
        list.id = "teacherProfessorBirthdayStudents";
        this.appendChild(list);

        const closeButton = createElement("button");
        closeButton.id = "teacherProfessorBirthdayClose";
        this.appendChild(closeButton);
      }
    }
  });

  return element;
}

function findById(root, id) {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}

function birthdayDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(function (part) {
    return [part.type, part.value];
  }));
  return "2000-" + values.month + "-" + values.day;
}

async function loadBirthdayAlert(students, isAdmin, pathname) {
  const body = createElement("body");
  const head = createElement("head");
  const selectedColumns = [];
  const conditions = [];
  const client = {
    rpc: async function (name) {
      assert.equal(name, "is_teacher_admin");
      return { data: isAdmin !== false, error: null };
    },
    from: function (table) {
      assert.equal(table, "profiles");
      return {
        select: function (columns) {
          selectedColumns.push(columns);
          return this;
        },
        eq: function (column, value) {
          conditions.push([column, value]);
          return this;
        },
        not: function () { return this; },
        order: async function () { return { data: students, error: null }; }
      };
    }
  };
  const document = {
    body: body,
    head: head,
    documentElement: { style: { overflow: "" }, dataset: {} },
    readyState: "complete",
    getElementById: function (id) {
      return findById(body, id) || findById(head, id);
    },
    createElement: createElement
  };
  const Auth = {
    getClient: function () { return client; },
    getSession: async function () { return { user: { id: "teacher" } }; }
  };
  const window = {
    location: { pathname: pathname || "/professor/" },
    Auth: Auth,
    ResourceWaiter: { waitUntil: async function () { return true; } }
  };

  vm.runInNewContext(source, { document: document, window: window, Auth: Auth, Date: Date, Intl: Intl, console: console });
  await new Promise(setImmediate);

  return { document: document, selectedColumns: selectedColumns, conditions: conditions };
}

test("renders an individual WhatsApp link for each birthday student", async function () {
  const date = birthdayDate();
  const result = await loadBirthdayAlert([
    { name: "Ana", email: "ana@example.com", whatsapp: "(34) 99999-1234", date_of_birth: date },
    { name: "Bruno", email: "bruno@example.com", whatsapp: "+55 (11) 99876-5432", date_of_birth: date },
    { name: "<script>alert(1)</script>", email: "sem@example.com", whatsapp: "999", date_of_birth: date },
    { name: "Outro", whatsapp: "(21) 99999-1111", date_of_birth: "2000-01-01" }
  ]);
  const overlay = result.document.getElementById("teacherProfessorBirthdayAlert");
  const list = result.document.getElementById("teacherProfessorBirthdayStudents");

  assert.ok(overlay);
  assert.equal(list.children.length, date.endsWith("-01-01") ? 4 : 3);
  const anaLink = list.children[0].children[1];
  const brunoLink = list.children[1].children[1];
  const unavailable = list.children[2].children[1];

  assert.equal(anaLink.tagName, "A");
  assert.equal(anaLink.href, "https://wa.me/5534999991234");
  assert.equal(anaLink.textContent, "CHAMAR NO WHATSAPP");
  assert.equal(anaLink.target, "_blank");
  assert.equal(anaLink.rel, "noopener noreferrer");
  assert.equal(anaLink.attributes["aria-label"], "Chamar Ana no WhatsApp");
  assert.equal(brunoLink.href, "https://wa.me/5511998765432");
  assert.equal(unavailable.tagName, "SPAN");
  assert.equal(unavailable.textContent, "WhatsApp não cadastrado");
  assert.equal(list.children[2].children[0].textContent, "<script>alert(1)</script>");
  assert.ok(result.selectedColumns[0].split(",").includes("whatsapp"));
  assert.deepEqual(result.conditions, [["enrolled", true], ["archived", false]]);
});

test("does not show professor birthday data outside an authorized professor session", async function () {
  const students = [{ name: "Ana", whatsapp: "34999991234", date_of_birth: birthdayDate() }];
  const notAdmin = await loadBirthdayAlert(students, false, "/professor/");
  const otherPage = await loadBirthdayAlert(students, true, "/area-do-estudante/");

  assert.equal(notAdmin.document.getElementById("teacherProfessorBirthdayAlert"), null);
  assert.equal(otherPage.document.getElementById("teacherProfessorBirthdayAlert"), null);
  assert.deepEqual(notAdmin.selectedColumns, []);
  assert.deepEqual(otherPage.selectedColumns, []);
});

test("closes the birthday popup without leaving the page locked", async function () {
  const result = await loadBirthdayAlert([
    { name: "Ana", whatsapp: "34999991234", date_of_birth: birthdayDate() }
  ], true);
  const close = result.document.getElementById("teacherProfessorBirthdayClose");
  assert.equal(result.document.documentElement.style.overflow, "hidden");

  close.listeners.click();

  assert.equal(result.document.getElementById("teacherProfessorBirthdayAlert"), null);
  assert.equal(result.document.documentElement.style.overflow, "");
});

test("versions birthday assets so the updated popup is loaded", function () {
  const config = fs.readFileSync(path.join(__dirname, "../site_runtime_config.js"), "utf8");
  const professorPage = fs.readFileSync(path.join(__dirname, "../professor.html"), "utf8");

  assert.match(config, /student_birthdays\.js\?v=20261112-birthday-whatsapp-1/);
  assert.match(professorPage, /site_runtime_config\.js\?v=20261112-birthday-whatsapp-1/);
});
