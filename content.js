(function () {
  "use strict";

  const STORAGE_KEY = "knownWords";
  const { normalizeWord, captionPartsForSegments } = globalThis.CleverSubtitleWords;
  const originals = new WeakMap();
  let knownWords = new Set();
  let wordsRevision = 0;
  let analyzedContext = "";
  let analyzedRevision = -1;
  let analyzedParts = [];
  let wordButton;
  let activeElement;
  let hideTimer;
  let saving = false;

  function hideWordButton() {
    clearTimeout(hideTimer);
    hideTimer = null;
    activeElement = null;
    if (wordButton) wordButton.hidden = true;
  }

  function positionWordButton() {
    if (!activeElement || !wordButton || wordButton.hidden) return;
    const rect = activeElement.getBoundingClientRect();
    const width = wordButton.offsetWidth;
    const height = wordButton.offsetHeight;
    const above = rect.top - height - 6;
    wordButton.style.left = `${Math.min(
      Math.max(8, rect.left + rect.width / 2 - width / 2),
      Math.max(8, window.innerWidth - width - 8)
    )}px`;
    wordButton.style.top = `${above >= 8 ? above : rect.bottom + 6}px`;
  }

  async function changeActiveWord(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!activeElement || saving) return;
    const word = activeElement.dataset.cleverWord;
    const removing = activeElement.className === "clever-subtitle-known";
    if (!word) return;
    saving = true;
    wordButton.disabled = true;
    wordButton.textContent = "Saving…";
    try {
      // Read just before writing so changes made in the management page are retained.
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const next = new Set((Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [])
        .map(normalizeWord).filter(Boolean));
      if (removing ? next.delete(word) : !next.has(word)) {
        if (!removing) next.add(word);
        await chrome.storage.local.set({
          [STORAGE_KEY]: [...next].sort((a, b) => a.localeCompare(b, "en"))
        });
      }
      knownWords = next;
      wordsRevision += 1;
      hideWordButton();
      updateCaptions();
    } catch (error) {
      console.warn("Clever Youtube Subtitle: unable to update My Vocabulary", error);
      if (activeElement) {
        wordButton.textContent = "Could not save. Try again.";
        positionWordButton();
      }
    } finally {
      saving = false;
      wordButton.disabled = false;
    }
  }

  function showWordButton(element) {
    if (saving) return;
    clearTimeout(hideTimer);
    hideTimer = null;
    if (!wordButton) {
      wordButton = document.createElement("button");
      wordButton.type = "button";
      wordButton.className = "clever-subtitle-word-button";
      wordButton.hidden = true;
      wordButton.addEventListener("pointerdown", (event) => event.stopPropagation());
      wordButton.addEventListener("mousedown", (event) => event.stopPropagation());
      wordButton.addEventListener("click", changeActiveWord);
    }
    const host = document.fullscreenElement || document.body;
    if (wordButton.parentElement !== host) host.appendChild(wordButton);
    activeElement = element;
    const word = element.dataset.cleverWord;
    const removing = element.className === "clever-subtitle-known";
    wordButton.textContent = `${removing ? "Remove" : "Add"} “${word}” ${removing ? "from" : "to"} My Vocabulary`;
    wordButton.setAttribute("aria-label", wordButton.textContent);
    wordButton.hidden = false;
    positionWordButton();
  }

  function updateSegment(segment, parts, context) {
    const current = segment.textContent || "";
    const previous = originals.get(segment);
    const wrappedCount = parts.filter((part) => part.hidden || part.addWord).length;
    const existingCount = segment.querySelectorAll(".clever-subtitle-known, .clever-subtitle-unknown").length;

    // Hidden spans retain their original text, so textContent remains the full
    // YouTube caption. This also lets us detect when YouTube replaces a line.
    if (previous?.original === current &&
        previous.wordsRevision === wordsRevision &&
        previous.context === context &&
        existingCount === wrappedCount) return;

    if (activeElement) hideWordButton();
    if (wrappedCount === 0) {
      if (existingCount) segment.textContent = current;
    } else {
      const fragment = document.createDocumentFragment();
      for (const part of parts) {
        if (part.hidden) {
          const span = document.createElement("span");
          span.className = "clever-subtitle-known";
          span.dataset.cleverWord = part.removeWord;
          span.textContent = part.text;
          fragment.appendChild(span);
        } else if (part.addWord) {
          const span = document.createElement("span");
          span.className = "clever-subtitle-unknown";
          span.dataset.cleverWord = part.addWord;
          span.textContent = part.text;
          fragment.appendChild(span);
        } else {
          fragment.appendChild(document.createTextNode(part.text));
        }
      }
      segment.replaceChildren(fragment);
    }
    originals.set(segment, { original: current, wordsRevision, context });
  }

  function updateCaptions() {
    // YouTube adds/removes these nodes as captions change or are toggled.
    const segments = [...document.querySelectorAll(".ytp-caption-segment")];
    if (activeElement && !segments.some((segment) => segment.contains(activeElement))) {
      hideWordButton();
    }
    const texts = segments.map((segment) => segment.textContent || "");
    const context = JSON.stringify(texts);
    if (context !== analyzedContext || wordsRevision !== analyzedRevision) {
      analyzedContext = context;
      analyzedRevision = wordsRevision;
      analyzedParts = captionPartsForSegments(texts, knownWords);
    }
    segments.forEach((segment, index) => updateSegment(segment, analyzedParts[index], context));
  }

  function loadWords() {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      if (chrome.runtime.lastError) {
        console.warn("Clever Youtube Subtitle: unable to read My Vocabulary", chrome.runtime.lastError);
        return;
      }
      const saved = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
      knownWords = new Set(saved.map(normalizeWord).filter(Boolean));
      wordsRevision += 1;
      updateCaptions();
    });
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[STORAGE_KEY]) loadWords();
  });

  document.addEventListener("mouseover", (event) => {
    if (event.target === wordButton) {
      clearTimeout(hideTimer);
      hideTimer = null;
      return;
    }
    const element = event.target.closest?.(
      ".ytp-caption-segment .clever-subtitle-unknown, .ytp-caption-segment .clever-subtitle-known"
    );
    if (element) showWordButton(element);
  });

  document.addEventListener("mouseout", (event) => {
    if (!activeElement) return;
    if (event.target !== activeElement && event.target !== wordButton) return;
    const next = event.relatedTarget;
    if (next === activeElement || next === wordButton) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideWordButton, 250);
  });

  window.addEventListener("scroll", positionWordButton, true);
  window.addEventListener("resize", positionWordButton);
  document.addEventListener("fullscreenchange", hideWordButton);

  function involvesCaptions(record) {
    const target = record.target.nodeType === Node.ELEMENT_NODE
      ? record.target
      : record.target.parentElement;
    if (target?.closest?.(".caption-window, .captions-text, .ytp-caption-segment")) return true;
    return [...record.addedNodes, ...record.removedNodes].some((node) =>
      node.nodeType === Node.ELEMENT_NODE &&
      (node.matches(".ytp-caption-segment") || node.querySelector(".ytp-caption-segment"))
    );
  }

  const observer = new MutationObserver((records) => {
    if (records.some(involvesCaptions)) updateCaptions();
  });
  observer.observe(document.documentElement, {
    childList: true,
    characterData: true,
    subtree: true
  });
  loadWords();
})();
