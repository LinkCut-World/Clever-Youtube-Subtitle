const test = require("node:test");
const assert = require("node:assert/strict");
require("./word-utils.js");
const dictionary = require("./dictionary.js");
const microsoft = require("./microsoft-dictionary.js");
const access = require("./sync-access.js");
const { createSettings } = require("./dictionary-settings.js");
const names = ["provider", "language", "microsoft", "key", "key-note", "region", "test-word",
  "offline-help", "save", "forget-key", "status", "test-result"];
class Element {
  constructor() {
    this.value = ""; this.children = []; this.textContent = ""; this.events = {};
    this.classList = { toggle() {} };
  }
  addEventListener(name, listener) { this.events[name] = listener; }
  appendChild(child) { this.children.push(child); }
  replaceChildren() { this.children = []; }
}
function scene({ hasKey = true, allowed = true, failure = "", offlineLanguages = dictionary.LANGUAGES.map((entry) => entry.code) } = {}) {
  const ui = Object.fromEntries(names.map((name) => [name, new Element()]));
  ui["test-word"].value = "hello";
  const requests = [], permissionChecks = [];
  let onChanged;
  const status = { ok: true, provider: "microsoft", language: "zh-Hans", hasKey, region: "", offlineLanguages };
  const document = { getElementById: (id) => ui[id.replace("dictionary-", "")], createElement: () => new Element() };
  const chrome = { runtime: { async sendMessage(message) {
    requests.push(message);
    if (message.type === "dictionary:status") return status;
    if (message.type === "dictionary:forget-key") return { ok: true, provider: "microsoft", language: "off", hasKey: false, region: "" };
    if (failure) return { ok: false, error: failure };
    return { ok: true, provider: "microsoft", language: message.language, hasKey: true, region: "",
      result: { word: message.word, language: message.language, entries: [{ pos: "interjection", translations: ["你好"] }] } };
  } }, storage: { onChanged: { addListener(callback) { onChanged = callback; } } },
    permissions: { async contains() { return allowed; }, async request(value) { permissionChecks.push(value); return false; } } };
  global.CleverSubtitleSyncAccess = access;
  const settings = createSettings(document, chrome);
  return { ui, requests, permissionChecks, settings,
    externalSettings(next) { Object.assign(status, next); return onChanged({ [dictionary.PROVIDER_KEY]: {}, [dictionary.STORAGE_KEY]: {} }, "local"); } };
}

test("settings never refill a saved key, reuse it on save, and show actual test meanings", async () => {
  const app = scene(); await app.settings.loaded;
  assert.equal(app.ui.key.value, "");
  assert.match(app.ui["key-note"].textContent, /key is saved/);
  assert.equal(app.ui.language.children.length, 50);
  await app.ui.save.events.click();
  assert.equal(app.requests.at(-1).key, "");
  assert.equal(app.requests.at(-1).word, "hello");
  assert.equal(app.ui["test-result"].hidden, false);
  assert.equal(app.ui["test-result"].children[0].textContent, "hello");
  assert.equal(app.ui["test-result"].children[1].textContent, "感叹词: 你好");
  assert.match(app.ui.status.textContent, /Connected to Microsoft/);
  app.ui.key.value = "new-test-key";
  await app.ui.save.events.click();
  assert.equal(app.requests.at(-1).key, "new-test-key");
  assert.equal(app.ui.key.value, "");
  await app.ui["forget-key"].events.click();
  assert.equal(app.ui.language.value, "off");
  assert.equal(app.ui["test-result"].hidden, true);
  assert.equal(app.ui["forget-key"].hidden, true);
});

test("denied host permission stops a save; a failed check preserves the entered key for retry", async () => {
  const denied = scene({ allowed: false }); await denied.settings.loaded;
  denied.ui.key.value = "new-test-key";
  await denied.ui.save.events.click();
  assert.deepEqual(denied.permissionChecks[0], { origins: [microsoft.ORIGIN] });
  assert.equal(denied.requests.length, 1, "No configure call is sent when permission is denied");
  assert.equal(denied.ui.key.value, "new-test-key");
  assert.match(denied.ui.status.textContent, /Allow access to Microsoft/);
  const failed = scene({ failure: "Microsoft could not check your key." }); await failed.settings.loaded;
  failed.ui.key.value = "new-test-key";
  await failed.ui.save.events.click();
  assert.equal(failed.ui.key.value, "new-test-key");
  assert.match(failed.ui.status.textContent, /could not check/);
});

test("source changes map Chinese language codes and offline saves do not request Microsoft access", async () => {
  const app = scene({ allowed: false }); await app.settings.loaded;
  app.ui.provider.value = "offline";
  app.ui.provider.events.change();
  assert.equal(app.ui.language.value, "zh");
  assert.equal(app.ui.language.children.length, dictionary.LANGUAGES.length + 1);
  assert.equal(app.ui.microsoft.hidden, true);
  await app.ui.save.events.click();
  assert.equal(app.requests.at(-1).provider, "offline");
  assert.equal(app.permissionChecks.length, 0);
  app.ui.provider.value = "microsoft";
  app.ui.provider.events.change();
  assert.equal(app.ui.language.value, "zh-Hans");
});

test("using a dictionary in the manager refreshes open settings without overwriting a key or region draft", async () => {
  const app = scene(); await app.settings.loaded;
  await app.externalSettings({ provider: "offline", language: "zh" });
  assert.equal(app.ui.provider.value, "offline");
  assert.equal(app.ui.language.value, "zh");
  assert.equal(app.ui.microsoft.hidden, true);
  app.ui.key.value = "my-unsaved-key";
  await app.externalSettings({ provider: "microsoft", language: "fr" });
  assert.equal(app.ui.key.value, "my-unsaved-key");
  assert.equal(app.ui.provider.value, "offline");
  app.ui.key.value = "";
  app.ui.region.value = "eastus"; app.ui.region.events.input();
  await app.externalSettings({ provider: "microsoft", language: "de", region: "westus" });
  assert.equal(app.ui.region.value, "eastus");
});

test("offline Save detects an old background language list and explains reloading instead of sending an invalid setting", async () => {
  const app = scene({ offlineLanguages: ["zh", "es", "fr", "de", "ja"] }); await app.settings.loaded;
  app.ui.provider.value = "offline"; app.ui.provider.events.change();
  app.ui.language.value = "ru";
  await app.ui.save.events.click();
  assert.match(app.ui.status.textContent, /Reload Clever Youtube Subtitle.*Extensions.*reopen Settings/);
  assert.equal(app.requests.some((message) => message.type === "dictionary:configure"), false);
  assert.equal(app.permissionChecks.length, 0);
});

test("offline Save explains an empty language selection and accepts supported expanded languages", async () => {
  const app = scene(); await app.settings.loaded;
  app.ui.provider.value = "offline"; app.ui.provider.events.change();
  app.ui.language.value = "";
  await app.ui.save.events.click();
  assert.match(app.ui.status.textContent, /Choose a language under Translate to/);
  assert.equal(app.requests.some((message) => message.type === "dictionary:configure"), false);
  app.ui.language.value = "ru";
  await app.ui.save.events.click();
  assert.equal(app.requests.at(-1).type, "dictionary:configure");
  assert.equal(app.requests.at(-1).language, "ru");
  assert.equal(app.requests.at(-1).provider, "offline");
});
