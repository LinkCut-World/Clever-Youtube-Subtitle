/* MIT. One installation per worker; the page terminates it to release SQLite. */
"use strict";
importScripts("sqlite/sql-wasm.js", "word-utils.js", "dictionary-catalog.js", "dictionary.js",
  "dictionary-store.js", "wikdict-sqlite.js");

self.onmessage = async ({ data }) => {
  try {
    const entry = CleverSubtitleDictionaryCatalog.packs.find((pack) => pack.language === data.language);
    if (!entry || !(data.buffer instanceof ArrayBuffer) || data.buffer.byteLength !== entry.bytes) {
      throw new Error("Choose a listed official WikDict file.");
    }
    const SQL = await initSqlJs({ locateFile: (file) => new URL(`sqlite/${file}`, self.location.href).href });
    const pack = CleverSubtitleWikDictSQLite.convert(SQL, new Uint8Array(data.buffer), entry,
      (progress) => self.postMessage({ type: "progress", progress }));
    const metadata = { language: entry.language, version: entry.version, sha256: entry.sha256,
      sourceSha256: entry.sha256, sourceUrl: entry.url, format: "wikdict-sqlite", words: pack.words,
      bytes: entry.bytes, unpackedBytes: new Blob([JSON.stringify(pack.data)]).size,
      installedAt: new Date().toISOString() };
    self.postMessage({ type: "progress", progress: { phase: "save" } });
    const store = CleverSubtitleDictionaryStore.createStore(indexedDB);
    await store.install(pack, metadata);
    self.postMessage({ type: "result", metadata });
  } catch (error) {
    self.postMessage({ type: "error", error: error.message || "Could not install this dictionary. Please try again." });
  }
};
