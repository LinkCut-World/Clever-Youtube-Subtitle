const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { webcrypto } = require("node:crypto");
const { IDBFactory } = require("fake-indexeddb");
require("./word-utils.js");
const dictionary = require("./dictionary.js");
const { createStore } = require("./dictionary-store.js");
const { createPacks } = require("./dictionary-packs.js");
const { convert } = require("./wikdict-sqlite.js");
const catalog = require("./dictionary-catalog.js");
let SQL;
test.before(async () => { SQL = await require("./sqlite/sql-wasm.js")({ locateFile: file => path.resolve("sqlite", file) }); });
async function packed(data, version = "test-1", invalidSchema = false) {
  const db = new SQL.Database();
  if (invalidSchema) db.run("CREATE TABLE other(value TEXT)");
  else {
    db.run("CREATE TABLE translation(written_rep TEXT, lexentry TEXT, trans_list TEXT, is_good INTEGER, score REAL)");
    for (const [word, entries] of Object.entries(data)) for (const meaning of entries) {
      const pos = meaning.pos ? meaning.pos[0].toUpperCase() + meaning.pos.slice(1) : "";
      db.run("INSERT INTO translation VALUES(?,?,?,?,?)", [word, pos ? `eng/${word}__${pos}__1` : null, meaning.translations.join(" | "), 1, 10]);
    }
  }
  const bytes = db.export(); db.close();
  const sha256 = Buffer.from(await webcrypto.subtle.digest("SHA-256", bytes)).toString("hex");
  const entry = { language: "zh", name: "中文", version, words: Object.keys(data).length, bytes: bytes.length,
    unpackedBytes: bytes.length, sha256, file: "en-zh.sqlite3", url: "https://download.wikdict.com/dictionaries/sqlite/test/en-zh.sqlite3" };
  return { bytes, entry, pack: { language: "zh", data } };
}
function library(entries, { store = createStore(new IDBFactory()), fetcher, timeoutMs, installSQLite } = {}) {
  const settings = { knownWords: ["like"], syncConfig: { url: "https://git.example/words.git" }, microsoftDictionaryConfig: { key: "test-secret" } };
  const storage = { async set(changes) { Object.assign(settings, changes); } };
  const install = installSQLite || (async (bytes, entry, progress) => {
    const pack = convert(SQL, bytes, entry, progress);
    const metadata = { language: entry.language, version: entry.version, sha256: entry.sha256,
      sourceSha256: entry.sha256, words: pack.words, bytes: entry.bytes, unpackedBytes: JSON.stringify(pack.data).length };
    await store.install(pack, metadata); return metadata;
  });
  const packs = createPacks({ catalog: { packs: entries }, store, storage, fetcher, crypto: webcrypto, installSQLite: install, timeoutMs });
  return { store, settings, packs };
}
const fixture = { like: [{ pos: "verb", translations: ["喜欢"] }] };
const file = (bytes) => ({ size: bytes.length, arrayBuffer: async () => new Uint8Array(bytes).buffer });

test("a fresh profile has no dictionaries; official SQLite import persists and enables offline reads", async () => {
  const item = await packed(fixture), indexedDB = new IDBFactory();
  const app = library([item.entry], { store: createStore(indexedDB) });
  assert.deepEqual(await app.packs.list(), []);
  await app.packs.importFile(file(item.bytes));
  const restarted = createStore(indexedDB);
  assert.equal((await restarted.list())[0].words, 1);
  const offline = dictionary.createDictionary(restarted.readShard);
  assert.equal((await offline.lookup({ word: "LIKES", lemma: "like", language: "zh" })).entries[0].translations[0], "喜欢");
  assert.deepEqual(app.settings.knownWords, ["like"]);
  assert.equal(app.settings.microsoftDictionaryConfig.key, "test-secret");
  assert.equal(app.settings.syncConfig.url, "https://git.example/words.git");
  assert.equal(typeof app.settings.dictionaryPackRevision, "string");
});

test("replacement removes old words atomically; deleting a language removes every shard but no vocabulary or keys", async () => {
  const old = await packed(fixture), newer = await packed({ bank: [{ pos: "noun", translations: ["银行"] }] }, "test-2");
  const store = createStore(new IDBFactory()), app = library([old.entry, newer.entry], { store });
  await app.packs.importFile(file(old.bytes)); await app.packs.importFile(file(newer.bytes));
  assert.equal((await store.metadata("zh")).version, "test-2");
  const offline = dictionary.createDictionary(store.readShard);
  assert.equal((await offline.lookup({ word: "like", language: "zh" })).entries.length, 0);
  assert.equal((await offline.lookup({ word: "bank", language: "zh" })).entries[0].translations[0], "银行");
  await app.packs.remove("zh");
  assert.deepEqual(await store.list(), []);
  for (let number = 0; number < 128; number++) await assert.rejects(store.readShard("zh", number.toString(16).padStart(2, "0")), /Download this offline/);
  assert.deepEqual(app.settings.knownWords, ["like"]);
  assert.equal(app.settings.microsoftDictionaryConfig.key, "test-secret");
});

test("an aborted IndexedDB replacement keeps both previous metadata and entries", async () => {
  const store = createStore(new IDBFactory());
  await store.install({ language: "zh", data: fixture }, { language: "zh", version: "old" });
  await assert.rejects(store.install({ language: "zh", data: { like: [{ pos: "verb", translations: [() => "cannot clone"] }] } }, { language: "zh", version: "new" }));
  await new Promise(setImmediate);
  assert.equal((await store.metadata("zh")).version, "old");
  assert.equal((await store.readShard("zh", dictionary.shardFor("like"))).like[0].translations[0], "喜欢");
});

test("damaged, oversized and unsupported SQLite files never replace an installed dictionary", async () => {
  const good = await packed(fixture), invalid = await packed(fixture, "invalid", true);
  const app = library([good.entry, invalid.entry]); await app.packs.importFile(file(good.bytes));
  const corrupt = Uint8Array.from(good.bytes); corrupt[corrupt.length - 1] ^= 1;
  await assert.rejects(app.packs.importFile(file(corrupt)), /does not match/);
  await assert.rejects(app.packs.importFile({ size: 100000000, arrayBuffer() { throw new Error("Must not read"); } }), /Choose a listed/);
  await assert.rejects(app.packs.importFile(file(invalid.bytes)), /supported WikDict format/);
  assert.equal((await app.store.metadata("zh")).version, "test-1");
});

test("Download goes directly to WikDict, reports progress, rejects redirects and sends no credentials", async () => {
  const item = await packed(fixture), calls = [], progress = [];
  const app = library([item.entry], { fetcher: async (url, options) => { calls.push({ url, options }); return new Response(item.bytes); } });
  await app.packs.download("zh", (bytes, stage) => progress.push({ bytes, stage }));
  assert.equal(calls[0].url, item.entry.url);
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.headers, undefined);
  assert.equal(progress.filter(x => x.stage.phase === "download").at(-1).bytes, item.bytes.length);
  assert.ok(progress.some(x => x.stage.phase === "prepare"));
  const missing = library([item.entry], { fetcher: async () => new Response("", { status: 404 }) });
  await assert.rejects(missing.packs.download("zh"), /WikDict could not find/);
  const network = library([item.entry], { fetcher: async () => { throw new TypeError("network"); } });
  await assert.rejects(network.packs.download("zh"), /Could not reach WikDict/);
  const timeout = library([item.entry], { timeoutMs: 5, fetcher: (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }) });
  await assert.rejects(timeout.packs.download("zh"), /timed out/);
});

test("a notification error does not turn an installed official dictionary into a failed update", async () => {
  const item = await packed(fixture), store = createStore(new IDBFactory());
  const service = createPacks({ catalog: { packs: [item.entry] }, store,
    storage: { async set() { throw new Error("Storage quota"); } }, crypto: webcrypto,
    installSQLite: async (bytes, entry) => { const pack = convert(SQL, bytes, entry); const metadata = { language: "zh", sha256: entry.sha256 }; await store.install(pack, metadata); return metadata; } });
  await service.importFile(file(item.bytes));
  assert.equal((await store.metadata("zh")).sha256, item.entry.sha256);
});

test("all cached official SQLite sources convert with the expected counts, meanings and official-only URLs", {
  skip: !catalog.packs.every(entry => fs.existsSync(`dist/dictionary-source/en-${entry.language}.sqlite3`))
}, async () => {
  const expected = { zh: "明白", es: "comprender", fr: "comprendre", de: "verstehen", ja: "分かる" };
  for (const entry of catalog.packs) {
    assert.ok(entry.url.startsWith("https://download.wikdict.com/"));
    const bytes = fs.readFileSync(`dist/dictionary-source/en-${entry.language}.sqlite3`);
    assert.equal(bytes.length, entry.bytes);
    assert.equal(Buffer.from(await webcrypto.subtle.digest("SHA-256", bytes)).toString("hex"), entry.sha256);
    const pack = convert(SQL, bytes, entry);
    assert.equal(Object.keys(pack.data).length, entry.words);
    if (expected[entry.language]) assert.ok(pack.data.understand.some(meaning => meaning.translations.includes(expected[entry.language])));
  }
});
