// Small, attributed test excerpts. Full dictionary data is never a runtime dependency.
const fs = require("node:fs");
const dictionary = require("./dictionary.js");
const excerpts = JSON.parse(fs.readFileSync("test-fixtures/dictionary.json", "utf8"));
async function load(language, shard) {
  return Object.fromEntries(Object.entries(excerpts[language] || {})
    .filter(([word]) => dictionary.shardFor(word) === shard));
}
module.exports = { load, excerpts };
