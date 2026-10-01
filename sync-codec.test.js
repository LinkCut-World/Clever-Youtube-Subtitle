const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("./sync-model.js");
const codec = require("./sync-codec.js");

test("compressed file round trips fifteen thousand words and removal records", async () => {
  const words = Array.from({ length: 15000 }, (_, index) => `longerword${index}`);
  const state = model.applyMutation(model.emptyState(words), { replace: ["longerword1"] }, "device-a", 0, 100).state;
  const encoded = await codec.encodeState(state);
  assert.ok(encoded.length < 1_000_000);
  assert.equal(model.equalStates(await codec.decodeState(encoded), state), true);
});
