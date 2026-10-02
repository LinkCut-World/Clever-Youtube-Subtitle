const winkNLP = require("wink-nlp");
const model = require("wink-eng-lite-web-model");
globalThis.CleverSubtitleNLP = winkNLP(model);
globalThis.CleverSubtitleGerunds = require("./gerund-bases.json");
