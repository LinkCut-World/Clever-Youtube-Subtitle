const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { createService } = require("./nlp-service.js");
const { createClient } = require("./nlp-client.js");
const { loadEngine } = require("./nlp-test-helper.cjs");

test("background model loads once for concurrent captions and uses the original lemmas", async () => {
  let loads = 0;
  const service = createService(async () => { loads++; return loadEngine(); });
  const [first, second, same] = await Promise.all([
    service.analyze("He likes her."), service.analyze("I saw a saw."), service.analyze("He likes her.")
  ]);
  assert.equal(loads, 1);
  assert.equal(first, same);
  assert.equal(first.find((token) => token.form === "likes").lemma, "like");
  assert.deepEqual(second.filter((token) => token.form === "saw").map((token) => token.lemma), ["see", "saw"]);
  assert.equal((await service.analyze("his main focus was on understanding what happens when you plug in a complex value for s."))
    .find((token) => token.form === "understanding").lemma, "understand");
  await assert.rejects(service.analyze("x".repeat(50001)), /too long/);
});

test("a model load failure can recover on the next caption", async () => {
  let attempts = 0;
  const service = createService(async () => {
    if (++attempts === 1) throw new Error("temporary load failure");
    return loadEngine();
  });
  await assert.rejects(service.analyze("He likes her."), /temporary/);
  assert.equal((await service.analyze("He likes her.")).find((token) => token.form === "likes").lemma, "like");
  assert.equal(attempts, 2);
});

test("client shares pending requests, caches success, and falls back without a retry loop", async () => {
  let requests = 0, release;
  const client = createClient(async (message) => {
    requests++;
    assert.deepEqual(Object.keys(message).sort(), ["text", "type"]);
    await new Promise((resolve) => { release = resolve; });
    return { ok: true, tokens: [{ form: "likes", lemma: "like", start: 0, end: 5 }] };
  });
  assert.equal(client.peek("likes"), undefined);
  const first = client.analyze("likes"), second = client.analyze("likes");
  assert.equal(first, second);
  await new Promise(setImmediate);
  release();
  await first;
  assert.equal((await client.analyze("likes"))[0].lemma, "like");
  assert.equal(requests, 1);
  let failures = 0;
  const broken = createClient(async () => { failures++; throw new Error("worker unavailable"); });
  assert.deepEqual(await broken.analyze("text"), []);
  assert.deepEqual(await broken.analyze("text"), []);
  assert.equal(failures, 1);
});

test("packaged worker assets initialize with importScripts and local asset URLs", async () => {
  const requested = [];
  const context = {
    URL, Response, TextEncoder, TextDecoder, WebAssembly, setTimeout, clearTimeout, console,
    WorkerGlobalScope: class {},
    location: { href: "chrome-extension://test/background.js" },
    chrome: { runtime: { getURL: (name) => `chrome-extension://test/${name}` } },
    fetch: async (url) => {
      requested.push(String(url));
      const filename = new URL(url).pathname.slice(1);
      assert.ok(["morphodita/english-model.tagger", "morphodita/morphodita.wasm"].includes(filename));
      return new Response(fs.readFileSync(path.join(__dirname, filename)), {
        headers: { "Content-Type": filename.endsWith(".wasm") ? "application/wasm" : "application/octet-stream" }
      });
    },
    importScripts(...files) {
      for (const file of files) vm.runInContext(fs.readFileSync(path.join(__dirname, file), "utf8"), context);
    }
  };
  context.self = context;
  context.globalThis = context;
  vm.createContext(context);
  context.importScripts("morphodita/morphodita.js", "morphodita/engine.js", "nlp-service.js");
  assert.deepEqual(requested, [], "Importing scripts alone must not load the model");
  const tokens = await context.CleverSubtitleNLPService.analyze("He likes her.");
  assert.equal(tokens.find((token) => token.form === "likes").lemma, "like");
  assert.equal(requested.length, 2);
  await context.CleverSubtitleNLPService.analyze("it gives you 1");
  assert.equal(requested.length, 2, "Reuse the initialized model");
});
