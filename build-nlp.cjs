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
for (const file of ["morphodita/engine.js", "nlp-service.js", "nlp-client.js", "THIRD_PARTY_LICENSES.txt",
  "third-party/MorphoDiTa-MPL-2.0.txt", "third-party/MorphoDiTa-Model-CC-BY-NC-SA-3.0.txt",
  "third-party/MorphoDiTa-Model-README.txt", "third-party/Emscripten-LICENSE.txt"]) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing runtime or notice: ${file}`);
}
console.log("MorphoDiTa runtime and license files verified. No NLP bundle generation is needed.");
