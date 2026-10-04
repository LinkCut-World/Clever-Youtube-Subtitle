const test = require("node:test");
const assert = require("node:assert/strict");
const words = require("./word-utils.js");
const { createStream } = require("./caption-stream.js");
const model = require("./nlp-test-helper.cjs");
test.before(model.loadEngine);
const tick = () => new Promise(setImmediate);

function deferred() {
  const requests = [];
  const nlp = { peek: () => undefined, analyze(text) {
    return new Promise((resolve, reject) => requests.push({ text, resolve, reject }));
  } };
  const settle = async (index) => {
    requests[index].resolve(model.analyze(requests[index].text));
    await tick();
  };
  return { nlp, requests, settle };
}

test("append retains occurrences and applies useful older results before processing only the latest snapshot", async () => {
  const { nlp, requests, settle } = deferred();
  const stream = createStream(nlp, words);
  const first = stream.update(["when you plug in", "it gives"]);
  const second = stream.update(["when you plug in", "it gives you 1"]);
  const latest = stream.update(["when you plug in", "it gives you 1 plus 4"]);
  assert.equal(latest.streaming, true);
  assert.deepEqual(latest.units.slice(0, first.units.length), first.units);
  assert.deepEqual(latest.units.slice(0, second.units.length), second.units);
  await tick();
  assert.equal(requests.length, 1, "Appends must not start concurrent model requests for this stream");
  await settle(0);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].text, "when you plug in it gives you 1 plus 4");
  const pending = stream.parts(["when you plug in", "it gives you 1 plus 4"], new Set(["give"])).flat();
  assert.equal(pending.find((part) => part.text === "gives").hidden, true);
  assert.equal(pending.find((part) => part.text === "gives").pending, false);
  assert.equal(pending.find((part) => part.text === "plus").pending, true);
  await settle(1);
  assert.equal(requests.length, 2, "The intermediate append should be coalesced");
  assert.ok(latest.units.every((unit) => unit.ready));
});

test("rolling retains the second line and finishes both its old snapshot and the removed history line", async () => {
  const { nlp, requests, settle } = deferred();
  const stream = createStream(nlp, words);
  const first = stream.update(["He likes her", "it gives you"]);
  await tick();
  const roll = stream.update(["it gives you", "one more"]);
  assert.equal(roll.kind, "roll");
  assert.equal(roll.removed.text, "He likes her");
  assert.deepEqual(roll.units.slice(0, 3), first.lines[1].units);
  await settle(0);
  assert.ok(roll.units.slice(0, 3).every((unit) => unit.ready));
  assert.ok(roll.removed.units.every((unit) => unit.ready));
  assert.equal(roll.units.at(-1).ready, false);
  assert.equal(requests[1].text, "He likes her it gives you one more");
  const history = stream.parts([roll.removed.text], new Set(["like"]), roll.removed.units)[0];
  assert.equal(history.find((part) => part.text === "likes").hidden, true);
  await settle(1);
  assert.ok(roll.units.every((unit) => unit.ready));
});

test("native row identity disambiguates identical lines and repeated word occurrences", () => {
  const stream = createStream({ peek: model.analyze }, words);
  const a = {}, b = {}, c = {};
  const first = stream.update([{ text: "like like", source: a }, { text: "like like", source: b }]);
  const roll = stream.update([{ text: "like like", source: b }, { text: "like", source: c }]);
  assert.equal(roll.kind, "roll");
  assert.equal(roll.removed.id, first.lines[0].id);
  assert.equal(roll.lines[0].id, first.lines[1].id);
  assert.deepEqual(roll.units.slice(0, 2).map((unit) => unit.id), first.lines[1].units.map((unit) => unit.id));
  assert.equal(new Set(roll.units.map((unit) => unit.id)).size, 3);
});

test("reflow and temporary blank gaps preserve occurrences without creating removed lines", () => {
  const stream = createStream({ peek: model.analyze }, words);
  const first = stream.update(["He likes her"]);
  const reflow = stream.update(["He likes", "her"]);
  assert.equal(reflow.kind, "reflow");
  assert.equal(reflow.streaming, false);
  assert.deepEqual(reflow.units, first.units);
  assert.equal(stream.update([]).removed, undefined);
  assert.deepEqual(stream.update(["He likes her"]).units, first.units);
  const a = {}, b = {};
  const before = stream.update([{ text: "He likes", source: a }, { text: "her", source: b }]);
  const recycled = stream.update([{ text: "He likes", source: b }, { text: "her", source: a }]);
  assert.deepEqual(recycled.units, before.units);
  assert.equal(recycled.removed, undefined);
});

test("new context updates the original model's lemma without clearing already analysed words", async () => {
  const { nlp, settle } = deferred();
  const stream = createStream(nlp, words);
  const first = stream.update(["saw"]);
  await tick();
  await settle(0);
  assert.equal(stream.parts(["saw"], new Set(["see"]))[0][0].hidden, false);
  const appended = stream.update(["saw him yesterday"]);
  assert.equal(appended.units[0].id, first.units[0].id);
  assert.equal(stream.parts(["saw him yesterday"], new Set(["see"]))[0][0].pending, false);
  await tick();
  await settle(1);
  const saw = stream.parts(["saw him yesterday"], new Set(["see"]))[0][0];
  assert.equal(saw.addWord, "see");
  assert.equal(saw.hidden, true);
});

test("reset prevents late results from changing new occurrences, while frozen history can still finish", async () => {
  const { nlp, settle } = deferred();
  const stream = createStream(nlp, words);
  const old = stream.update(["He likes her"]);
  await tick();
  stream.reset();
  const next = stream.update(["it gives you 1"]);
  await tick();
  await settle(1);
  const ids = next.units.map((unit) => unit.id);
  await settle(0);
  assert.deepEqual(next.units.map((unit) => unit.id), ids);
  assert.equal(stream.parts(["it gives you 1"], new Set(["give"]))[0]
    .find((part) => part.text === "gives").hidden, true);
  assert.ok(!old.units.some((unit) => ids.includes(unit.id)));
});

test("matching saved words uses existing model results for contractions and changes without another request", () => {
  let lookups = 0;
  const stream = createStream({ peek(text) { lookups++; return model.analyze(text); } }, words);
  stream.update(["Don't stop."]);
  assert.equal(stream.parts(["Don't stop."], new Set(["do"]))[0][0].hidden, false);
  assert.equal(stream.parts(["Don't stop."], new Set(["do", "not"]))[0][0].hidden, true);
  stream.update(["Don't stop."]);
  assert.equal(lookups, 1);
});

test("analysis failure settles the current and coalesced snapshots into exact matching", async () => {
  const { nlp, requests } = deferred();
  const stream = createStream(nlp, words);
  stream.update(["He likes"]);
  const next = stream.update(["He likes her"]);
  await tick();
  requests[0].reject(new Error("Model unavailable"));
  await tick();
  assert.equal(next.units[0].ready, true);
  assert.equal(requests.length, 2);
  requests[1].reject(new Error("Model still unavailable"));
  await tick();
  const parts = stream.parts(["He likes her"], new Set(["he", "like", "her"]))[0];
  assert.equal(parts.find((part) => part.text === "He").hidden, true);
  assert.equal(parts.find((part) => part.text === "likes").hidden, false);
  assert.ok(parts.every((part) => !part.pending));
  stream.update(["He likes her"]);
  await tick();
  assert.equal(requests.length, 2);
});

test("frozen history whose queued snapshot was discarded finishes from its saved context", async () => {
  const { nlp, requests, settle } = deferred();
  const stream = createStream(nlp, words);
  stream.update(["He"]);
  await tick();
  stream.update(["He likes her", "it gives you"]);
  const history = stream.update(["it gives you", "one more"]).removed;
  assert.equal(history.units[1].ready, false);
  stream.update(["A completely new caption"]);
  stream.finish(history);
  stream.finish(history);
  await tick();
  assert.equal(requests.length, 3, "Only one extra request should finish the frozen history");
  assert.equal(requests[2].text, "He likes her it gives you one more");
  await settle(2);
  assert.equal(stream.parts([history.text], new Set(["like"]), history.units)[0]
    .find((part) => part.text === "likes").hidden, true);
  await settle(0);
  await settle(1);
  assert.equal(requests.length, 3);
  assert.ok(history.units.every((unit) => unit.ready));
});
