/* MIT. Installed dictionaries use IndexedDB, separate from vocabulary and keys. */
(function (root) {
  "use strict";
  const DB_NAME = "clever-subtitle-dictionaries";
  function createStore(indexedDB) {
    let opened;
    function open() {
      if (!indexedDB) return Promise.reject(new Error("Offline dictionary storage is not available in this browser."));
      if (!opened) opened = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          db.createObjectStore("packs", { keyPath: "language" });
          db.createObjectStore("shards", { keyPath: ["language", "shard"] });
        };
        request.onerror = () => reject(new Error("Could not open offline dictionary storage."));
        request.onblocked = () => reject(new Error("Close other dictionary pages and try again."));
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => { db.close(); opened = undefined; };
          resolve(db);
        };
      }).catch((error) => { opened = undefined; throw error; });
      return opened;
    }
    async function read(store, key) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const request = db.transaction(store, "readonly").objectStore(store).get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error("Could not read the offline dictionary."));
      });
    }
    async function list() {
      const db = await open();
      return new Promise((resolve, reject) => {
        const request = db.transaction("packs", "readonly").objectStore("packs").getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error("Could not read installed dictionaries."));
      });
    }
    async function write(language, shards, metadata) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(["packs", "shards"], "readwrite");
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => {};
        transaction.onabort = () => reject(new Error("Could not save the dictionary. Your previous dictionary is still available. Check free space and try again."));
        const store = transaction.objectStore("shards");
        // Replacement/deletion and its installed marker are one transaction.
        try {
          for (let number = 0; number < 128; number++) {
            const shard = number.toString(16).padStart(2, "0");
            if (shards) store.put({ language, shard, data: shards[shard] });
            else store.delete([language, shard]);
          }
          if (metadata) transaction.objectStore("packs").put(metadata);
          else transaction.objectStore("packs").delete(language);
        } catch (error) { transaction.abort(); }
      });
    }
    async function install(pack, metadata) {
      const shards = Object.fromEntries(Array.from({ length: 128 }, (_, number) =>
        [number.toString(16).padStart(2, "0"), Object.create(null)]));
      for (const [word, entries] of Object.entries(pack.data)) shards[root.CleverSubtitleDictionary.shardFor(word)][word] = entries;
      await write(pack.language, shards, metadata);
    }
    async function readShard(language, shard) {
      const value = await read("shards", [language, shard]);
      if (!value) throw new Error("Download this offline dictionary first. Open Settings → Dictionary → Manage dictionaries.");
      return value.data;
    }
    return { list, metadata: (language) => read("packs", language), readShard, install,
      remove: (language) => write(language, null, null) };
  }
  const api = { DB_NAME, createStore };
  root.CleverSubtitleDictionaryStore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
