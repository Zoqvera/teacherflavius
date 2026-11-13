const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const MODULE_SOURCE = fs.readFileSync(
  path.join(ROOT, "roteiro-da-aula-v2/student_whatsapp.js"), "utf8"
);
const STUDENT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const STUDENT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const STUDENT_OTHER = "cccccccc-cccc-cccc-cccc-cccccccccccc";

function harness() {
  const opened = [];
  const context = {
    window: {
      open(url, target, features) {
        opened.push({ url, target, features });
      }
    },
    document: {
      createElement(tagName) {
        return {
          tagName,
          attributes: {},
          listeners: {},
          setAttribute(name, value) {
            this.attributes[name] = value;
          },
          addEventListener(event, callback) {
            this.listeners[event] = callback;
          }
        };
      }
    }
  };
  vm.runInNewContext(MODULE_SOURCE, context);
  return { api: context.window.TeacherStudentWhatsapp, opened };
}

test("normaliza WhatsApp brasileiro e números internacionais explícitos", function () {
  const { api } = harness();
  assert.equal(api.normalizePhone("(34) 99834-9756"), "5534998349756");
  assert.equal(api.normalizePhone("+55 (34) 99834-9756"), "5534998349756");
  assert.equal(api.normalizePhone("+351 912 345 678"), "351912345678");
  assert.equal(api.normalizePhone("99834-9756"), "");
  assert.equal(api.normalizePhone(""), "");
  assert.equal(api.normalizePhone("123"), "");
});

test("carrega apenas os WhatsApps dos IDs da turma e elimina duplicatas", async function () {
  const { api } = harness();
  const requests = [];
  const client = {
    from(tableName) {
      requests.push(tableName);
      return {
        select(columns) {
          requests.push(columns);
          return {
            in(column, ids) {
              requests.push(column, Array.from(ids));
              return Promise.resolve({
                data: [
                  { id: STUDENT_A, whatsapp: "(34) 99834-9756" },
                  { id: STUDENT_B, whatsapp: "+55 (11) 98765-4321" },
                  { id: STUDENT_OTHER, whatsapp: "(21) 99999-9999" }
                ]
              });
            }
          };
        }
      };
    }
  };
  const contacts = await api.load(client, [
    { student_id: STUDENT_A },
    { student_id: STUDENT_B },
    { student_id: STUDENT_A },
    { student_id: "invalid" }
  ]);
  assert.equal(requests[0], "profiles");
  assert.equal(requests[1], "id,whatsapp");
  assert.equal(requests[2], "id");
  assert.deepEqual(requests[3], [STUDENT_A, STUDENT_B]);
  assert.equal(contacts.size, 2);
  assert.equal(contacts.get(STUDENT_A), "5534998349756");
  assert.equal(contacts.get(STUDENT_B), "5511987654321");
  assert.equal(contacts.has(STUDENT_OTHER), false);
});

test("botão abre exclusivamente o WhatsApp do aluno sem texto predefinido", function () {
  const { api, opened } = harness();
  const control = api.createButton("Maria Exemplo", "5534998349756", true);
  assert.equal(control.tagName, "button");
  assert.equal(control.textContent, "CHAMAR NO WHATSAPP");
  assert.equal(control.attributes["aria-label"], "Chamar Maria Exemplo no WhatsApp");
  assert.notEqual(control.disabled, true);
  control.listeners.click();
  assert.deepEqual(opened, [{
    url: "https://wa.me/5534998349756",
    target: "_blank",
    features: "noopener,noreferrer"
  }]);
});

test("telefone ausente ou falha de consulta nunca abre outro contato", function () {
  const { api, opened } = harness();
  const missing = api.createButton("Aluno A", "", true);
  const failedLookup = api.createButton("Aluno B", "", false);
  assert.equal(missing.disabled, true);
  assert.match(missing.title, /não cadastrado/i);
  assert.equal(failedLookup.disabled, true);
  assert.match(failedLookup.title, /não foi possível carregar/i);
  assert.equal(missing.listeners.click, undefined);
  assert.equal(failedLookup.listeners.click, undefined);
  assert.equal(opened.length, 0);
});

test("falha de consulta não retorna um contato desatualizado", async function () {
  const { api } = harness();
  const client = {
    from() {
      return {
        select() {
          return {
            in() {
              return Promise.resolve({ error: new Error("Acesso indisponível") });
            }
          };
        }
      };
    }
  };
  await assert.rejects(api.load(client, [{ student_id: STUDENT_A }]), /Acesso indisponível/);
});

test("roteiro principal carrega o módulo e apresenta o botão nos cards", function () {
  for (const route of ["roteiro-da-aula", "roteiro-da-aula-v2"]) {
    const page = fs.readFileSync(path.join(ROOT, route, "index.html"), "utf8");
    assert.match(page, /roteiro-da-aula-v2\/student_whatsapp\.js/);
  }
  const app = fs.readFileSync(
    path.join(ROOT, "roteiro-da-aula-v2/app.js"), "utf8"
  );
  assert.match(app, /card\.appendChild\(studentWhatsappAction\(item\)\)/);
  assert.match(app, /loadStudentContacts\(client, items\)/);
});
