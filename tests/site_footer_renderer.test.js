const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createElement(tagName) {
  return {
    tagName: String(tagName).toUpperCase(),
    id: "",
    className: "",
    textContent: "",
    children: [],
    attributes: {},
    appendChild(child) {
      this.children.push(child);
      this.lastChild = child;
      return child;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }
  };
}

function loadRenderer() {
  const source = fs.readFileSync(path.join(__dirname, "..", "site_footer_renderer.js"), "utf8");
  const headChildren = [];
  const context = {
    Date,
    Object,
    document: {
      createElement,
      createTextNode(text) {
        return { nodeType: 3, textContent: String(text) };
      },
      getElementById() {
        return null;
      },
      head: {
        appendChild(child) {
          headChildren.push(child);
        }
      }
    },
    window: {}
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { renderer: context.window.SiteFooterRenderer, headChildren };
}

function findById(node, id) {
  if (!node) return null;
  if (node.id === id) return node;
  for (const child of node.children || []) {
    const match = findById(child, id);
    if (match) return match;
  }
  return null;
}

function collectLinks(node, links) {
  const result = links || [];
  if (!node) return result;
  if (node.tagName === "A") result.push(node);
  for (const child of node.children || []) collectLinks(child, result);
  return result;
}

test("builds the institutional footer contract", () => {
  const { renderer } = loadRenderer();
  const footer = renderer.buildFooter();

  assert.equal(renderer.footerId, "teacher-flavius-site-footer");
  assert.equal(footer.id, renderer.footerId);
  assert.equal(footer.className, "tf-site-footer");
  assert.equal(footer.attributes["aria-label"], "Informações institucionais do Teacher Flávio");
  assert.ok(findById(footer, "tf-footer-title"));
  assert.ok(findById(footer, "tf-footer-contact"));

  const links = collectLinks(footer);
  assert.ok(links.some((link) => link.href === "/area-do-estudante/"));
  assert.ok(links.some((link) => link.href === "/privacidade/"));
  assert.ok(links.some((link) => link.href === "https://zoqvera.com" && link.target === "_blank"));
  assert.ok(links.some((link) => link.attributes["data-tf-open-privacy"] === ""));
});

test("installs footer styles once per renderer invocation context", () => {
  const loaded = loadRenderer();
  loaded.renderer.installStyles();

  assert.equal(loaded.headChildren.length, 1);
  assert.equal(loaded.headChildren[0].id, "teacher-flavius-site-footer-styles");
  assert.match(loaded.headChildren[0].textContent, /tf-site-footer__grid/);
});
