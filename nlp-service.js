/* MIT. Shares one unmodified MorphoDiTa model in the extension service worker. */
(function (root) {
  "use strict";
  function createService(loadEngine) {
    let ready;
    const cache = new Map();
    async function analyze(text) {
      if (typeof text !== "string" || text.length > 50000) throw new Error("Caption text is too long or invalid.");
      if (!text.trim()) return [];
      if (cache.has(text)) {
        const hit = cache.get(text);
        cache.delete(text); cache.set(text, hit);
        return hit;
      }
      ready ||= Promise.resolve().then(loadEngine).catch((error) => { ready = null; throw error; });
      const result = ready.then((engine) => engine.analyze(text));
      cache.set(text, result);
      if (cache.size > 32) cache.delete(cache.keys().next().value);
      try { return await result; }
      catch (error) { if (cache.get(text) === result) cache.delete(text); throw error; }
    }
    return { analyze };
  }
  const service = createService(async () => {
    const response = await fetch(chrome.runtime.getURL("morphodita/english-model.tagger"));
    if (!response.ok) throw new Error("Could not load the English word model.");
    return root.createMorphoEngine(root.createMorphoModule, new Uint8Array(await response.arrayBuffer()), {
      locateFile: (name) => chrome.runtime.getURL(`morphodita/${name}`)
    });
  });
  root.CleverSubtitleNLPService = service;
  if (typeof module !== "undefined" && module.exports) module.exports = { createService };
})(globalThis);
