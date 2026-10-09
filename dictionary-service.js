/* MIT. Provider routing and credentials stay in the extension's background. */
(function (root) {
  "use strict";
  const dictionary = root.CleverSubtitleDictionary;
  const microsoft = root.CleverSubtitleMicrosoftDictionary;
  function createService({ storage, permissions, fetcher, offlineStore }) {
    const store = offlineStore || root.CleverSubtitleDictionaryStore.createStore(root.indexedDB);
    const offline = dictionary.createDictionary((language, shard) => store.readShard(language, shard));
    const offlineRevisions = new Map();
    const online = microsoft.createMicrosoftDictionary(fetcher);
    let settingsRevision = 0;
    const keys = [dictionary.PROVIDER_KEY, dictionary.STORAGE_KEY, dictionary.MICROSOFT_CONFIG_KEY];
    async function status() {
      const data = await storage.get(keys);
      const provider = data[dictionary.PROVIDER_KEY] === "microsoft" ? "microsoft" : "offline";
      return { provider, configured: Boolean(data[dictionary.PROVIDER_KEY]),
        language: dictionary.languageFor(provider, data[dictionary.STORAGE_KEY]),
        offlineLanguages: dictionary.LANGUAGES.map((entry) => entry.code),
        hasKey: Boolean(data[dictionary.MICROSOFT_CONFIG_KEY]?.key),
        region: data[dictionary.MICROSOFT_CONFIG_KEY]?.region || "" };
    }
    async function requireAccess() {
      if (!await permissions.contains({ origins: [microsoft.ORIGIN] })) {
        throw new Error("Allow access to Microsoft in Settings → Dictionary.");
      }
    }
    async function lookup(query) {
      const data = await storage.get(keys);
      if (data[dictionary.PROVIDER_KEY] === "microsoft") {
        const language = dictionary.languageFor("microsoft", data[dictionary.STORAGE_KEY]);
        if (language === "off") throw new Error("Dictionary is off. Choose a language in Settings → Dictionary.");
        if (dictionary.microsoftLanguage(query.language) !== language) {
          throw new Error("Dictionary settings changed. Click the word again.");
        }
        await requireAccess();
        return online.lookup(query, data[dictionary.MICROSOFT_CONFIG_KEY]);
      }
      const metadata = dictionary.isOfflineLanguage(query.language) ? await store.metadata(query.language) : null;
      if (!metadata) {
        throw new Error("Download this offline dictionary first. Open Settings → Dictionary → Manage dictionaries.");
      }
      const revision = metadata.sha256 || metadata.version;
      if (offlineRevisions.get(query.language) !== revision) {
        offline.clear(); offlineRevisions.set(query.language, revision);
      }
      return offline.lookup(query);
    }
    async function configure({ provider, language, key, region, word = "hello" }) {
      const changeRevision = ++settingsRevision;
      if (!["offline", "microsoft"].includes(provider)) throw new Error("Choose a word meaning source.");
      const target = dictionary.languageFor(provider, language);
      if (typeof language !== "string" || !language) throw new Error("Choose a language under Translate to, then save.");
      if (language !== "off" && target === "off") {
        throw new Error("This language is not available for the selected dictionary. Reload the extension and reopen Settings, then choose a language again.");
      }
      const changes = { [dictionary.PROVIDER_KEY]: provider, [dictionary.STORAGE_KEY]: target };
      let result;
      if (provider === "microsoft" && target !== "off") {
        const data = await storage.get(keys);
        const config = microsoft.cleanConfig({ key: key || data[dictionary.MICROSOFT_CONFIG_KEY]?.key, region });
        await requireAccess();
        // Check before saving. A bad key or a failed connection leaves the last
        // working settings intact, and never saves a secret into Git sync state.
        result = await online.check({ word, language: target }, config);
        changes[dictionary.MICROSOFT_CONFIG_KEY] = config;
      } else if (provider === "offline" && target !== "off" && !await store.metadata(target)) {
        throw new Error("Download this offline dictionary first. Open Manage dictionaries.");
      }
      if (changeRevision !== settingsRevision) throw new Error("Dictionary settings changed. Please save again.");
      await storage.set(changes);
      return { ...await status(), result };
    }
    async function forgetKey() {
      settingsRevision++;
      const data = await storage.get(keys);
      online.clear();
      await storage.set({ [dictionary.MICROSOFT_CONFIG_KEY]: null,
        ...(data[dictionary.PROVIDER_KEY] === "microsoft" ? { [dictionary.STORAGE_KEY]: "off" } : {}) });
      return status();
    }
    return { lookup, configure, forgetKey, status, clearOffline: offline.clear };
  }
  root.CleverSubtitleDictionaryService = createService({ storage: chrome.storage.local,
    permissions: chrome.permissions, fetcher: (url, options) => fetch(url, options) });
  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area === "local" && changes[dictionary.PACK_REVISION_KEY]) root.CleverSubtitleDictionaryService.clearOffline();
  });
  root.CleverSubtitleDictionaryServiceFactory = { createService };
})(globalThis);
