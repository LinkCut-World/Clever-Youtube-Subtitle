const fs = require("node:fs");
const path = require("node:path");
let engine;
let ready;
function loadEngine() {
  ready ||= require("./morphodita/engine.js")(
    require("./morphodita/morphodita.js"),
    fs.readFileSync(path.join(__dirname, "morphodita/english-model.tagger")),
    { wasmBinary: fs.readFileSync(path.join(__dirname, "morphodita/morphodita.wasm")) }
  ).then((value) => { engine = value; return value; });
  return ready;
}
function analyze(text) {
  if (!engine) throw new Error("Load the original model before running NLP integration tests.");
  return engine.analyze(text);
}
module.exports = { loadEngine, analyze };
