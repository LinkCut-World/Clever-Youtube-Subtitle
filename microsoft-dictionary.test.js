const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
require("./word-utils.js");
const dictionary = require("./dictionary.js");
const microsoft = require("./microsoft-dictionary.js");
const dictionaryStore = require("./dictionary-store.js");
const config = { key: "test-key-only", region: "" };
const translated = (target, confidence, posTag = "NOUN", prefixWord = "") =>
  ({ displayTarget: target, confidence, posTag, prefixWord });
const reply = (translations = [translated("条件", 0.5)]) => new Response(JSON.stringify([{ translations }]));

test("Microsoft queries only the base word, sorts and deduplicates translations, and returns at most three", async () => {
  const calls = [];
  const service = microsoft.createMicrosoftDictionary(async (url, options) => {
    calls.push({ url, options });
    return reply([translated("第四项", 0.01), translated("条件", 0.7), translated("情况", 0.9),
      translated("条件", 0.6, "VERB"), translated("状态", 0.2)]);
  });
  const result = await service.lookup({ word: "Conditions!", lemma: "condition", language: "zh-Hans" }, config);
  assert.equal(result.word, "condition");
  assert.deepEqual(result.entries.map((entry) => entry.translations[0]), ["情况", "条件", "状态"]);
  assert.equal(result.entries[0].pos, "noun");
  assert.equal(calls.length, 1);
  const { url, options } = calls[0];
  assert.equal(url, `${microsoft.ENDPOINT}/dictionary/lookup?api-version=3.0&from=en&to=zh-Hans`);
  assert.deepEqual(JSON.parse(options.body), [{ Text: "condition" }]);
  assert.equal(options.headers["Ocp-Apim-Subscription-Key"], config.key);
  assert.equal(options.headers["Ocp-Apim-Subscription-Region"], undefined);
  assert.equal(options.method, "POST");
  assert.equal(options.credentials, "omit");
  assert.equal(options.redirect, "error");
  assert.ok(options.signal instanceof AbortSignal);
  assert.ok(!url.includes(config.key), "Keys must only be sent in the authentication header");
  assert.equal(dictionary.MICROSOFT_LANGUAGES.length, 49);
  assert.equal(dictionary.partOfSpeech("adjective", "zh-Hans"), "形容词");
});

test("regional keys, prefix words, missing lemmas, and absent words use the official result structure", async () => {
  const calls = [];
  const service = microsoft.createMicrosoftDictionary(async (url, options) => {
    const word = JSON.parse(options.body)[0].Text;
    calls.push({ url, options, word });
    return reply(word === "fly" ? [translated("mosca", 0.5, "NOUN", "la"),
      translated("la mosca", 0.2, "NOUN", "la")] : []);
  });
  const result = await service.lookup({ word: "fly", lemma: "missing", language: "es" }, { key: config.key, region: "EastUS" });
  assert.deepEqual(calls.map((call) => call.word), ["missing", "fly"]);
  assert.equal(calls[0].options.headers["Ocp-Apim-Subscription-Region"], "eastus");
  assert.equal(result.word, "fly");
  assert.equal(result.entries[0].translations[0], "la mosca");
  assert.equal(result.entries.length, 1, "Prefixes must not create duplicate visible meanings");
  assert.ok(result.entries.every((entry) => !entry.translations[0].includes("la la")));
  const empty = await service.lookup({ word: "unlisted", language: "es" }, { key: config.key, region: "eastus" });
  assert.deepEqual(empty.entries, []);
  assert.ok(calls.every((call) => !/examples|\/translate\?/u.test(call.url)));
});

test("Microsoft shares requests and bounds, expires, and invalidates its memory cache", async () => {
  let reads = 0, clock = 0;
  const service = microsoft.createMicrosoftDictionary(async () => { reads++; return reply(); },
    { cacheLimit: 2, cacheMs: 10, now: () => clock });
  const query = (word) => ({ word, language: "zh" });
  await Promise.all(Array.from({ length: 5 }, () => service.lookup(query("condition"), config)));
  assert.equal(reads, 1);
  await service.lookup(query("bank"), config);
  await service.lookup(query("set"), config);
  await service.lookup(query("condition"), config);
  assert.equal(reads, 4, "The least recent item was evicted");
  clock = 11;
  await service.lookup(query("condition"), config);
  assert.equal(reads, 5);
  await service.lookup(query("condition"), { ...config, key: "new-test-key" });
  assert.equal(reads, 6);
  await service.lookup(query("condition"), { ...config, key: "new-test-key", region: "eastus" });
  assert.equal(reads, 7);
});

test("failed queries can retry and errors never include a key or a remote error body", async () => {
  let attempts = 0;
  const service = microsoft.createMicrosoftDictionary(async () => {
    if (++attempts === 1) return new Response(`reflected ${config.key}`, { status: 401 });
    return reply();
  });
  const query = { word: "condition", language: "zh" };
  await assert.rejects(service.lookup(query, config), (error) =>
    /Check the key/u.test(error.message) && !error.message.includes(config.key));
  assert.equal((await service.lookup(query, config)).entries.length, 1);
  for (const [status, pattern] of [[400, /word or language/], [403, /resource/], [429, /limit/], [500, /not available/]]) {
    const failing = microsoft.createMicrosoftDictionary(async () => new Response(config.key, { status }));
    await assert.rejects(failing.lookup(query, config), (error) => pattern.test(error.message) && !error.message.includes(config.key));
  }
  const invalid = microsoft.createMicrosoftDictionary(async () => new Response('{"translations":[]}'));
  await assert.rejects(invalid.lookup(query, config), /invalid reply/);
});

test("timeout, network failure, and invalid input fail clearly without sending credentials to another host", async () => {
  const timeout = microsoft.createMicrosoftDictionary((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }), { timeoutMs: 5 });
  const query = { word: "condition", language: "zh" };
  await assert.rejects(timeout.lookup(query, config), /too long to reply/);
  const failed = microsoft.createMicrosoftDictionary(async () => { throw new Error(config.key); });
  await assert.rejects(failed.lookup(query, config), /Could not reach Microsoft/);
  let calls = 0;
  const unused = microsoft.createMicrosoftDictionary(async () => { calls++; return reply(); });
  await assert.rejects(unused.lookup({ ...query, language: "../../private" }, config), /Choose a Microsoft/);
  await assert.rejects(unused.lookup({ ...query, word: "a".repeat(101) }, config), /too long/);
  await assert.rejects(unused.lookup({ ...query, word: "!!!" }, config), /Enter a word/);
  await assert.rejects(unused.lookup(query, { key: "secret\nInjected: x" }), /Check your Microsoft key/);
  await assert.rejects(unused.lookup(query, { key: config.key, region: "https://evil.example" }), /region code/);
  assert.equal(calls, 0);
});

test("an old in-flight key's response cannot replace a new key's cached result", async () => {
  let finishOld, reads = 0;
  const service = microsoft.createMicrosoftDictionary(async (_url, options) => {
    reads++;
    if (options.headers["Ocp-Apim-Subscription-Key"] === "old-key") {
      return new Promise((resolve) => { finishOld = () => resolve(reply([translated("old", 1)])); });
    }
    return reply([translated("new", 1)]);
  });
  const query = { word: "condition", language: "es" };
  const old = service.lookup(query, { key: "old-key" });
  assert.equal((await service.lookup(query, { key: "new-key" })).entries[0].translations[0], "new");
  finishOld(); await old;
  assert.equal((await service.lookup(query, { key: "new-key" })).entries[0].translations[0], "new");
  assert.equal(reads, 2);
});

function serviceScene({ allowed = true, fetcher = async () => reply(), offlineStore } = {}) {
  const data = { knownWords: ["like"], syncConfig: { url: "https://git.example/words.git" },
    [dictionary.PROVIDER_KEY]: "offline", [dictionary.STORAGE_KEY]: "zh" };
  const context = { CleverSubtitleDictionary: dictionary, CleverSubtitleMicrosoftDictionary: microsoft,
    CleverSubtitleDictionaryStore: dictionaryStore,
    fetch: fetcher, chrome: { runtime: { getURL: (path) => `chrome-extension://test/${path}` },
      storage: { local: { async get(keys) { return Object.fromEntries(keys.map((key) => [key, data[key]])); },
        async set(changes) { Object.assign(data, changes); } } },
      permissions: { async contains(request) { assert.deepEqual(Array.from(request.origins), [microsoft.ORIGIN]); return allowed; } } } };
  vm.runInNewContext(fs.readFileSync("dictionary-service.js", "utf8"), context);
  const service = offlineStore ? context.CleverSubtitleDictionaryServiceFactory.createService({
    storage: context.chrome.storage.local, permissions: context.chrome.permissions, fetcher, offlineStore
  }) : context.CleverSubtitleDictionaryService;
  return { service, data };
}

test("online settings check before saving, keep keys private, reuse a saved key, and remove it without changing vocabulary", async () => {
  let requests = 0;
  const { service, data } = serviceScene({ fetcher: async () => { requests++; return reply(); } });
  const settings = { provider: "microsoft", language: "zh-Hans", key: config.key, region: "global", word: "perilous" };
  const saved = await service.configure(settings);
  assert.equal(saved.hasKey, true);
  assert.equal(saved.region, "");
  assert.equal(saved.result.word, "perilous");
  assert.equal(JSON.stringify(saved).includes(config.key), false);
  assert.equal(JSON.stringify(await service.status()).includes(config.key), false);
  assert.equal(data[dictionary.MICROSOFT_CONFIG_KEY].key, config.key);
  assert.deepEqual(data.knownWords, ["like"]);
  assert.deepEqual(data.syncConfig, { url: "https://git.example/words.git" });
  assert.equal((await service.configure({ ...settings, key: "" })).hasKey, true);
  assert.equal(requests, 2, "Save and check must bypass the cached meaning to verify the key again");
  assert.equal((await service.lookup({ word: "perilous", language: "zh-Hans" })).entries.length, 1);
  const removed = await service.forgetKey();
  assert.equal(removed.hasKey, false);
  assert.equal(data[dictionary.MICROSOFT_CONFIG_KEY], null);
  assert.equal(data[dictionary.STORAGE_KEY], "off");
  await assert.rejects(service.lookup({ word: "perilous", language: "zh-Hans" }), /Dictionary is off/);
  assert.deepEqual(data.knownWords, ["like"]);
});

test("denied access or failed authentication does not save a bad key or replace working settings", async () => {
  for (const scene of [serviceScene({ allowed: false }),
    serviceScene({ fetcher: async () => new Response("bad key", { status: 401 }) })]) {
    await assert.rejects(scene.service.configure({ provider: "microsoft", language: "zh-Hans", key: config.key }), /Allow access|Check the key/);
    assert.equal(scene.data[dictionary.PROVIDER_KEY], "offline");
    assert.equal(scene.data[dictionary.STORAGE_KEY], "zh");
    assert.equal(scene.data[dictionary.MICROSOFT_CONFIG_KEY], undefined);
  }
});

test("offline language validation is distinct from missing dictionary data", async () => {
  const { service } = serviceScene({ offlineStore: { metadata: async () => null, readShard: async () => ({}) } });
  await assert.rejects(service.configure({ provider: "offline", language: "" }), /Choose a language under Translate to/);
  await assert.rejects(service.configure({ provider: "offline", language: "ko" }), /not available for the selected dictionary/);
  // Korean is available from Microsoft, but not from the WikDict English exports.
  await assert.rejects(service.configure({ provider: "offline", language: "ru" }), /Download this offline dictionary first/);
  const status = await service.status();
  assert.ok(Array.from(status.offlineLanguages).includes("ru"));
});

test("removing a key while a check is pending cannot silently save that key again", async () => {
  let release, entered;
  const start = new Promise((resolve) => { entered = resolve; });
  const { service, data } = serviceScene({ fetcher: () => {
    entered(); return new Promise((resolve) => { release = () => resolve(reply()); });
  } });
  const pending = service.configure({ provider: "microsoft", language: "zh-Hans", key: config.key });
  await start;
  await service.forgetKey();
  release();
  await assert.rejects(pending, /settings changed/);
  assert.equal(data[dictionary.MICROSOFT_CONFIG_KEY], null);
});
