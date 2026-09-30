(function () {
  "use strict";

  const STORAGE_KEY = "knownWords";
  const WORD_SELECTOR = ".ytp-caption-segment .clever-subtitle-unknown, .ytp-caption-segment .clever-subtitle-known";
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
  let touchSelection = false;
  let blockedTouch = null;

  function hideWordButton() {
    clearTimeout(hideTimer);
    hideTimer = null;
    activeElement?.classList.remove("clever-subtitle-active");
    activeElement = null;
    touchSelection = false;
    if (wordButton) wordButton.hidden = true;
  }

  function positionWordButton() {
    if (!activeElement || !wordButton || wordButton.hidden) return;
    const rect = activeElement.getBoundingClientRect();
    const width = wordButton.offsetWidth;
    const height = wordButton.offsetHeight;
    const above = rect.top - height;
    wordButton.style.left = `${Math.min(
      Math.max(8, rect.left + rect.width / 2 - width / 2),
      Math.max(8, window.innerWidth - width - 8)
    )}px`;
    wordButton.style.top = `${above >= 0 ? above : rect.bottom}px`;
  }

  async function changeActiveWord(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!activeElement || saving) return;
    const word = activeElement.dataset.cleverWord;
    const removing = activeElement.classList.contains("clever-subtitle-known");
    if (!word) return;
    saving = true;
    wordButton.disabled = true;
    wordButton.title = "Saving…";
    wordButton.setAttribute("aria-label", "Saving…");
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
        wordButton.title = "Could not save. Click to try again.";
        wordButton.setAttribute("aria-label", wordButton.title);
      }
    } finally {
      saving = false;
      wordButton.disabled = false;
    }
  }

  function showWordButton(element, fromTouch = false) {
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
    if (activeElement !== element) {
      activeElement?.classList.remove("clever-subtitle-active");
      touchSelection = fromTouch;
    } else if (fromTouch) {
      touchSelection = true;
    }
    activeElement = element;
    activeElement.classList.add("clever-subtitle-active");
    const word = element.dataset.cleverWord;
    const removing = element.classList.contains("clever-subtitle-known");
    wordButton.textContent = removing ? "−" : "+";
    wordButton.title = `${removing ? "Remove" : "Add"} “${word}” ${removing ? "from" : "to"} My Vocabulary`;
    wordButton.setAttribute("aria-label", wordButton.title);
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

  function wordAtPoint(target, x, y) {
    const direct = target?.closest?.(WORD_SELECTOR);
    if (direct) return direct;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    let selected = null;
    let bestDistance = Infinity;
    for (const element of document.querySelectorAll(WORD_SELECTOR)) {
      for (const rect of element.getClientRects()) {
        if (rect.width <= 0 || rect.height <= 0) continue;
        const dx = Math.max(rect.left - x, 0, x - rect.right);
        const dy = Math.max(rect.top - y, 0, y - rect.bottom);
        if (dx > 4 || dy > 4) continue;
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
          selected = element;
          bestDistance = distance;
        }
      }
    }
    return selected;
  }

  function handleTouchStart(event, x, y) {
    if (event.target === wordButton) return;
    const element = wordAtPoint(event.target, x, y);
    if (!element) {
      blockedTouch = null;
      hideWordButton();
      return;
    }
    blockedTouch = { x, y, until: Date.now() + 900 };
    event.preventDefault();
    event.stopImmediatePropagation();
    showWordButton(element, true);
  }

  function isBlockedTouch(x, y) {
    return blockedTouch && Date.now() <= blockedTouch.until &&
      Math.abs(x - blockedTouch.x) <= 24 && Math.abs(y - blockedTouch.y) <= 24;
  }

  document.addEventListener("mouseover", (event) => {
    if (event.target === wordButton) {
      clearTimeout(hideTimer);
      hideTimer = null;
      return;
    }
    const element = event.target.closest?.(WORD_SELECTOR);
    if (element) showWordButton(element);
  });

  window.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch") return;
    handleTouchStart(event, event.clientX, event.clientY);
  }, true);

  window.addEventListener("touchstart", (event) => {
    const touch = event.changedTouches[0];
    if (touch) handleTouchStart(event, touch.clientX, touch.clientY);
  }, { capture: true, passive: false });

  window.addEventListener("pointerup", (event) => {
    if (event.pointerType === "touch" && isBlockedTouch(event.clientX, event.clientY)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  window.addEventListener("touchend", (event) => {
    const touch = event.changedTouches[0];
    if (touch && isBlockedTouch(touch.clientX, touch.clientY)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, { capture: true, passive: false });

  window.addEventListener("click", (event) => {
    if (event.target === wordButton) return;
    if (!isBlockedTouch(event.clientX, event.clientY)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    blockedTouch = null;
  }, true);

  document.addEventListener("mouseout", (event) => {
    if (!activeElement || touchSelection) return;
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
