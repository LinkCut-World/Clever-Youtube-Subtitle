const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const model = require("./sync-model.js");

test("background records edits and keeps local edits responsive during Git sync", async () => {
  const data = { knownWords: ["like"] };
  let listener;
  let remoteState = model.emptyState();
  let holdNextRead = null;
  const context = {
    URL, Blob, Response, AbortController, CompressionStream, DecompressionStream,
    TextEncoder, TextDecoder, Uint8Array, btoa, atob, setTimeout, clearTimeout, crypto: webcrypto,
    chrome: {
      runtime: {
        onMessage: { addListener(callback) { listener = callback; } },
        onStartup: { addListener() {} },
        onInstalled: { addListener() {} }
      },
      permissions: { contains: async () => true },
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
        get: async () => null, create() {},
        onAlarm: { addListener() {} }
      }
    },
    importScripts(...paths) {
      for (const path of paths) {
        if (path === "git-bundle.js") continue;
        vm.runInContext(fs.readFileSync(path, "utf8"), context);
        if (path === "sync-git.js") {
          context.CleverSubtitleGitSync.syncWithGit = async (_fetch, config, state) => {
            assert.equal(config.url, "https://git.internal.example/Name/words.git");
            assert.equal(config.username, "user");
            assert.equal(config.password, "secret");
            if (holdNextRead) {
              const gate = holdNextRead;
              holdNextRead = null;
              gate.entered();
              await gate.wait;
            }
            remoteState = model.mergeStates(remoteState, state);
            return remoteState;
          };
        }
      }
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
    type: "sync:configure", address: "https://user:secret@git.internal.example/Name/words.git"
  });
  assert.equal(connected.ok, true, connected.error);
  assert.deepEqual(Array.from(connected.words), ["apple"]);
  assert.equal((await send({ type: "sync:status" })).repositoryUrl, "https://git.internal.example/Name/words.git");
  assert.equal(remoteState.actions.like[0], 0);

  let entered;
  let release;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  holdNextRead = { entered, wait: gate };
  const pendingSync = send({ type: "sync:now" });
  await enteredPromise;
  const localEdit = send({ type: "vocab:mutate", mutation: { add: ["listen"] } });
  assert.equal((await Promise.race([localEdit, new Promise((resolve) => setTimeout(() => resolve({ ok: false }), 100))])).ok, true,
    "Local word edits should not wait for the Git network request");
  release();
  assert.equal((await pendingSync).ok, true);
  assert.deepEqual(Array.from(data.knownWords), ["apple", "listen"]);
  assert.equal((await send({ type: "sync:now" })).ok, true);
  assert.equal(remoteState.actions.listen[0], 1);
  assert.equal((await send({ type: "sync:disable" })).connected, false);
  assert.equal(data.syncConfig, null);
  assert.deepEqual(Array.from(data.knownWords), ["apple", "listen"]);

  data.syncConfig = { repository: "Name/words", token: "legacy-secret" };
  const migrated = await send({ type: "sync:status" });
  assert.equal(migrated.repositoryUrl, "https://github.com/Name/words.git");
  assert.equal(JSON.stringify(migrated).includes("legacy-secret"), false);
  context.chrome.permissions.contains = async () => false;
  const denied = await send({ type: "sync:now" });
  assert.equal(denied.ok, false);
  assert.match(denied.error, /allow this Git server/);
  assert.deepEqual(Array.from(data.knownWords), ["apple", "listen"]);
});

test("browser startup restores lost alarms and syncs saved words without opening the UI", async () => {
  const initial = model.applyMutation(model.emptyState(["like"]), { add: ["listen"] }, "device-a", 0, 100);
  const data = {
    knownWords: initial.words, syncState: initial.state, syncClock: initial.clock,
    syncConfig: { url: "https://git.internal.example/words.git", username: "user", password: "secret", branch: "" }
  };
  const alarms = new Map();
  let creations = 0;
  let syncs = 0;
  async function bootWorker() {
    const events = {};
    const context = {
      URL, Uint8Array, crypto: webcrypto,
      chrome: {
        runtime: {
          onMessage: { addListener() {} },
          onStartup: { addListener(callback) { events.startup = callback; } },
          onInstalled: { addListener(callback) { events.installed = callback; } }
        },
        permissions: { contains: async () => true },
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
          get: async (name) => alarms.get(name),
          async create(name, info) { creations++; alarms.set(name, info); },
          onAlarm: { addListener() {} }
        }
      },
      importScripts(...paths) {
        for (const path of paths) {
          if (path === "git-bundle.js") continue;
          vm.runInContext(fs.readFileSync(path, "utf8"), context);
          if (path === "sync-git.js") {
            context.CleverSubtitleGitSync.syncWithGit = async (_fetch, _config, state) => {
              syncs++;
              assert.equal(state.actions.listen[1], initial.state.actions.listen[1]);
              return state;
            };
          }
        }
      }
    };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync("background.js", "utf8"), context);
    await new Promise(setImmediate);
    return events;
  }

  const first = await bootWorker();
  await first.startup();
  assert.equal(syncs, 1);
  alarms.clear(); // Simulate a browser that did not retain its alarms on exit.
  const restarted = await bootWorker();
  await restarted.startup();
  assert.equal(syncs, 2);
  assert.equal(alarms.get("clever-subtitle-sync-periodic").periodInMinutes, 5);
  assert.equal(creations, 2);
  await restarted.installed();
  assert.equal(syncs, 3);
  assert.equal(creations, 2, "An existing periodic timer should keep its schedule");
  data.syncConfig = null;
  await restarted.startup();
  assert.equal(syncs, 3, "Startup must not connect after sync has been turned off");
  assert.deepEqual(Array.from(data.knownWords), ["like", "listen"]);
});
