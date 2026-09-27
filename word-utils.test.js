const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { normalizeWord, parseWordList, captionParts, captionPartsForSegments } = require("./word-utils.js");

test("word lists are normalized, deduplicated, and case insensitive", () => {
  assert.deepEqual(parseWordList("Hello, WORLD\nhello; It's"), ["hello", "it's", "world"]);
  assert.equal(normalizeWord("“We’re!”"), "we're");
});

test("caption parts keep exact spacing while marking familiar words", () => {
  const known = new Set(parseWordList("I hello world"));
  const parts = captionParts("Hello,   curious\nworld!", known);
  assert.equal(parts.map((part) => part.text).join(""), "Hello,   curious\nworld!");
  assert.deepEqual(parts.filter((part) => part.hidden).map((part) => part.text), ["Hello,", "world!"]);
  assert.deepEqual(captionParts("HELLO, WORLD!", known).filter((part) => part.hidden).map((part) => part.text), ["HELLO,", "WORLD!"]);
});

test("base words cover regular and irregular English inflections", () => {
  const known = new Set(parseWordList("he like go child good"));
  const parts = captionParts("He likes her. He liked going with children, feeling better.", known);
  assert.deepEqual(
    parts.filter((part) => part.hidden).map((part) => part.text),
    ["He", "likes", "He", "liked", "going", "children,", "better."]
  );
  assert.equal(captionParts("likeness", known)[0].hidden, false);
});

test("the model uses caption context to distinguish verb and noun forms", () => {
  const known = new Set(parseWordList("see"));
  const parts = captionPartsForSegments(["I saw a", "saw."], known);
  assert.deepEqual(parts.map((segment) => segment.filter((part) => part.hidden).map((part) => part.text)), [["saw"], []]);
  assert.equal(parts[0].map((part) => part.text).join(""), "I saw a");
  assert.equal(parts[1].map((part) => part.text).join(""), "saw.");
});

test("visible inflected words offer their contextual base form for adding", () => {
  const parts = captionPartsForSegments(["He likes her", "I saw a saw."], new Set());
  assert.equal(parts[0][2].addWord, "like");
  assert.equal(parts[1][2].addWord, "see");
  assert.equal(parts[1][6].addWord, "saw");
  assert.equal(parts[0].map((part) => part.text).join(""), "He likes her");
});

test("hidden inflected words point to the saved word that can be removed", () => {
  const parts = captionParts("He likes her", new Set(["like"]));
  assert.equal(parts[2].hidden, true);
  assert.equal(parts[2].removeWord, "like");
});

test("a contraction is hidden only when all of its meaningful pieces are known", () => {
  assert.equal(captionParts("Don't stop.", new Set(["do"]))[0].hidden, false);
  assert.equal(captionParts("Don't stop.", new Set(["do", "not"]))[0].hidden, true);
});

test("the packaged browser model matches like to likes", () => {
  const context = { atob, Uint8Array, ArrayBuffer, DataView };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync("lemma-bundle.js", "utf8"), context);
  vm.runInNewContext(fs.readFileSync("word-utils.js", "utf8"), context);
  const parts = context.CleverSubtitleWords.captionParts("He likes her", new Set(["like"]));
  assert.equal(parts.map((part) => part.text).join(""), "He likes her");
  assert.equal(parts[0].hidden, false);
  assert.equal(parts[2].text, "likes");
  assert.equal(parts[2].hidden, true);
  assert.equal(parts[4].hidden, false);
});
