(function (root) {
  "use strict";

  const PAGE_SIZE = 50;
  const wordUtils = root.CleverSubtitleWords ||
    (typeof module !== "undefined" && module.exports ? require("./word-utils.js") : null);

  function canonicalWords(value) {
    if (!Array.isArray(value)) return [];
    return wordUtils.parseWordList(value.join("\n"));
  }

  function mergeWords(existing, incoming) {
    return [...new Set([...existing, ...incoming])]
      .sort((a, b) => a.localeCompare(b, "en"));
  }

  function searchWords(words, query) {
    const needle = String(query).normalize("NFKC").trim().toLocaleLowerCase("en-US");
    return needle ? words.filter((word) => word.includes(needle)) : words;
  }

  function pageWords(words, requestedPage, pageSize = PAGE_SIZE) {
    const pageCount = Math.max(1, Math.ceil(words.length / pageSize));
    const page = Math.min(Math.max(1, requestedPage), pageCount);
    const start = (page - 1) * pageSize;
    return { page, pageCount, items: words.slice(start, start + pageSize) };
  }

  const api = { PAGE_SIZE, canonicalWords, mergeWords, searchWords, pageWords };
  root.CleverSubtitleVocabulary = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
