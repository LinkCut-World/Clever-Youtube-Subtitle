const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("./sync-model.js");

test("independent device edits merge without losing words", () => {
  const seed = model.emptyState(["like", "apple"]);
  const computer = model.applyMutation(seed, { add: ["listen"] }, "device-a", 0, 100).state;
  const phone = model.applyMutation(seed, { remove: ["like"] }, "device-b", 0, 101).state;
  assert.deepEqual(model.effectiveWords(model.mergeStates(computer, phone)), ["apple", "listen"]);
  assert.deepEqual(model.effectiveWords(model.mergeStates(phone, computer)), ["apple", "listen"]);
});

test("later action on the same word wins and deletion survives an old seed", () => {
  const seed = model.emptyState(["like"]);
  const removed = model.applyMutation(seed, { remove: ["like"] }, "device-a", 0, 100).state;
  const added = model.applyMutation(removed, { add: ["like"] }, "device-b", 100, 110).state;
  assert.deepEqual(model.effectiveWords(model.mergeStates(removed, model.emptyState(["like"]))), []);
  assert.deepEqual(model.effectiveWords(model.mergeStates(removed, added)), ["like"]);
});

test("equal timestamps resolve deterministically, and new actions follow observed time", () => {
  const a = model.applyMutation(model.emptyState(), { add: ["like"] }, "device-a", 0, 100).state;
  const b = model.applyMutation(model.emptyState(["like"]), { remove: ["like"] }, "device-b", 0, 100).state;
  const merged = model.mergeStates(a, b);
  assert.deepEqual(model.effectiveWords(merged), []);
  const later = model.applyMutation(merged, { add: ["like"] }, "device-a", 0, 20);
  assert.ok(later.state.actions.like[1] > merged.actions.like[1]);
  assert.deepEqual(later.words, ["like"]);
});

test("replace creates removals and scales to fifteen thousand words", () => {
  const words = Array.from({ length: 15000 }, (_, index) => `word${index}`);
  const state = model.emptyState(words);
  const result = model.applyMutation(state, { replace: ["word1", "new"] }, "device-a", 0, 100);
  assert.deepEqual(result.words, ["new", "word1"]);
  assert.equal(Object.keys(result.state.actions).length, 15000);
  assert.equal(model.equalStates(result.state, model.cleanState(result.state)), true);
});
