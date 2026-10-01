const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const github = require("./sync-github.js");

test("background migrates saved words, records edits, and syncs with a tokenized URL", async () => {
  const data = { knownWords: ["like"] };
  let listener;
  let remote = null;
  let holdNextRead = null;
  const context = {
    URL, Blob, Response, AbortController, CompressionStream, DecompressionStream,
    TextEncoder, TextDecoder, Uint8Array, btoa, atob, setTimeout, clearTimeout, crypto: webcrypto,
    fetch: async (url, request) => {
      assert.equal(request.headers.Authorization, "Bearer secret");
      if (!url.includes("/contents/")) return { ok: true, json: async () => ({ private: true }) };
      if (request.method === "GET") {
        if (holdNextRead) {
          const gate = holdNextRead;
          holdNextRead = null;
          gate.entered();
          await gate.wait;
        }
        return remote
          ? { ok: true, json: async () => ({ content: remote, sha: "current" }) }
          : { ok: false, status: 404 };
      }
      remote = JSON.parse(request.body).content;
      return { ok: true, json: async () => ({}) };
    },
    chrome: {
      runtime: { onMessage: { addListener(callback) { listener = callback; } } },
      storage: {
        local: {
          async get(keys) {
            return Object.fromEntries(keys.filter((key) => Object.hasOwn(data, key))
              .map((key) => [key, data[key]]));
          },
          async set(changes) { Object.assign(data, changes); }
        }
      },
      alarms: {
        get(_name, callback) { callback(null); },
        create() {},
        onAlarm: { addListener() {} }
      }
    },
    importScripts(...paths) {
      for (const path of paths) vm.runInContext(fs.readFileSync(path, "utf8"), context);
    }
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("background.js", "utf8"), context);
  const send = (message) => new Promise((resolve) => {
    assert.equal(listener(message, null, resolve), true);
  });

  assert.equal((await send({ type: "sync:status" })).connected, false);
  assert.deepEqual(Array.from((await send({ type: "vocab:get" })).words), ["like"]);
  assert.equal((await send({ type: "vocab:mutate", mutation: { remove: ["like"] } })).ok, true);
  assert.deepEqual(Array.from(data.knownWords), []);
  assert.equal(data.syncState.actions.like[0], 0);
  assert.equal((await send({ type: "vocab:mutate", mutation: { add: ["apple"] } })).ok, true);
  const connected = await send({
    type: "sync:configure", address: "https://user:secret@github.com/Name/words.git", token: ""
  });
  assert.equal(connected.ok, true, connected.error);
  assert.deepEqual(Array.from(connected.words), ["apple"]);
  assert.equal((await send({ type: "sync:status" })).repository, "Name/words");
  assert.equal(data.syncConfig.repository, "Name/words");
  assert.equal((await github.decodeContent(remote)).actions.like[0], 0);

  let entered;
  let release;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  holdNextRead = { entered, wait: gate };
  const pendingSync = send({ type: "sync:now" });
  await enteredPromise;
  const localEdit = send({ type: "vocab:mutate", mutation: { add: ["listen"] } });
  assert.equal((await Promise.race([localEdit, new Promise((resolve) => setTimeout(() => resolve({ ok: false }), 100))])).ok, true,
    "Local word edits should not wait for the GitHub network request");
  release();
  assert.equal((await pendingSync).ok, true);
  assert.deepEqual(Array.from(data.knownWords), ["apple", "listen"]);
  assert.equal((await send({ type: "sync:now" })).ok, true);
  assert.deepEqual(Array.from((await github.decodeContent(remote)).seed), ["like"]);
  assert.equal((await github.decodeContent(remote)).actions.listen[0], 1);

  assert.equal((await send({ type: "sync:disable" })).connected, false);
  assert.equal(data.syncConfig, null);
  assert.deepEqual(Array.from(data.knownWords), ["apple", "listen"]);
});
