(function (root) {
  "use strict";

  const words = root.CleverSubtitleWords ||
    (typeof module !== "undefined" && module.exports ? require("./word-utils.js") : null);

  function canonical(value) {
    return Array.isArray(value) ? words.parseWordList(value.join("\n")) : [];
  }

  function emptyState(existingWords = []) {
    return { version: 1, seed: canonical(existingWords), actions: {} };
  }

  function cleanState(value) {
    if (!value || value.version !== 1 || !Array.isArray(value.seed) ||
        !value.actions || typeof value.actions !== "object" || Array.isArray(value.actions)) {
      throw new Error("This repository has an invalid My Vocabulary file.");
    }
    const actions = Object.create(null);
    for (const [key, action] of Object.entries(value.actions)) {
      const word = words.normalizeWord(key);
      if (word !== key || !Array.isArray(action) || action.length !== 3 ||
          (action[0] !== 0 && action[0] !== 1) ||
          !Number.isSafeInteger(action[1]) || action[1] < 1 ||
          typeof action[2] !== "string" || !/^[a-z0-9_-]{1,64}$/i.test(action[2])) {
        throw new Error("This repository has an invalid My Vocabulary file.");
      }
      actions[word] = action;
    }
    return { version: 1, seed: canonical(value.seed), actions };
  }

  function compareActions(left, right) {
    if (left[1] !== right[1]) return left[1] - right[1];
    return left[2] < right[2] ? -1 : left[2] > right[2] ? 1 : left[0] - right[0];
  }

  function mergeStates(left, right) {
    const a = cleanState(left);
    const b = cleanState(right);
    const actions = Object.create(null);
    for (const word of new Set([...Object.keys(a.actions), ...Object.keys(b.actions)])) {
      const fromA = a.actions[word];
      const fromB = b.actions[word];
      actions[word] = !fromA ? fromB : !fromB ? fromA :
        compareActions(fromA, fromB) >= 0 ? fromA : fromB;
    }
    return { version: 1, seed: canonical([...a.seed, ...b.seed]), actions };
  }

  function effectiveWords(state) {
    const known = new Set(state.seed);
    for (const [word, action] of Object.entries(state.actions)) {
      if (action[0]) known.add(word);
      else known.delete(word);
    }
    return [...known].sort((a, b) => a.localeCompare(b, "en"));
  }

  function maxTimestamp(state) {
    return Object.values(state.actions).reduce((max, action) => Math.max(max, action[1]), 0);
  }

  function applyMutation(state, mutation, deviceId, lastClock, now = Date.now()) {
    const next = cleanState(state);
    const before = new Set(effectiveWords(next));
    const target = new Set(before);
    if (mutation && Object.hasOwn(mutation, "replace")) {
      if (!Array.isArray(mutation.replace)) throw new Error("Invalid word list.");
      target.clear();
      for (const word of canonical(mutation.replace)) target.add(word);
    } else {
      for (const word of canonical(mutation?.add)) target.add(word);
      for (const word of canonical(mutation?.remove)) target.delete(word);
    }
    let clock = Math.max(now, lastClock, maxTimestamp(next));
    for (const word of new Set([...before, ...target])) {
      if (before.has(word) === target.has(word)) continue;
      clock += 1;
      next.actions[word] = [target.has(word) ? 1 : 0, clock, deviceId];
    }
    return { state: next, words: effectiveWords(next), clock, changed: clock > Math.max(now, lastClock, maxTimestamp(state)) };
  }

  function equalStates(left, right) {
    const a = cleanState(left);
    const b = cleanState(right);
    if (a.seed.length !== b.seed.length || a.seed.some((word, index) => word !== b.seed[index])) return false;
    const keys = Object.keys(a.actions);
    return keys.length === Object.keys(b.actions).length && keys.every((key) =>
      b.actions[key] && compareActions(a.actions[key], b.actions[key]) === 0);
  }

  const api = { emptyState, cleanState, mergeStates, effectiveWords, maxTimestamp, applyMutation, equalStates };
  root.CleverSubtitleSyncModel = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
