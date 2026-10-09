const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const scriptPath = path.join(__dirname, "..", "mensalidades.js");
const source = fs.readFileSync(scriptPath, "utf8");
const withoutBootstrap = source.replace(/\binitializePage\(\);\s*$/, "");

function createHistoryScreen(records) {
  const elements = {
    detachedHistoryTableBody: { innerHTML: "" },
    detachedHistorySummary: { textContent: "" },
    exportDetachedHistoryButton: { disabled: true }
  };
  const exportedFiles = [];
  const context = vm.createContext({
    document: {
      getElementById(id) {
        if (!elements[id]) throw new Error("Missing element: " + id);
        return elements[id];
      }
    },
    window: {
      XLSX: {
        utils: {
          json_to_sheet(rows) {
            exportedFiles.push({ rows });
            return { "!ref": "A1:H4" };
          },
          book_new() { return {}; },
          book_append_sheet() {}
        },
        writeFile(book, filename) {
          exportedFiles[exportedFiles.length - 1].filename = filename;
        }
      }
    }
  });

  assert.notEqual(withoutBootstrap, source, "Page bootstrap must be excluded from the VM");
  vm.runInContext(withoutBootstrap, context, { filename: scriptPath });
  vm.runInContext("detachedTuitionHistory = " + JSON.stringify(records), context);
  return { context, elements, exportedFiles };
}

const records = [
  {
    tuition_id: "pay-1",
    subject_ref: "abc12345-0000-0000-0000-000000000000",
    reference_month: "2026-09-01",
    due_date: "2026-09-28",
    amount_due: 99.9,
    amount_paid: null,
    payment_date: null,
    financial_status: "no_payment",
    student_name: "Nome não deve aparecer"
  },
  {
    tuition_id: "pay-2",
    subject_ref: "abc12345-0000-0000-0000-000000000000",
    reference_month: "2026-08-01",
    due_date: "2026-08-28",
    amount_due: 99.9,
    amount_paid: null,
    payment_date: null,
    financial_status: "exempt"
  }
];

test("historical detached tuition is shown separately without charge actions", () => {
  const screen = createHistoryScreen(records);
  vm.runInContext("renderDetachedTuitionHistory()", screen.context);
  const html = screen.elements.detachedHistoryTableBody.innerHTML;
  assert.match(html, /Perfil removido/);
  assert.match(html, /Ref\. abc12345/);
  assert.match(html, /Sem pagamento registrado/);
  assert.match(html, /Isenta/);
  assert.doesNotMatch(html, /Nome não deve aparecer/);
  assert.doesNotMatch(html, /data-action=|REGISTRAR|ESTORNAR|ISENTAR/);
  assert.match(screen.elements.detachedHistorySummary.textContent, /não são cobranças|sem comprovação de exigibilidade/i);
  assert.equal(screen.elements.exportDetachedHistoryButton.disabled, false);
});

test("historical export preserves exact subjects without changing active tuition", () => {
  const screen = createHistoryScreen(records);
  vm.runInContext("exportDetachedTuitionHistory()", screen.context);
  assert.equal(screen.exportedFiles.length, 1);
  assert.equal(screen.exportedFiles[0].rows.length, 2);
  assert.equal(screen.exportedFiles[0].rows[0]["Referência histórica"], records[0].subject_ref);
  assert.equal(screen.exportedFiles[0].rows[0]["Situação histórica"], "Sem pagamento registrado");
  assert.equal(screen.exportedFiles[0].filename, "mensalidades_perfis_removidos.xlsx");
});
