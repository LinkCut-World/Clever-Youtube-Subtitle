"use strict";

importScripts("word-utils.js", "sync-model.js", "sync-codec.js", "git-bundle.js", "sync-git.js");

const model = globalThis.CleverSubtitleSyncModel;
const remote = globalThis.CleverSubtitleGitSync;
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
  if (data.syncConfig?.repository && !data.syncConfig.url) {
    data.syncConfig = {
      url: `https://github.com/${data.syncConfig.repository}.git`,
      username: data.syncConfig.token, password: "", branch: ""
    };
    await chrome.storage.local.set({ syncConfig: data.syncConfig });
  }
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
  if (!data.syncConfig) throw new Error("Set up Git sync first.");
  try {
    const origin = remote.parseRepositoryAddress(data.syncConfig.url).origin;
    if (!await chrome.permissions.contains({ origins: [origin] })) {
      throw new Error("Open My Vocabulary and save the sync settings to allow this Git server.");
    }
    const remoteState = await remote.syncWithGit(fetchWithTimeout, data.syncConfig, data.syncState);
    return await serial(async () => {
      const latest = await localData();
      if (!sameConfig(latest.syncConfig, data.syncConfig)) {
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
      if (sameConfig(latest.syncConfig, data.syncConfig)) {
        await chrome.storage.local.set({ syncLastError: error.message });
      }
    });
    throw error;
  }
}

function sameConfig(left, right) {
  return left && right && ["url", "username", "password", "branch"]
    .every((key) => left[key] === right[key]);
}

function syncNow() {
  if (syncPromise) return syncPromise;
  syncPromise = performSync().finally(() => { syncPromise = null; });
  return syncPromise;
}

async function configure(address, explicitToken, explicitUsername, branch) {
  await serial(async () => {
    const parsed = remote.parseRepositoryAddress(address);
    if (parsed.url.toLowerCase().replace(/\.git$/, "") === "https://github.com/linkcut-world/clever-youtube-subtitle") {
      throw new Error("Use a separate private repository for your words.");
    }
    const data = await localData();
    const previous = data.syncConfig?.url === parsed.url ? data.syncConfig : null;
    let username;
    let password;
    if (explicitToken) {
      username = String(explicitUsername || parsed.username || previous?.username || "git").trim();
      password = String(explicitToken);
    } else if (parsed.username || parsed.password) {
      username = String(explicitUsername || parsed.username).trim();
      password = parsed.password;
    } else {
      username = String(explicitUsername || previous?.username || "").trim();
      password = previous?.password || "";
    }
    if (!await chrome.permissions.contains({ origins: [parsed.origin] })) {
      throw new Error("Allow access to this Git server before saving sync settings.");
    }
    await chrome.storage.local.set({
      syncConfig: { url: parsed.url, username, password, branch: remote.validateBranch(branch) },
      syncLastError: ""
    });
  });
  if (syncPromise) await syncPromise.catch(() => {});
  return syncNow();
}

async function status() {
  const data = await localData();
  return {
    repositoryUrl: data.syncConfig?.url || "",
    branch: data.syncConfig?.branch || "",
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
    "sync:configure": () => configure(message.address, message.token, message.username, message.branch),
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

async function ensurePeriodicAlarm() {
  const alarm = await chrome.alarms.get(PERIODIC_ALARM);
  if (!alarm) await chrome.alarms.create(PERIODIC_ALARM, { periodInMinutes: 5 });
}

async function resumeSync() {
  await ensurePeriodicAlarm();
  const data = await serial(localData);
  if (data.syncConfig) await syncNow();
}

// The browser may discard alarms on exit or extension update. These listeners
// wake this worker even when the user has not opened an extension page.
chrome.runtime.onStartup.addListener(() => resumeSync().catch(() => {}));
chrome.runtime.onInstalled.addListener(() => resumeSync().catch(() => {}));
ensurePeriodicAlarm().catch(() => {});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === PERIODIC_ALARM || alarm.name === SOON_ALARM) {
    syncNow().catch(() => {});
  }
});
