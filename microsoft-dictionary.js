/* MIT. Official Microsoft Translator Dictionary Lookup; no sentence or examples. */
(function (root) {
  "use strict";
  const dictionary = root.CleverSubtitleDictionary;
  const ENDPOINT = "https://api.cognitive.microsofttranslator.com";
  const ORIGIN = `${ENDPOINT}/*`;
  const POS = { ADJ: "adjective", ADV: "adverb", CONJ: "conjunction", DET: "determiner",
    MODAL: "verb", NOUN: "noun", PREP: "preposition", PRON: "pronoun", VERB: "verb" };

  function cleanConfig(value) {
    const key = typeof value?.key === "string" ? value.key.trim() : "";
    if (!key) throw new Error("Enter your Microsoft key in Settings → Dictionary.");
    if (!/^[\x21-\x7e]{1,512}$/u.test(key)) throw new Error("Check your Microsoft key. Paste the key only.");
    let region = typeof value?.region === "string" ? value.region.trim().toLowerCase() : "";
    if (region === "global") region = "";
    if (region && !/^[a-z][a-z0-9]{0,63}$/u.test(region)) {
      throw new Error("Use the region code shown in Azure, such as eastus. Leave it empty for Global.");
    }
    return { key, region };
  }

  function responseEntries(value) {
    if (!Array.isArray(value) || value.length !== 1 || !Array.isArray(value[0]?.translations)) {
      throw new Error("Microsoft returned an invalid reply. Please try again.");
    }
    const translations = value[0].translations.map((entry, order) => ({ ...entry, order }))
      .sort((left, right) => (Number(right.confidence) || 0) - (Number(left.confidence) || 0) || left.order - right.order);
    const entries = [], seen = new Set();
    for (const entry of translations) {
      if (typeof entry.displayTarget !== "string") continue;
      const target = entry.displayTarget.trim();
      if (!target || target.length > 1000) continue;
      const prefix = typeof entry.prefixWord === "string" ? entry.prefixWord.trim() : "";
      const text = prefix && prefix.length <= 50 && !target.toLowerCase().startsWith(`${prefix.toLowerCase()} `)
        ? `${prefix} ${target}` : target;
      const signature = text.normalize("NFKC").toLowerCase();
      if (seen.has(signature)) continue;
      seen.add(signature);
      entries.push({ pos: POS[entry.posTag] || "", translations: [text] });
      if (entries.length === 3) break;
    }
    return entries;
  }

  function statusError(status) {
    if (status === 401) return "Microsoft could not check your key. Check the key and its Azure region.";
    if (status === 403) return "Your Microsoft resource cannot use Dictionary Lookup. Check it in Azure.";
    if (status === 429) return "Microsoft's request or monthly limit was reached. Please try later or check your Azure usage.";
    if (status === 400) return "Microsoft could not look up this word or language. Check your settings.";
    return "Microsoft is not available right now. Please try again.";
  }

  function createMicrosoftDictionary(fetcher, { timeoutMs = 12000, cacheLimit = 512,
    cacheMs = 12 * 60 * 60 * 1000, now = Date.now } = {}) {
    const cache = new Map(), pending = new Map();
    let activeConfig, revision = 0;
    function useConfig(config) {
      if (!activeConfig || config.key !== activeConfig.key || config.region !== activeConfig.region) {
        activeConfig = config;
        revision++;
        cache.clear(); pending.clear();
      }
    }
    async function read(word, language, config) {
      const key = JSON.stringify([language, word]);
      const hit = cache.get(key);
      if (hit && now() - hit.time < cacheMs) {
        cache.delete(key); cache.set(key, hit);
        return hit.entries;
      }
      cache.delete(key);
      if (pending.has(key)) return pending.get(key);
      const requestRevision = revision;
      const task = (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const url = `${ENDPOINT}/dictionary/lookup?api-version=3.0&from=en&to=${encodeURIComponent(language)}`;
          const headers = { "Content-Type": "application/json", "Ocp-Apim-Subscription-Key": config.key };
          if (config.region) headers["Ocp-Apim-Subscription-Region"] = config.region;
          let response;
          try {
            response = await fetcher(url, { method: "POST", headers,
              body: JSON.stringify([{ Text: word }]), signal: controller.signal,
              credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
          } catch (error) {
            throw new Error(controller.signal.aborted
              ? "Microsoft took too long to reply. Please try again."
              : "Could not reach Microsoft. Check your connection and try again.");
          }
          if (!response.ok) throw new Error(statusError(response.status));
          let data;
          try { data = await response.json(); }
          catch (error) { throw new Error("Microsoft returned an invalid reply. Please try again."); }
          const entries = responseEntries(data);
          if (requestRevision === revision) {
            cache.set(key, { entries, time: now() });
            while (cache.size > cacheLimit) cache.delete(cache.keys().next().value);
          }
          return entries;
        } finally { clearTimeout(timer); }
      })();
      pending.set(key, task);
      try { return await task; }
      finally { if (pending.get(key) === task) pending.delete(key); }
    }
    async function lookup(query, rawConfig) {
      if (!dictionary.isMicrosoftLanguage(query.language)) throw new Error("Choose a Microsoft dictionary language in Settings → Dictionary.");
      const candidates = dictionary.candidatesFor(query);
      if (!candidates.length) throw new Error("Enter a word to look up.");
      if (candidates.some((word) => word.length > 100)) throw new Error("This word is too long to look up.");
      const config = cleanConfig(rawConfig);
      useConfig(config);
      const language = dictionary.microsoftLanguage(query.language);
      const lookupRevision = revision;
      for (const word of candidates) {
        if (lookupRevision !== revision) throw new Error("Dictionary settings changed. Click the word again.");
        const entries = await read(word, language, config);
        if (entries.length) return { word, language: query.language, entries };
      }
      return { word: candidates[0] || "", language: query.language, entries: [] };
    }
    function clear() { activeConfig = undefined; revision++; cache.clear(); pending.clear(); }
    async function check(query, config) { clear(); return lookup(query, config); }
    return { lookup, check, clear };
  }
  const api = { ENDPOINT, ORIGIN, cleanConfig, responseEntries, createMicrosoftDictionary };
  root.CleverSubtitleMicrosoftDictionary = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
