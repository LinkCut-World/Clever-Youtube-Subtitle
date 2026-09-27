/* Shared by the popup, the YouTube content script, and the local tests. */
(function (root) {
  "use strict";

  const nlp = root.CleverSubtitleNLP ||
    (typeof module !== "undefined" && module.exports
      ? require("wink-nlp")(require("wink-eng-lite-web-model"))
      : null);

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

  function captionPartsForSegments(texts, knownWords) {
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

    if (nlp) {
      const tokens = nlp.readDoc(combined).tokens();
      const values = tokens.out(nlp.its.value);
      const spaces = tokens.out(nlp.its.precedingSpaces);
      const lemmas = tokens.out(nlp.its.lemma);

      // Only use model offsets if its tokens reconstruct the exact caption.
      // Otherwise the exact-word check below remains safe.
      if (values.map((value, index) => spaces[index] + value).join("") === combined) {
        let offset = 0;
        let wordIndex = 0;
        for (let index = 0; index < values.length; index++) {
          offset += spaces[index].length;
          const tokenStart = offset;
          const tokenEnd = tokenStart + values[index].length;
          offset = tokenEnd;
          if (!/[\p{L}\p{N}]/u.test(values[index])) continue;
          while (wordIndex < wordParts.length && wordParts[wordIndex].end <= tokenStart) wordIndex++;
          const wordPart = wordParts[wordIndex];
          if (wordPart && tokenStart >= wordPart.start && tokenEnd <= wordPart.end) {
            const lemma = normalizeWord(lemmas[index]);
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

  function captionParts(text, knownWords) {
    return captionPartsForSegments([text], knownWords)[0];
  }

  const api = { normalizeWord, parseWordList, captionPartsForSegments, captionParts };
  root.CleverSubtitleWords = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
