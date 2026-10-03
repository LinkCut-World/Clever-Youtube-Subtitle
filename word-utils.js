/* Shared by the popup, the YouTube content script, and the local tests. */
(function (root) {
  "use strict";

  function normalizeWord(value) {
    return String(value)
      .normalize("NFKC")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
      .toLocaleLowerCase("en-US");
  }

  function parseWordList(text) {
    const words = new Set();
    for (const part of String(text).split(/[\s,;]+/u)) {
      const word = normalizeWord(part);
      if (word) words.add(word);
    }
    return [...words].sort((a, b) => a.localeCompare(b, "en"));
  }

  function captionPartsForSegments(texts, knownWords, annotations = []) {
    const partsBySegment = [];
    const wordParts = [];
    let combined = "";

    for (const [index, value] of texts.entries()) {
      if (index) combined += " ";
      const text = String(value);
      const start = combined.length;
      combined += text;
      const parts = [];
      for (const match of text.matchAll(/\s+|\S+/gu)) {
        const part = { text: match[0], hidden: false };
        parts.push(part);
        if (!/^\s+$/u.test(part.text)) {
          part.addWord = normalizeWord(part.text);
          wordParts.push({ part, start: start + match.index, end: start + match.index + part.text.length, lemmas: [] });
        }
      }
      partsBySegment.push(parts);
    }

    if (wordParts.length === 0) return partsBySegment;

    if (Array.isArray(annotations) && annotations.length) {
      // Use the original model's UTF-16 ranges. Reject mismatched annotations
      // rather than assigning an old caption's lemmas to new words.
      let cursor = 0;
      const valid = annotations.every((token) => {
        const matches = Number.isInteger(token.start) && Number.isInteger(token.end) &&
          token.start >= cursor && token.end > token.start && token.end <= combined.length &&
          combined.slice(token.start, token.end) === token.form &&
          /^\s*$/u.test(combined.slice(cursor, token.start));
        cursor = token.end;
        return matches;
      }) && /^\s*$/u.test(combined.slice(cursor));
      if (valid) {
        let wordIndex = 0;
        for (const token of annotations) {
          const tokenStart = token.start;
          const tokenEnd = token.end;
          if (!/[\p{L}\p{N}]/u.test(token.form)) continue;
          while (wordIndex < wordParts.length && wordParts[wordIndex].end <= tokenStart) wordIndex++;
          const wordPart = wordParts[wordIndex];
          if (wordPart && tokenStart >= wordPart.start && tokenEnd <= wordPart.end) {
            const lemma = normalizeWord(token.lemma);
            if (lemma) wordPart.lemmas.push(lemma);
          }
        }
      }
    }

    for (const wordPart of wordParts) {
      const exact = normalizeWord(wordPart.part.text);
      // Prefer the contextual lemma when one token represents the whole word.
      // A contraction or compound can have several lemmas, so keep its surface form.
      if (wordPart.lemmas.length === 1) wordPart.part.addWord = wordPart.lemmas[0];
      const exactKnown = Boolean(exact && knownWords.has(exact));
      const lemmasKnown = Boolean(wordPart.lemmas.length &&
        wordPart.lemmas.every((lemma) => knownWords.has(lemma)));
      wordPart.part.hidden = exactKnown || lemmasKnown;
      // The remove action names an actual saved entry, even when the caption
      // shows an inflected form such as "likes" for the saved word "like".
      if (wordPart.part.hidden) {
        wordPart.part.removeWord = exactKnown ? exact : wordPart.lemmas[0];
      }
    }
    return partsBySegment;
  }

  function captionParts(text, knownWords, annotations) {
    return captionPartsForSegments([text], knownWords, annotations)[0];
  }

  const api = { normalizeWord, parseWordList, captionPartsForSegments, captionParts };
  root.CleverSubtitleWords = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
