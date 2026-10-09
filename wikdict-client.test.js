const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
const { IDBFactory } = require("fake-indexeddb");
require("./word-utils.js");
const dictionary = require("./dictionary.js");
const { createStore } = require("./dictionary-store.js");
const { createInstaller } = require("./wikdict-client.js");

test("the installer transfers bytes and terminates its worker after success, failure, or timeout", async () => {
  let worker;
  class FakeWorker {
    constructor(url) { assert.equal(url, "chrome-extension://test/wikdict-worker.js"); this.terminated = 0; worker = this; }
    postMessage(message, transfer) { this.message = message; assert.deepEqual(transfer, [message.buffer]); }
    terminate() { this.terminated++; }
  }
  const install = createInstaller(FakeWorker, path => `chrome-extension://test/${path}`, 1000);
  const progress = [], task = install(new Uint8Array([1, 2, 3]), { language: "zh" }, value => progress.push(value));
  assert.equal(worker.message.language, "zh");
  assert.equal(worker.message.buffer.byteLength, 3);
  worker.onmessage({ data: { type: "progress", progress: { phase: "prepare", done: 1, total: 1 } } });
  worker.onmessage({ data: { type: "result", metadata: { language: "zh", words: 1 } } });
  assert.deepEqual(await task, { language: "zh", words: 1 });
  assert.equal(worker.terminated, 1); assert.equal(progress.length, 1);
  const failed = install(new Uint8Array([1]), { language: "zh" });
  worker.onmessage({ data: { type: "error", error: "Invalid dictionary" } });
  await assert.rejects(failed, /Invalid dictionary/); assert.equal(worker.terminated, 1);
  const timeout = createInstaller(FakeWorker, path => `chrome-extension://test/${path}`, 5)(new Uint8Array([1]), { language: "zh" });
  await assert.rejects(timeout, /too long/); assert.equal(worker.terminated, 1);
});

test("the real browser-style worker loads bundled SQLite and installs a real official dictionary", {
  skip: !fs.existsSync("dist/dictionary-source/en-zh.sqlite3")
}, async () => {
  const indexedDB = new IDBFactory(), messages = [];
  const context = { URL, Blob, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, WebAssembly, Response,
    indexedDB, console, setTimeout, clearTimeout, location: { href: "https://extension.test/wikdict-worker.js" },
    fetch: async url => {
      const filename = new URL(url).pathname.slice(1);
      assert.equal(filename, "sqlite/sql-wasm.wasm");
      return new Response(fs.readFileSync(filename), { headers: { "Content-Type": "application/wasm" } });
    }, postMessage: message => messages.push(message) };
  context.self = context; context.globalThis = context;
  context.importScripts = (...paths) => { for (const path of paths) vm.runInContext(fs.readFileSync(path, "utf8"), context, { filename: path }); };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("wikdict-worker.js", "utf8"), context);
  const raw = new Uint8Array(fs.readFileSync("dist/dictionary-source/en-zh.sqlite3"));
  await context.onmessage({ data: { language: "zh", buffer: raw.buffer } });
  const result = messages.at(-1);
  assert.equal(result.type, "result", result.error);
  assert.equal(result.metadata.words, 23064);
  assert.ok(result.metadata.sourceUrl.startsWith("https://download.wikdict.com/"));
  const store = createStore(indexedDB);
  const offline = dictionary.createDictionary(store.readShard);
  assert.equal((await offline.lookup({ word: "understanding", lemma: "understand", language: "zh" })).entries[0].translations[0], "明白");
  assert.equal((await offline.lookup({ word: "perilous", language: "zh" })).entries[0].translations[0], "危险");
  assert.ok(messages.some(message => message.progress?.phase === "save"));
});
