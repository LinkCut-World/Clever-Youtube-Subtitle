/* MIT. Direct official WikDict SQLite downloads, verified before on-device installation. */
(function (root) {
  "use strict";
  function createPacks({ catalog, store, fetcher, crypto, storage, installSQLite,
    notify = () => {}, timeoutMs = 180000 }) {
    const dictionary = root.CleverSubtitleDictionary;
    function entryFor(language) {
      const entry = catalog.packs.find((pack) => pack.language === language);
      if (!entry) throw new Error("Choose a listed offline dictionary.");
      return entry;
    }
    async function collect(stream, limit, onProgress = () => {}) {
      const reader = stream.getReader(), chunks = [];
      let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > limit) throw new Error("This dictionary file is too large.");
          chunks.push(value); onProgress(length);
        }
      } catch (error) { await reader.cancel().catch(() => {}); throw error; }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return bytes;
    }
    async function decode(bytes, expected) {
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
        .map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const entry = expected || catalog.packs.find((pack) => pack.sha256 === hash);
      if (!entry || bytes.byteLength !== entry.bytes || hash !== entry.sha256) {
        throw new Error("This file does not match a listed WikDict version. Get the official .sqlite3 file from Get file.");
      }
      if (bytes.length < 16 || new TextDecoder().decode(bytes.subarray(0, 16)) !== "SQLite format 3\0") {
        throw new Error("Choose an official WikDict SQLite file (.sqlite3).");
      }
      return { bytes, entry };
    }
    async function changed() {
      notify();
      await storage.set({ [dictionary.PACK_REVISION_KEY]: `${Date.now()}-${Math.random()}` }).catch(() => {});
    }
    async function install(bytes, expected, onProgress) {
      const decoded = await decode(bytes, expected);
      const metadata = await installSQLite(decoded.bytes, decoded.entry, onProgress);
      await changed();
      return metadata;
    }
    async function download(language, onProgress = () => {}) {
      const entry = entryFor(language), controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetcher(entry.url, { signal: controller.signal, credentials: "omit",
          redirect: "error", referrerPolicy: "no-referrer" });
        if (response.status === 404) throw new Error("WikDict could not find this dictionary version. Check the official downloads page or try again later.");
        if (!response.ok || !response.body) throw new Error("Could not download from WikDict. Try again or import the official file.");
        const bytes = await collect(response.body, entry.bytes, (length) => onProgress(length, { phase: "download" }));
        clearTimeout(timer);
        return await install(bytes, entry, (progress) => onProgress(0, progress));
      } catch (error) {
        if (controller.signal.aborted) throw new Error("WikDict download timed out. Try again or import the official file.");
        if (error instanceof TypeError) throw new Error("Could not reach WikDict. Check your connection or import its official file.");
        throw error;
      } finally { clearTimeout(timer); }
    }
    async function importFile(file, onProgress) {
      const limit = Math.max(...catalog.packs.map((pack) => pack.bytes));
      if (!file || !file.size || file.size > limit) throw new Error("Choose a listed official WikDict file (.sqlite3).");
      return install(new Uint8Array(await file.arrayBuffer()), undefined, onProgress);
    }
    async function remove(language) { entryFor(language); await store.remove(language); await changed(); }
    return { list: store.list, download, importFile, remove, decode };
  }
  const api = { createPacks };
  root.CleverSubtitleDictionaryPacks = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
