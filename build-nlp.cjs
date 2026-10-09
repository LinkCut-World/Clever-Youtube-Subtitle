"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = __dirname;
const provenance = JSON.parse(fs.readFileSync(path.join(root, "morphodita/provenance.json")));
for (const [name, expected] of [
  ["english-model.tagger", provenance.modelSha256],
  ["morphodita.wasm", provenance.wasmSha256],
  ["morphodita.js", provenance.glueSha256]
]) {
  const bytes = fs.readFileSync(path.join(root, "morphodita", name));
  if (crypto.createHash("sha256").update(bytes).digest("hex") !== expected) {
    throw new Error(`Unexpected ${name} hash. Rebuild from the pinned source and update provenance together.`);
  }
}
for (const file of ["morphodita/engine.js", "nlp-service.js", "nlp-client.js", "caption-stream.js", "THIRD_PARTY_LICENSES.txt",
  "third-party/MorphoDiTa-MPL-2.0.txt", "third-party/MorphoDiTa-Model-CC-BY-NC-SA-3.0.txt",
  "third-party/MorphoDiTa-Model-README.txt", "third-party/Emscripten-LICENSE.txt"]) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing runtime or notice: ${file}`);
}
console.log("MorphoDiTa runtime and license files verified. No NLP bundle generation is needed.");
const dictionary = require("./dictionary-catalog.js");
if (dictionary.packs.some((entry) => !entry.url.startsWith("https://download.wikdict.com/"))) {
  throw new Error("Offline dictionaries must use WikDict's official server.");
}
const sqlite = JSON.parse(fs.readFileSync(path.join(root, "sqlite/provenance.json")));
for (const asset of sqlite.assets) {
  const bytes = fs.readFileSync(path.join(root, "sqlite", asset.file));
  if (bytes.length !== asset.bytes || crypto.createHash("sha256").update(bytes).digest("hex") !== asset.sha256) {
    throw new Error(`Unexpected SQLite reader: ${asset.file}`);
  }
}
for (const file of ["dictionary.js", "dictionary-service.js", "microsoft-dictionary.js", "dictionary-settings.js", "word-meaning.js", "caption-interaction.js",
  "dictionary-store.js", "dictionary-packs.js", "dictionary-manager.js", "dictionaries.html", "wikdict-sqlite.js", "wikdict-client.js", "wikdict-worker.js",
  "third-party/WikDict-NOTICE.txt", "third-party/Dictionary-CC-BY-SA-4.0.txt", "third-party/SQL-js-MIT.txt"]) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing dictionary runtime or notice: ${file}`);
}
console.log("Dictionary runtime and notices verified. No word dictionary is bundled.");
