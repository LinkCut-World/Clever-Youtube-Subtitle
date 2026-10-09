const test = require("node:test");
const assert = require("node:assert/strict");
require("./word-utils.js");
require("./dictionary.js");
require("./sync-access.js");
const { createManager } = require("./dictionary-manager.js");
class Element {
  constructor() { this.children = []; this.events = {}; this.dataset = {}; this.textContent = "";
    this.classList = { toggle() {} }; this.files = []; }
  addEventListener(name, callback) { this.events[name] = callback; }
  appendChild(child) { this.children.push(child); }
  replaceChildren() { this.children = []; }
}
function scene({ allowed = true } = {}) {
  const ui = Object.fromEntries(["summary", "list", "status", "file", "import", "search", "matching", "empty"].map((name) => [name, new Element()]));
  let installed = [];
  const calls = [];
  const entry = { language: "zh", name: "中文", sha256: "expected", version: "test", words: 100,
    bytes: 100000, unpackedBytes: 300000, url: "https://download.wikdict.com/dictionaries/sqlite/test/en-zh.sqlite3" };
  const catalog = { packs: [entry], origins: ["https://download.wikdict.com/*"] };
  const packs = { async list() { return installed; }, async download(language, progress) {
    calls.push(["download", language]); progress(entry.bytes); installed = [catalog.packs.find((pack) => pack.language === language)];
  }, async remove(language) { calls.push(["remove", language]); installed = []; },
  async importFile(file) { calls.push(["import", file]); installed = [entry]; return entry; } };
  const chrome = { runtime: { async sendMessage(message) { calls.push(["message", message]); return { ok: true }; } },
    storage: { onChanged: { addListener() {} } }, permissions: {
      async contains() { return allowed; }, async request(value) { calls.push(["permission", value]); return false; }
    } };
  const document = { getElementById: (id) => ui[id.replace("packs-", "")], createElement: () => new Element() };
  const app = createManager(document, chrome, packs, catalog);
  const button = (action) => ui.list.children[0].children[1].children.find((child) => child.dataset.action === action);
  return { app, ui, calls, button, entry, catalog };
}

test("the manager starts empty, downloads, selects, deletes and imports a dictionary", async () => {
  const app = scene(); await app.app.loaded;
  assert.match(app.ui.summary.textContent, /^0 installed/);
  assert.equal(app.button("download").textContent, "Download");
  assert.equal(app.button("remove"), undefined);
  await app.button("download").events.click();
  assert.match(app.ui.summary.textContent, /^1 installed/);
  assert.equal(app.button("download").textContent, "Download again");
  assert.match(app.ui.status.textContent, /ready for offline use/);
  await app.button("use").events.click();
  assert.deepEqual(app.calls.at(-1), ["message", { type: "dictionary:configure", provider: "offline", language: "zh" }]);
  await app.button("remove").events.click();
  assert.match(app.ui.summary.textContent, /^0 installed/);
  assert.match(app.ui.status.textContent, /vocabulary is still here/);
  app.ui.file.files = [{ name: "en-zh.sqlite3" }]; app.ui.file.events.change();
  assert.equal(app.ui.import.disabled, false);
  await app.ui.import.events.click();
  assert.match(app.ui.status.textContent, /imported/);
  assert.match(app.ui.summary.textContent, /^1 installed/);
});

test("denied download access asks only for WikDict and leaves the library empty", async () => {
  const app = scene({ allowed: false }); await app.app.loaded;
  await app.button("download").events.click();
  assert.deepEqual(app.calls, [["permission", { origins: ["https://download.wikdict.com/*"] }]]);
  assert.match(app.ui.status.textContent, /Allow access.*Import file/);
  assert.match(app.ui.summary.textContent, /^0 installed/);
});

test("language search matches English/native names and codes, ignores accents, and retains actions after filtering", async () => {
  const app = scene();
  app.catalog.packs.push({ ...app.entry, language: "fr", name: "Français", englishName: "French" },
    { ...app.entry, language: "ru", name: "Русский", englishName: "Russian" });
  await app.app.loaded;
  const search = (value) => { app.ui.search.value = value; app.ui.search.events.input(); };
  search("FRENCH");
  assert.equal(app.ui.list.children.length, 1);
  assert.match(app.ui.list.children[0].children[0].children[0].textContent, /Français/);
  search("francais"); assert.equal(app.ui.list.children.length, 1);
  search("Русский"); assert.equal(app.ui.list.children.length, 1);
  search("ru");
  await app.button("download").events.click();
  assert.deepEqual(app.calls[0], ["download", "ru"]);
  search("not a language");
  assert.equal(app.ui.list.children.length, 0);
  assert.equal(app.ui.empty.hidden, false);
  assert.match(app.ui.matching.textContent, /^0 of 3/);
  search("");
  assert.equal(app.ui.list.children.length, 3);
  assert.equal(app.ui.empty.hidden, true);
  assert.match(app.ui.summary.textContent, /^1 installed/);
});
