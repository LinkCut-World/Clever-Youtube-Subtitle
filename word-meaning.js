/* MIT. The small word card shares the caption's selected-word lifetime. */
(function (root) {
  "use strict";
  function createCard(sendMessage, document, viewport) {
    const dictionary = root.CleverSubtitleDictionary;
    const normalize = root.CleverSubtitleWords.normalizeWord;
    let card, text, selected, key, language = "off", generation = 0;
    function position() {
      if (!card || card.hidden || !selected) return;
      const rect = selected.getBoundingClientRect();
      const width = Math.min(320, Math.max(0, viewport.innerWidth - 16));
      const height = viewport.innerHeight || document.documentElement.clientHeight || 720;
      const button = document.querySelector(".clever-subtitle-word-button");
      const buttonHeight = button?.offsetHeight || 36;
      const above = Math.max(0, rect.top - buttonHeight - 16);
      const below = Math.max(0, height - rect.bottom - 16);
      const onTop = above >= 180 || above > below;
      const available = onTop ? above : below;
      card.style.width = `${width}px`;
      card.style.maxHeight = `${Math.min(260, available)}px`;
      card.style.left = `${Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, viewport.innerWidth - width - 8))}px`;
      const cardHeight = Math.min(card.offsetHeight, available);
      card.style.top = `${onTop ? Math.max(8, rect.top - buttonHeight - cardHeight - 8) : rect.bottom + 8}px`;
    }
    function message(value) { text.textContent = value; position(); }
    function select(element) {
      selected = element;
      const word = normalize(element.textContent);
      const lemma = element.dataset.cleverLemma || word;
      const nextKey = JSON.stringify([language, word, lemma]);
      if (!card) {
        card = document.createElement("section");
        card.className = "clever-subtitle-meaning";
        card.setAttribute("role", "region");
        card.setAttribute("aria-label", "Dictionary result");
        card.setAttribute("aria-live", "polite");
        text = document.createElement("div");
        text.className = "clever-subtitle-meaning-text";
        card.appendChild(text);
      }
      const host = document.fullscreenElement || document.body;
      if (card.parentElement !== host) host.appendChild(card);
      card.hidden = false;
      position();
      if (key === nextKey) return;
      key = nextKey;
      const request = ++generation;
      if (!dictionary.isLanguage(language)) {
        message("Choose a language in Settings → Dictionary.");
        return;
      }
      message("Loading meanings…");
      Promise.resolve().then(() => sendMessage({ type: "dictionary:lookup", word, lemma, language }))
        .then((response) => {
          if (request !== generation || card.hidden) return;
          if (!response?.ok || !response.result || !Array.isArray(response.result.entries)) {
            throw new Error(response?.error || "Could not load meanings. Click the word to try again.");
          }
          const result = response.result;
          const fragment = document.createDocumentFragment();
          const heading = document.createElement("strong");
          heading.className = "clever-subtitle-meaning-word";
          heading.textContent = result.word || lemma || word;
          fragment.appendChild(heading);
          if (!result.entries.length) {
            const empty = document.createElement("p");
            empty.textContent = "No meaning found in this dictionary.";
            fragment.appendChild(empty);
          }
          const entries = [];
          const seen = new Set();
          for (const entry of result.entries) {
            const signature = JSON.stringify([entry.pos, [...entry.translations].sort()]);
            if (seen.has(signature)) continue;
            seen.add(signature);
            entries.push(entry);
            if (entries.length === 3) break;
          }
          for (const entry of entries) {
            const row = document.createElement("p");
            row.className = "clever-subtitle-meaning-entry";
            if (entry.pos) {
              const pos = document.createElement("span");
              pos.className = "clever-subtitle-meaning-pos";
              pos.lang = language;
              pos.textContent = `${dictionary.partOfSpeech(entry.pos, language)}: `;
              row.appendChild(pos);
            }
            const translation = document.createElement("span");
            translation.lang = language;
            translation.textContent = entry.translations.join("; ");
            row.appendChild(translation);
            fragment.appendChild(row);
          }
          text.replaceChildren(fragment);
          position();
        }).catch((error) => {
          if (request !== generation || card.hidden) return;
          key = null;
          message(error.message || "Could not load meanings. Click the word to try again.");
        });
    }
    return {
      select, position,
      refresh() { key = null; if (selected) select(selected); },
      setLanguage(value) {
        language = dictionary.isLanguage(value) ? value : "off";
        if (selected) select(selected);
      },
      clear() { generation++; key = null; selected = null; if (card) card.hidden = true; },
      contains(target, x, y) {
        if (!card || card.hidden) return false;
        if (card.contains(target)) return true;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
        const rect = card.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      },
      scroll(delta) { if (card) card.scrollTop += delta; }
    };
  }
  root.CleverSubtitleMeaning = { createCard };
  if (typeof module !== "undefined" && module.exports) module.exports = { createCard };
})(globalThis);
