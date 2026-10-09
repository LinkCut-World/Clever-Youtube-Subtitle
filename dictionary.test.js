const test = require("node:test");
const assert = require("node:assert/strict");
require("./word-utils.js");
const dictionary = require("./dictionary.js");
const catalog = require("./dictionary-catalog.js");
const { load } = require("./dictionary-test-helper.cjs");

test("offline languages come from the complete catalog and grammar labels do not depend on catalog order", () => {
  assert.deepEqual(dictionary.LANGUAGES.map((entry) => entry.code), catalog.packs.map((entry) => entry.language));
  assert.equal(dictionary.LANGUAGES.length, 25);
  for (const language of ["ru", "it", "pt", "mg", "no"]) assert.equal(dictionary.isOfflineLanguage(language), true);
  assert.equal(dictionary.partOfSpeech("noun", "zh"), "名词");
  assert.equal(dictionary.partOfSpeech("noun", "es"), "sustantivo");
  assert.equal(dictionary.partOfSpeech("noun", "fr"), "nom");
  assert.equal(dictionary.partOfSpeech("noun", "de"), "Nomen");
  assert.equal(dictionary.partOfSpeech("noun", "ja"), "名詞");
  assert.equal(dictionary.partOfSpeech("noun", "ru"), "noun");
});

test("dictionary excerpts return real translations in five languages and no result for absent words", async () => {
  const service = dictionary.createDictionary(load);
  const expected = { zh: "明白", es: "comprender", fr: "comprendre", de: "verstehen", ja: "分かる" };
  for (const [language, translation] of Object.entries(expected)) {
    const result = await service.lookup({ word: "UNDERSTANDING!", lemma: "understand", language });
    assert.equal(result.word, "understand");
    assert.ok(result.entries.some((entry) => entry.translations.includes(translation)), language);
    assert.ok(result.entries.some((entry) => entry.pos === "verb"));
  }
  const missing = await service.lookup({ word: "qqqnotarealwordqqq", language: "zh" });
  assert.deepEqual(missing.entries, []);
});

test("dictionary prefers the contextual lemma, falls back to the surface, and rejects arbitrary paths", async () => {
  const service = dictionary.createDictionary(load);
  const gives = await service.lookup({ word: "gives", lemma: "give", language: "zh" });
  assert.equal(gives.word, "give");
  assert.ok(gives.entries.some((entry) => entry.translations.includes("给")));
  const fallback = await service.lookup({ word: "like", lemma: "qqqmissingqqq", language: "zh" });
  assert.equal(fallback.word, "like");
  assert.ok(fallback.entries.some((entry) => entry.translations.includes("喜欢")));
  await assert.rejects(service.lookup({ word: "like", language: "../../private" }), /Choose a language/);
  await assert.rejects(service.lookup({ word: "a".repeat(121), language: "zh" }), /too long/);
  await assert.rejects(service.lookup({ word: {}, language: "zh" }), /too long/);
});

test("concurrent lookups share a local load; the shard cache is bounded and failed reads can retry", async () => {
  let reads = 0;
  const service = dictionary.createDictionary(async () => { reads++; return { like: [{ translations: ["喜欢"] }] }; });
  await Promise.all(Array.from({ length: 4 }, () => service.lookup({ word: "like", language: "zh" })));
  assert.equal(reads, 1);
  const unique = new Set([dictionary.shardFor("like")]);
  for (let i = 0; unique.size < 6; i++) {
    const word = `word${i}`;
    if (unique.has(dictionary.shardFor(word))) continue;
    unique.add(dictionary.shardFor(word));
    await service.lookup({ word, language: "zh" });
  }
  const previous = reads;
  await service.lookup({ word: "like", language: "zh" });
  assert.equal(reads, previous + 1);
  let attempts = 0;
  const retry = dictionary.createDictionary(async () => {
    if (++attempts === 1) throw new Error("missing file");
    return { like: [{ translations: ["喜欢"] }] };
  });
  await assert.rejects(retry.lookup({ word: "like", language: "zh" }), /missing file/);
  assert.equal((await retry.lookup({ word: "like", language: "zh" })).entries.length, 1);
});

test("entry-linked perilous meanings take priority over unlabelled reverse candidates", async () => {
  const service = dictionary.createDictionary(load);
  const result = await service.lookup({ word: "perilous", language: "zh" });
  assert.deepEqual(result.entries, [{ pos: "adjective", translations: ["危险"] }]);
});
