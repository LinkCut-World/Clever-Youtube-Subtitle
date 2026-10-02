// Derive a small verb-form table from the pinned, MIT-licensed wink model.
// These model internals are used only at build time, never in the extension.
const fs = require("node:fs");
const model = require("wink-eng-lite-web-model");
const core = model.core();
const cache = require("wink-nlp/src/cache")(core, model.featureFn);
const entries = [];

for (let index = 0; index < cache.intrinsicSize(); index++) {
  const word = cache.value(index);
  if (!/^[a-z]+ing$/.test(word) || !cache.isMemberPOS(index, core.pos.hash.VERB)) continue;
  const lemma = model.addons.lemmatize(word, "VERB", cache);
  // Both the source form and its base must be verbs in the model dictionary.
  if (lemma !== word && cache.hasSamePOS(lemma, "VERB")) entries.push([word, lemma]);
}
entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
fs.writeFileSync("gerund-bases.json", JSON.stringify(Object.fromEntries(entries)) + "\n");
console.log(`Built ${entries.length} dictionary-checked gerund forms.`);
