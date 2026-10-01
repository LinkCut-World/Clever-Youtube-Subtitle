"use strict";

importScripts("word-utils.js", "sync-model.js", "sync-github.js");

const model = globalThis.CleverSubtitleSyncModel;
const github = globalThis.CleverSubtitleGithubSync;
const PERIODIC_ALARM = "clever-subtitle-sync-periodic";
const SOON_ALARM = "clever-subtitle-sync-soon";
let queue = Promise.resolve();
let syncPromise = null;

function serial(task) {
  const result = queue.then(task, task);
  queue = result.catch(() => {});
  return result;
}

function newDeviceId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function localData() {
  const data = await chrome.storage.local.get([
    "knownWords", "syncState", "syncDeviceId", "syncClock", "syncConfig",
    "syncLastSuccess", "syncLastError"
  ]);
  if (!data.syncState) {
    data.syncState = model.emptyState(data.knownWords);
    data.syncDeviceId ||= newDeviceId();
    data.syncClock ||= 0;
    await chrome.storage.local.set({
      syncState: data.syncState,
      syncDeviceId: data.syncDeviceId,
      syncClock: data.syncClock
    });
  } else {
    data.syncState = model.cleanState(data.syncState);
    if (!data.syncDeviceId) {
      data.syncDeviceId = newDeviceId();
      await chrome.storage.local.set({ syncDeviceId: data.syncDeviceId });
    }
  }
  return data;
}

function scheduleSoon() {
  chrome.alarms.create(SOON_ALARM, { delayInMinutes: 0.5 });
}

async function mutate(mutation) {
  const data = await localData();
  const result = model.applyMutation(data.syncState, mutation, data.syncDeviceId, data.syncClock || 0);
  if (result.changed) {
    await chrome.storage.local.set({
      syncState: result.state,
      syncClock: result.clock,
      knownWords: result.words
    });
    if (data.syncConfig) scheduleSoon();
  }
  return { words: result.words, changed: result.changed };
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function performSync() {
  const data = await serial(localData);
  if (!data.syncConfig) throw new Error("Set up GitHub sync first.");
  try {
    const remoteState = await github.syncWithGithub(fetchWithTimeout, data.syncConfig, data.syncState);
    return await serial(async () => {
      const latest = await localData();
      if (latest.syncConfig?.repository !== data.syncConfig.repository ||
          latest.syncConfig?.token !== data.syncConfig.token) {
        return { words: model.effectiveWords(latest.syncState) };
      }
      const state = model.mergeStates(latest.syncState, remoteState);
      const words = model.effectiveWords(state);
      const clock = Math.max(latest.syncClock || 0, model.maxTimestamp(state));
      const lastSuccess = new Date().toISOString();
      await chrome.storage.local.set({
        syncState: state,
        syncClock: clock,
        knownWords: words,
        syncLastSuccess: lastSuccess,
        syncLastError: ""
      });
      if (!model.equalStates(state, remoteState)) scheduleSoon();
      return { words, lastSuccess };
    });
  } catch (error) {
    await serial(async () => {
      const latest = await localData();
      if (latest.syncConfig?.repository === data.syncConfig.repository &&
          latest.syncConfig?.token === data.syncConfig.token) {
        await chrome.storage.local.set({ syncLastError: error.message });
      }
    });
    throw error;
  }
}

function syncNow() {
  if (syncPromise) return syncPromise;
  syncPromise = performSync().finally(() => { syncPromise = null; });
  return syncPromise;
}

async function configure(address, explicitToken) {
  await serial(async () => {
    const parsed = github.parseRepositoryAddress(address);
    if (parsed.repository.toLowerCase() === "linkcut-world/clever-youtube-subtitle") {
      throw new Error("Use a separate private repository for your words.");
    }
    const data = await localData();
    const token = String(explicitToken || parsed.token ||
      (data.syncConfig?.repository === parsed.repository ? data.syncConfig.token : "")).trim();
    if (!token) throw new Error("Add an access token to the URL or token field.");
    await chrome.storage.local.set({
      syncConfig: { repository: parsed.repository, token },
      syncLastError: ""
    });
  });
  if (syncPromise) await syncPromise.catch(() => {});
  return syncNow();
}

async function status() {
  const data = await localData();
  return {
    repository: data.syncConfig?.repository || "",
    connected: Boolean(data.syncConfig),
    lastSuccess: data.syncLastSuccess || "",
    lastError: data.syncLastError || ""
  };
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  const tasks = {
    "vocab:get": () => serial(() => localData().then((data) => ({ words: model.effectiveWords(data.syncState) }))),
    "vocab:mutate": () => serial(() => mutate(message.mutation)),
    "sync:status": () => serial(status),
    "sync:configure": () => configure(message.address, message.token),
    "sync:now": syncNow,
    "sync:disable": () => serial(async () => {
      await chrome.storage.local.set({ syncConfig: null, syncLastError: "" });
      return status();
    })
  };
  if (!Object.hasOwn(tasks, message?.type)) return false;
  tasks[message.type]().then(
    (result) => respond({ ok: true, ...result }),
    (error) => respond({ ok: false, error: error.message || "Could not complete this action." })
  );
  return true;
});

chrome.alarms.get(PERIODIC_ALARM, (alarm) => {
  if (!alarm) chrome.alarms.create(PERIODIC_ALARM, { periodInMinutes: 5 });
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === PERIODIC_ALARM || alarm.name === SOON_ALARM) {
    syncNow().catch(() => {});
  }
});
