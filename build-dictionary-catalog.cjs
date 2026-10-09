"use strict";
const fs = require("node:fs"), path = require("node:path");
const root = __dirname, source = JSON.parse(fs.readFileSync(path.join(root, "dictionary-sources.json")));
const packs = source.packs.map((entry) => ({ language: entry.language, name: entry.name, englishName: entry.englishName,
  version: source.sourceVersion, words: entry.words, bytes: entry.bytes, unpackedBytes: entry.dataBytes,
  sha256: entry.sourceSha256, sourceSha256: entry.sourceSha256, url: entry.sourceUrl, file: `en-${entry.language}.sqlite3`,
  license: source.license, format: "wikdict-sqlite" }));
if (packs.some((entry) => !Number.isInteger(entry.words) || entry.words < 1 || !Number.isInteger(entry.bytes) || entry.bytes < 16 ||
    !/^https:\/\/download\.wikdict\.com\/dictionaries\/sqlite\//u.test(entry.url))) {
  throw new Error("Invalid official dictionary source metadata.");
}
const catalog = { sourceVersion: source.sourceVersion, origins: ["https://download.wikdict.com/*"], packs };
fs.writeFileSync(path.join(root, "dictionary-catalog.js"), "/* MIT. Official download metadata only; no dictionary entries are bundled. */\n" +
  "(function (root) {\n  const catalog = " + JSON.stringify(catalog, null, 2) + ";\n" +
  "  root.CleverSubtitleDictionaryCatalog = catalog;\n  if (typeof module !== 'undefined' && module.exports) module.exports = catalog;\n})(globalThis);\n");
console.log(`Generated ${packs.length} direct WikDict download entries.`);
