/* MIT. Local caption cache; messages never contain the user's vocabulary. */
(function (root) {
  "use strict";
  function createClient(sendMessage, warn = () => {}) {
    const cache = new Map(), pending = new Map();
    function remember(text, tokens) {
      cache.delete(text); cache.set(text, tokens);
      if (cache.size > 32) cache.delete(cache.keys().next().value);
      return tokens;
    }
    return {
      peek: (text) => cache.get(text),
      analyze(text) {
        if (cache.has(text)) return Promise.resolve(cache.get(text));
        if (pending.has(text)) return pending.get(text);
        const task = Promise.resolve().then(() => sendMessage({ type: "nlp:analyze", text }))
          .then((response) => {
            if (!response?.ok || !Array.isArray(response.tokens)) throw new Error(response?.error || "Could not read this caption.");
            return remember(text, response.tokens);
          }).catch((error) => {
            warn(error);
            // A failed caption still supports exact-word matching. A new caption
            // retries the service; never start a DOM-mutation retry loop.
            return remember(text, []);
          }).finally(() => pending.delete(text));
        pending.set(text, task);
        return task;
      }
    };
  }
  if (root.chrome?.runtime?.sendMessage) {
    root.CleverSubtitleNLP = createClient(
      (message) => chrome.runtime.sendMessage(message),
      (error) => console.warn("Clever Youtube Subtitle: word model unavailable; matching exact words", error)
    );
  }
  if (typeof module !== "undefined" && module.exports) module.exports = { createClient };
})(globalThis);
