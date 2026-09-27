const test = require("node:test");
const assert = require("node:assert/strict");
const { canonicalWords, mergeWords, searchWords, pageWords } = require("./vocabulary.js");

test("imported words are normalized and merging skips duplicates", () => {
  const existing = canonicalWords(["LIKE", "apple", "like"]);
  assert.deepEqual(existing, ["apple", "like"]);
  assert.deepEqual(mergeWords(existing, ["like", "listen"]), ["apple", "like", "listen"]);
});

test("search and pagination work with fifteen thousand words", () => {
  const words = Array.from({ length: 15000 }, (_, index) => `word${String(index).padStart(5, "0")}`);
  const matching = searchWords(words, "WORD149");
  assert.equal(matching.length, 100);
  assert.equal(matching[0], "word14900");
  const secondPage = pageWords(matching, 2);
  assert.equal(secondPage.pageCount, 2);
  assert.equal(secondPage.items.length, 50);
  assert.equal(secondPage.items[0], "word14950");
  assert.deepEqual(pageWords([], 999), { page: 1, pageCount: 1, items: [] });
});
