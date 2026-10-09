(function () {
  "use strict";

  const STORAGE_KEY = "knownWords";
  const WORD_SELECTOR = ".ytp-caption-segment .clever-subtitle-unknown, .ytp-caption-segment .clever-subtitle-known, .clever-subtitle-review-caption .clever-subtitle-unknown, .clever-subtitle-review-caption .clever-subtitle-known";
  const { normalizeWord, captionPartsForSegments } = globalThis.CleverSubtitleWords;
  const nlp = globalThis.CleverSubtitleNLP;
  const interaction = globalThis.CleverSubtitleInteraction.createInteraction();
  const dictionary = globalThis.CleverSubtitleDictionary;
  const meanings = globalThis.CleverSubtitleMeaning?.createCard(
    (message) => chrome.runtime.sendMessage(message), document, window
  );
  const pendingAnalysis = new Set();
  const originals = new WeakMap();
  const stream = globalThis.CleverSubtitleStream.createStream(nlp, globalThis.CleverSubtitleWords, () => {
    nlpRevision++;
    updateCaptions();
  });
  let knownWords = new Set();
  let vocabularyReady = false;
  let wordsRevision = 0;
  let nlpRevision = 0;
  let wordButton;
  let activeElement;
  let hideTimer;
  let saving = false;
  let touchSelection = false;
  let suppressMouseHoverUntil = 0;
  let blockedTouch = null;
  let wordButtonArmed = false;
  let activeInReview = false;
  let currentCaption = null;
  let previousCaption = null;
  let reviewedCaption = null;
  let review;
  let reviewToggle;
  let reviewPanel;
  let reviewCaption;
  let reviewClose;
  let reviewRevision = -1;
  let reviewNlpRevision = -1;
  let reviewPosition = { side: "left", verticalRatio: 0 };
  let reviewResizeObserver;
  let trackedVideo = null;
  let resumeVideo = null;
  let staleCaptionKey = null;

  function updateKnownVisibility() {
    document.documentElement.classList[interaction.revealKnown ? "add" : "remove"]("clever-subtitle-reveal-known");
  }

  function hideWordButton() {
    clearTimeout(hideTimer);
    hideTimer = null;
    interaction.reset();
    wordButtonArmed = false;
    renderInteraction();
  }

  function leaveHoveredWord() {
    clearTimeout(hideTimer);
    hideTimer = null;
    interaction.leave();
    renderInteraction();
  }

  function wordState(element, input) {
    const inReview = Boolean(reviewedCaption && reviewCaption.contains(element));
    return {
      element, input, review: inReview,
      captionText: inReview ? reviewedCaption.key : captionText([...document.querySelectorAll(".ytp-caption-segment")]
        .map((segment) => segment.textContent || "")),
      text: element.textContent, id: element.dataset.cleverId,
      rect: element.getBoundingClientRect(),
      // Store the gesture's intent; saving vocabulary does not create a new click.
      reveal: element.classList.contains("clever-subtitle-known")
    };
  }

  function closeReview(resume = true) {
    interaction.clearReview();
    reviewedCaption = null;
    if (reviewPanel) {
      reviewPanel.hidden = true;
      reviewToggle.setAttribute("aria-expanded", "false");
    }
    renderInteraction();
    const video = resumeVideo;
    resumeVideo = null;
    if (resume && video && video === trackedVideo && video.isConnected && video.paused && !video.ended && !video.seeking) {
      const playing = video.play();
      playing?.catch(() => {});
    }
  }

  function resetCaptionHistory(event) {
    // YouTube can leave the old caption in the DOM briefly after a seek.
    staleCaptionKey = event ? captionText([...document.querySelectorAll(".ytp-caption-segment")]
      .map((segment) => segment.textContent || "")) : null;
    closeReview(false);
    hideWordButton();
    currentCaption = null;
    previousCaption = null;
    stream.reset();
    if (review) review.hidden = true;
    if (blockedTouch?.drag) finishReviewDrag(blockedTouch, true);
  }

  function onVideoPlay() {
    // If the user resumes through YouTube, dismiss the frozen caption too.
    hideWordButton();
    closeReview(false);
  }

  function trackVideo(video) {
    if (trackedVideo === video) return;
    const replacingVideo = Boolean(trackedVideo || staleCaptionKey !== null);
    if (trackedVideo) {
      trackedVideo.removeEventListener("seeking", resetCaptionHistory);
      trackedVideo.removeEventListener("seeked", updateCaptions);
      trackedVideo.removeEventListener("emptied", resetCaptionHistory);
      trackedVideo.removeEventListener("play", onVideoPlay);
    }
    resetCaptionHistory(replacingVideo ? { type: "videochange" } : undefined);
    trackedVideo = video;
    if (video) {
      video.addEventListener("seeking", resetCaptionHistory);
      video.addEventListener("seeked", updateCaptions);
      video.addEventListener("emptied", resetCaptionHistory);
      video.addEventListener("play", onVideoPlay);
    }
  }

  function openReview() {
    if (!previousCaption || !trackedVideo) return;
    leaveHoveredWord();
    reviewedCaption = previousCaption;
    reviewRevision = -1;
    reviewCaption.textContent = reviewedCaption.text;
    reviewCaption.scrollTop = 0;
    resumeVideo = !trackedVideo.paused && !trackedVideo.ended ? trackedVideo : null;
    trackedVideo.pause();
    reviewClose.textContent = resumeVideo ? "Continue playback" : "Close";
    reviewPanel.hidden = false;
    reviewToggle.setAttribute("aria-expanded", "true");
    renderReviewCaption();
    positionReview();
  }

  function reviewBounds() {
    const host = review?.parentElement;
    if (!host) return null;
    const rect = host.getBoundingClientRect();
    const button = reviewToggle.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || button.width <= 0 || button.height <= 0) return null;
    // Scale coordinates back into the player's CSS pixels if it is transformed.
    const width = host.clientWidth || rect.width;
    const height = host.clientHeight || rect.height;
    return { rect, width, height, scaleX: rect.width / width, scaleY: rect.height / height,
      buttonWidth: button.width * width / rect.width, buttonHeight: button.height * height / rect.height,
      inset: Math.min(12, width / 4, height / 4) };
  }

  function positionReview(freePosition = null) {
    if (!review || review.hidden) return;
    // Caption updates and resize callbacks must not undo an ongoing drag.
    freePosition ||= blockedTouch?.drag?.position;
    const bounds = reviewBounds();
    if (!bounds) return;
    const { width, height, buttonWidth, buttonHeight, inset } = bounds;
    const travel = Math.max(0, height - buttonHeight - inset * 2);
    const top = Math.max(inset, Math.min(freePosition?.top ?? inset + travel * reviewPosition.verticalRatio, inset + travel));
    const left = Math.max(inset, Math.min(freePosition?.left ?? (reviewPosition.side === "left" ? inset : width - buttonWidth - inset),
      Math.max(inset, width - buttonWidth - inset)));
    const side = freePosition ? (left + buttonWidth / 2 < width / 2 ? "left" : "right") : reviewPosition.side;
    review.style.top = `${top}px`;
    review.style.left = freePosition || side === "left" ? `${left}px` : "auto";
    review.style.right = freePosition || side === "left" ? "auto" : `${inset}px`;
    const panelWidth = Math.max(0, Math.min(520, width - inset * 2));
    const panelLeft = Math.max(inset, Math.min(left, width - panelWidth - inset));
    reviewPanel.style.width = `${panelWidth}px`;
    reviewPanel.style.left = side === "left" ? `${panelLeft - left}px` : "auto";
    reviewPanel.style.right = side === "right" ? `${left + buttonWidth - panelLeft - panelWidth}px` : "auto";
    const below = Math.max(0, height - inset - top - buttonHeight - 8);
    const above = Math.max(0, top - inset - 8);
    const openAbove = below < Math.min(300, above);
    reviewPanel.style.top = openAbove ? "auto" : "calc(100% + 8px)";
    reviewPanel.style.bottom = openAbove ? "calc(100% + 8px)" : "auto";
    reviewPanel.style.maxHeight = `${Math.min(300, openAbove ? above : below)}px`;
    positionWordButton();
  }

  function beginReviewDrag(touch, x, y) {
    const bounds = reviewBounds();
    if (!bounds) return;
    const button = reviewToggle.getBoundingClientRect();
    touch.drag = { left: (button.left - bounds.rect.left) / bounds.scaleX,
      top: (button.top - bounds.rect.top) / bounds.scaleY, bounds, moved: false };
  }

  function moveReviewDrag(touch, x, y) {
    const drag = touch.drag;
    if (!drag || !Number.isFinite(x) || !Number.isFinite(y)) return;
    if (Math.hypot(x - touch.x, y - touch.y) > 10) drag.moved = true;
    if (!drag.moved) return;
    touch.cancelled = true;
    review.classList.add("clever-subtitle-review-dragging");
    drag.position = { left: drag.left + (x - touch.x) / drag.bounds.scaleX,
      top: drag.top + (y - touch.y) / drag.bounds.scaleY };
    positionReview(drag.position);
  }

  function finishReviewDrag(touch, cancelled = false) {
    const drag = touch.drag;
    if (!drag) return;
    if (drag.moved) {
      const bounds = reviewBounds();
      if (bounds) {
        const left = parseFloat(review.style.left);
        const top = parseFloat(review.style.top);
        reviewPosition = { side: left + bounds.buttonWidth / 2 < bounds.width / 2 ? "left" : "right",
          verticalRatio: Math.max(0, Math.min(1, (top - bounds.inset) / Math.max(1, bounds.height - bounds.buttonHeight - bounds.inset * 2))) };
      }
    }
    review.classList.remove("clever-subtitle-review-dragging");
    touch.drag = null;
    if (cancelled) touch.cancelled = true;
    positionReview();
  }

  function ensureReview(host) {
    if (!review) {
      review = document.createElement("section");
      review.className = "clever-subtitle-review";
      review.setAttribute("aria-label", "Previous caption");
      reviewToggle = document.createElement("button");
      reviewToggle.type = "button";
      reviewToggle.className = "clever-subtitle-review-toggle";
      reviewToggle.textContent = "↶ Previous caption";
      reviewToggle.title = "View the previous caption. Drag to move.";
      reviewToggle.setAttribute("aria-expanded", "false");
      reviewToggle.setAttribute("aria-controls", "clever-subtitle-review-panel");
      reviewToggle.addEventListener("click", () => {
        if (reviewedCaption) closeReview();
        else openReview();
      });
      reviewPanel = document.createElement("div");
      reviewPanel.id = "clever-subtitle-review-panel";
      reviewPanel.className = "clever-subtitle-review-panel";
      reviewPanel.hidden = true;
      reviewCaption = document.createElement("div");
      reviewCaption.className = "clever-subtitle-review-caption";
      reviewClose = document.createElement("button");
      reviewClose.type = "button";
      reviewClose.className = "clever-subtitle-review-close";
      reviewClose.addEventListener("click", () => {
        closeReview();
        reviewToggle.focus();
      });
      reviewPanel.appendChild(reviewCaption);
      reviewPanel.appendChild(reviewClose);
      review.appendChild(reviewToggle);
      review.appendChild(reviewPanel);
      // Keep review actions from also toggling YouTube's player underneath.
      for (const type of ["pointerdown", "touchstart", "mousedown", "click", "dblclick"]) {
        review.addEventListener(type, (event) => event.stopPropagation());
      }
    }
    if (review.parentElement !== host) {
      host.appendChild(review);
      if (typeof ResizeObserver !== "undefined") {
        reviewResizeObserver ||= new ResizeObserver(() => positionReview());
        reviewResizeObserver.disconnect();
        reviewResizeObserver.observe(host);
      }
    }
  }

  function renderReviewCaption() {
    if (!reviewedCaption || (reviewRevision === wordsRevision && reviewNlpRevision === nlpRevision)) return;
    if (reviewedCaption.lines) for (const line of reviewedCaption.lines) stream.finish(line);
    const parts = reviewedCaption.lines
      ? stream.parts([reviewedCaption.text], knownWords, reviewedCaption.lines.flatMap((line) => line.units))[0]
      : partsForCaption([reviewedCaption.text])[0];
    // Frozen captions without stream IDs still need stable word occurrences
    // when a saved word switches between the known and unknown classes.
    parts.forEach((part, index) => { part.id ||= `review-${index}`; });
    updateSegment(reviewCaption, parts, Boolean(reviewedCaption.lines));
    reviewRevision = wordsRevision;
    reviewNlpRevision = nlpRevision;
  }

  function updateCaptionHistory(texts, frame) {
    const video = document.querySelector("video.html5-main-video") || document.querySelector("video");
    trackVideo(video);
    const host = video?.closest(".html5-video-player") || video?.parentElement;
    if (!host) return;
    const ccButton = host.querySelector(".ytp-subtitles-button");
    if (ccButton?.getAttribute("aria-pressed") === "false") {
      resetCaptionHistory();
      return;
    }
    const key = captionText(texts);
    if (frame.history) {
      previousCaption = { key: captionText([frame.history.text]), text: frame.history.text, lines: frame.history.lines };
    }
    if (key && !video.seeking) {
      if (key === staleCaptionKey) return;
      staleCaptionKey = null;
      const next = { key, text: texts.join(" ") };
      if (!frame.removed && !frame.streaming && currentCaption && currentCaption.key !== key && !key.startsWith(`${currentCaption.key} `)) {
        previousCaption = currentCaption;
      }
      currentCaption = next;
    }
    if (!previousCaption) return;
    ensureReview(host);
    review.hidden = false;
    positionReview();
    renderReviewCaption();
  }

  function positionWordButton() {
    if (!activeElement || !wordButton || wordButton.hidden) return;
    const rect = activeElement.getBoundingClientRect();
    if (activeInReview) {
      const visible = reviewCaption.getBoundingClientRect();
      if (rect.bottom <= visible.top || rect.top >= visible.bottom || rect.right <= visible.left || rect.left >= visible.right) {
        interaction.drop(activeElement);
        renderInteraction();
        return;
      }
    }
    if (rect.width > 0 && rect.height > 0) interaction.button.rect = rect;
    const width = wordButton.offsetWidth;
    const height = wordButton.offsetHeight;
    const above = rect.top - height;
    wordButton.style.left = `${Math.min(
      Math.max(8, rect.left + rect.width / 2 - width / 2),
      Math.max(8, window.innerWidth - width - 8)
    )}px`;
    wordButton.style.top = `${above >= 0 ? above : rect.bottom}px`;
    meanings?.position();
  }

  function captionText(texts) {
    return texts.join(" ").replace(/\s+/gu, " ").trim();
  }

  async function changeActiveWord(event) {
    event.preventDefault();
    event.stopPropagation?.();
    if (!activeElement || saving || activeElement.dataset.cleverPending === "true") return;
    // The tap that opened this button can also produce a click on the new button.
    // Wait for a separate touch on the button before changing stored words.
    if (touchSelection && !wordButtonArmed && event.detail !== 0) return;
    const word = activeElement.dataset.cleverWord;
    const removing = activeElement.classList.contains("clever-subtitle-known");
    if (!word) return;
    const actionElement = activeElement;
    let saved = false;
    saving = true;
    wordButton.disabled = true;
    wordButton.textContent = "…";
    wordButton.title = "Saving…";
    wordButton.setAttribute("aria-label", "Saving…");
    try {
      const response = await chrome.runtime.sendMessage({
        type: "vocab:mutate",
        mutation: removing ? { remove: [word] } : { add: [word] }
      });
      if (!response?.ok) throw new Error(response?.error || "Could not save.");
      knownWords = new Set(response.words);
      wordsRevision += 1;
      saved = true;
    } catch (error) {
      console.warn("Clever Youtube Subtitle: unable to update My Vocabulary", error);
      if (activeElement === actionElement) {
        wordButton.textContent = "!";
        wordButton.title = "Could not save. Tap to try again.";
        wordButton.setAttribute("aria-label", wordButton.title);
      }
    } finally {
      saving = false;
      wordButton.disabled = false;
      if (saved) updateCaptions();
    }
  }

  function renderInteraction() {
    // Closing or scrolling a review word out of view must not discard a
    // selection in the current captions, or the other way round.
    for (const state of [interaction.hovered, interaction.selected]) {
      if (!state?.review) continue;
      const rect = state.element.getBoundingClientRect();
      const visible = reviewCaption.getBoundingClientRect();
      if (!reviewedCaption || rect.bottom <= visible.top || rect.top >= visible.bottom ||
          rect.right <= visible.left || rect.left >= visible.right) interaction.drop(state.element);
    }
    const target = interaction.button;
    const element = target?.element;
    if (activeElement !== element) {
      activeElement?.classList.remove("clever-subtitle-active");
      wordButtonArmed = false;
    }
    activeElement = element || null;
    activeInReview = Boolean(target?.review);
    touchSelection = target?.input === "touch";
    updateKnownVisibility();
    if (interaction.selected) meanings?.select(interaction.selected.element);
    else meanings?.clear();
    if (!element || !vocabularyReady || element.dataset.cleverPending === "true") {
      if (wordButton) wordButton.hidden = true;
      return;
    }
    if (!wordButton) {
      wordButton = document.createElement("button");
      wordButton.type = "button";
      wordButton.className = "clever-subtitle-word-button";
      wordButton.hidden = true;
      wordButton.addEventListener("pointerdown", (event) => {
        if (event.pointerType !== "touch" || !blockedTouch || blockedTouch.released || Date.now() > blockedTouch.until) {
          blockedTouch = null;
          wordButtonArmed = true;
        }
        event.stopPropagation();
      });
      wordButton.addEventListener("touchstart", (event) => {
        if (!blockedTouch || blockedTouch.released || Date.now() > blockedTouch.until) {
          blockedTouch = null;
          wordButtonArmed = true;
        }
        event.stopPropagation();
      }, { passive: true });
      wordButton.addEventListener("mousedown", (event) => event.stopPropagation());
      wordButton.addEventListener("click", changeActiveWord);
    }
    const host = document.fullscreenElement || document.body;
    if (wordButton.parentElement !== host) host.appendChild(wordButton);
    activeElement.classList.add("clever-subtitle-active");
    const word = element.dataset.cleverWord;
    const removing = element.classList.contains("clever-subtitle-known");
    const pending = element.dataset.cleverPending === "true";
    wordButton.disabled = saving || pending;
    wordButton.textContent = saving || pending ? "…" : removing ? "−" : "+";
    wordButton.title = saving ? "Saving…" : pending ? "Reading word…" : `${removing ? "Remove" : "Add"} “${word}” ${removing ? "from" : "to"} My Vocabulary`;
    wordButton.setAttribute("aria-label", wordButton.title);
    wordButton.hidden = false;
    updateKnownVisibility();
    positionWordButton();
  }

  function showWordButton(element, fromTouch = false, pinned = false) {
    if (!vocabularyReady || element.dataset.cleverPending === "true") return;
    clearTimeout(hideTimer);
    hideTimer = null;
    const state = wordState(element, fromTouch ? "touch" : "mouse");
    if (pinned) interaction.select(state);
    else interaction.hover(state);
    renderInteraction();
  }

  function updateSegment(segment, parts, streaming = false) {
    const current = segment.textContent || "";
    const previous = originals.get(segment);
    const wrappedCount = parts.filter((part) => !/^\s+$/u.test(part.text)).length;
    const existing = [...segment.querySelectorAll(".clever-subtitle-known, .clever-subtitle-unknown, .clever-subtitle-text, .clever-subtitle-pending")];
    const existingCount = existing.length;
    const signature = JSON.stringify(parts);
    // Native, unprocessed segments are hidden by CSS too. Publish the whole
    // segment only after analysis settles; opacity preserves its exact layout.
    segment.dataset.cleverReady = String(vocabularyReady && (streaming || !parts.some((part) => part.pending)));

    // Hidden spans retain their original text, so textContent remains the full
    // YouTube caption. This also lets us detect when YouTube replaces a line.
    if (previous?.original === current &&
        previous.signature === signature &&
        existingCount === wrappedCount && segment.querySelector(".clever-subtitle-output")) return;

    const fragment = document.createDocumentFragment();
    const spans = new Map(existing.filter((span) => span.dataset.cleverId)
      .map((span) => [span.dataset.cleverId, span]));
    for (const part of parts) {
      if (!/^\s+$/u.test(part.text)) {
        const span = spans.get(part.id) || document.createElement("span");
        span.className = part.hidden ? "clever-subtitle-known" : part.addWord ? "clever-subtitle-unknown" : "clever-subtitle-text";
        if (part.pending) span.classList.add("clever-subtitle-pending");
        span.dataset.cleverWord = part.hidden ? part.removeWord : part.addWord || "";
        span.dataset.cleverPending = String(Boolean(part.pending));
        // Dictionary lookup uses the lemma, not the vocabulary entry to remove.
        span.dataset.cleverLemma = part.addWord || "";
        if (part.id) span.dataset.cleverId = part.id;
        span.textContent = part.text;
        fragment.appendChild(span);
      } else {
        fragment.appendChild(document.createTextNode(part.text));
      }
    }
    const output = segment.querySelector(".clever-subtitle-output") || document.createElement("span");
    output.className = "clever-subtitle-output";
    output.replaceChildren(fragment);
    const container = document.createDocumentFragment();
    container.appendChild(output);
    segment.replaceChildren(container);
    originals.set(segment, { original: current, signature });
  }

  function partsForCaption(texts) {
    const text = texts.join(" ");
    const tokens = nlp.peek(text);
    const pending = Boolean(text.trim() && tokens === undefined);
    if (pending && !pendingAnalysis.has(text)) {
      pendingAnalysis.add(text);
      nlp.analyze(text).then(() => {
        // Always render the current DOM, never nodes captured by an old request.
        const currentText = [...document.querySelectorAll(".ytp-caption-segment")]
          .map((segment) => segment.textContent || "").join(" ");
        if (text === currentText || text === reviewedCaption?.text) {
          nlpRevision++;
          updateCaptions();
        }
      }).finally(() => pendingAnalysis.delete(text));
    }
    const parts = captionPartsForSegments(texts, knownWords, tokens);
    if (pending) for (const segment of parts) for (const part of segment) part.pending = true;
    return parts;
  }

  function captionLines(segments) {
    const rows = [];
    for (const segment of segments) {
      const source = segment.closest(".caption-visual-line");
      const captionHost = segment.closest(".caption-window, .captions-text");
      const top = segment.getBoundingClientRect().top;
      const previous = rows.at(-1);
      if (previous && (source ? previous.source === source :
        !previous.source && previous.captionHost === captionHost && Math.abs(previous.top - top) < 2)) {
        previous.texts.push(segment.textContent || "");
      } else {
        rows.push({ source, captionHost, top, texts: [segment.textContent || ""] });
      }
    }
    return rows.flatMap((row) => row.texts.join(" ").split(/\r?\n/u)
      .map((text) => ({ text, source: row.source })));
  }

  function updateCaptions() {
    // YouTube adds/removes these nodes as captions change or are toggled.
    const segments = [...document.querySelectorAll(".ytp-caption-segment")];
    const video = document.querySelector("video.html5-main-video") || document.querySelector("video");
    trackVideo(video);
    const texts = segments.map((segment) => segment.textContent || "");
    if (video?.seeking || (staleCaptionKey !== null && captionText(texts) === staleCaptionKey)) {
      for (const segment of segments) segment.dataset.cleverReady = "false";
      return;
    }
    const frame = stream.update(captionLines(segments));
    const analyzedParts = stream.parts(texts, knownWords, frame.units);
    segments.forEach((segment, index) => updateSegment(segment, analyzedParts[index], frame.streaming));
    updateCaptionHistory(texts, frame);
    // YouTube may rebuild or split a caption when player controls appear.
    // Keep the selected word if the displayed sentence is still the same.
    interaction.rebind((state) => {
      if (state.review && !reviewedCaption) return null;
      const key = state.review ? reviewedCaption.key : captionText(texts);
      const captionSegments = state.review ? [reviewCaption] : segments;
      if (!state.id && state.captionText !== key) return null;
      let element = captionSegments.some((segment) => segment.contains(state.element)) ? state.element : null;
      if (!element) {
        const candidates = [...document.querySelectorAll(WORD_SELECTOR)].filter((word) =>
          captionSegments.some((segment) => segment.contains(word)) &&
          (state.id ? word.dataset.cleverId === state.id : word.textContent === state.text));
        const distance = (word) => {
          const rect = word.getBoundingClientRect();
          return state.rect ? Math.abs(rect.left - state.rect.left) + Math.abs(rect.top - state.rect.top) : 0;
        };
        candidates.sort((a, b) => distance(a) - distance(b));
        element = candidates[0];
      }
      return element ? { ...wordState(element, state.input), reveal: state.reveal } : null;
    });
    renderInteraction();
  }

  function loadWords() {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      if (chrome.runtime.lastError) {
        console.warn("Clever Youtube Subtitle: unable to read My Vocabulary", chrome.runtime.lastError);
        vocabularyReady = true;
        updateCaptions();
        return;
      }
      const saved = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
      knownWords = new Set(saved.map(normalizeWord).filter(Boolean));
      vocabularyReady = true;
      wordsRevision += 1;
      updateCaptions();
    });
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (dictionary && areaName === "local" && changes[dictionary.STORAGE_KEY]) {
      meanings?.setLanguage(changes[dictionary.STORAGE_KEY].newValue);
    } else if (dictionary && areaName === "local" &&
        (changes[dictionary.PROVIDER_KEY] || changes[dictionary.MICROSOFT_CONFIG_KEY] || changes[dictionary.PACK_REVISION_KEY])) {
      meanings?.refresh();
    }
    if (areaName === "local" && changes[STORAGE_KEY]) loadWords();
  });

  if (dictionary) chrome.storage.local.get(dictionary.STORAGE_KEY, (data) => {
    if (!chrome.runtime.lastError) meanings?.setLanguage(data[dictionary.STORAGE_KEY]);
  });

  function wordAtPoint(target, x, y) {
    if (!vocabularyReady) return null;
    const direct = target?.closest?.(WORD_SELECTOR);
    if (direct && direct.dataset.cleverPending !== "true") return direct;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    let selected = null;
    let bestDistance = Infinity;
    const insideReview = reviewedCaption && pointInside(reviewPanel, x, y);
    for (const element of document.querySelectorAll(WORD_SELECTOR)) {
      if (element.dataset.cleverPending === "true") continue;
      const reviewWord = reviewCaption?.contains(element);
      if (reviewWord && (!reviewedCaption || !pointInside(reviewCaption, x, y))) continue;
      if (insideReview && !reviewWord) continue;
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

  function pointInside(element, x, y) {
    if (!element || element.hidden || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 &&
      x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function reviewControlAtPoint(target, x, y) {
    if (!review || review.hidden) return null;
    for (const [element, control] of [[reviewToggle, "toggle"], [reviewClose, "close"]]) {
      if (control === "close" && !reviewedCaption) continue;
      if (element.contains(target) || pointInside(element, x, y)) return { element, control };
    }
    return null;
  }

  function wordButtonAtPoint(target, x, y) {
    return activeElement && wordButton && !wordButton.hidden &&
      (wordButton.contains(target) || pointInside(wordButton, x, y));
  }

  function blockReviewTouch(event, touch) {
    // Let a directly targeted review panel keep its native scroll gesture.
    if (touch.control !== "panel" || touch.covered) event.preventDefault();
    event.stopImmediatePropagation();
  }

  function handleTouchStart(event, x, y, fromTouch = true) {
    if (meanings?.contains(event.target, x, y)) {
      const direct = Boolean(event.target?.closest?.(".clever-subtitle-meaning"));
      blockedTouch = { control: "meaning", x, y, lastY: y, covered: !direct,
        until: Date.now() + 900, released: false };
      if (!direct) event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (fromTouch) suppressMouseHoverUntil = Date.now() + 900;
    if (blockedTouch && !blockedTouch.released && isBlockedTouch(x, y)) {
      blockReviewTouch(event, blockedTouch);
      return;
    }
    if (wordButtonAtPoint(event.target, x, y)) {
      // A new button can appear under the finger that selected the word.
      // Only a separate press after release arms a vocabulary change.
      if (touchSelection && !wordButtonArmed && blockedTouch && !blockedTouch.released) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      blockedTouch = { control: "word", element: wordButton, x, y,
        until: Date.now() + 900, released: false, cancelled: false };
      wordButtonArmed = true;
      clearTimeout(hideTimer);
      hideTimer = null;
      blockReviewTouch(event, blockedTouch);
      return;
    }
    const control = reviewControlAtPoint(event.target, x, y);
    if (control) {
      blockedTouch = { ...control, x, y, until: Date.now() + 900, released: false, cancelled: false };
      if (control.control === "toggle") beginReviewDrag(blockedTouch, x, y);
      leaveHoveredWord();
      blockReviewTouch(event, blockedTouch);
      return;
    }
    const element = wordAtPoint(event.target, x, y);
    if (!element && reviewedCaption && (reviewPanel.contains(event.target) || pointInside(reviewPanel, x, y))) {
      blockedTouch = { control: "panel", element: reviewPanel, x, y, lastY: y,
        covered: !reviewPanel.contains(event.target), until: Date.now() + 900, released: false };
      leaveHoveredWord();
      blockReviewTouch(event, blockedTouch);
      return;
    }
    if (review?.contains(event.target) && !event.target.closest?.(WORD_SELECTOR)) {
      blockedTouch = null;
      leaveHoveredWord();
      return;
    }
    if (!element) {
      blockedTouch = null;
      leaveHoveredWord();
      return;
    }
    blockedTouch = { x, y, until: Date.now() + 900, released: false };
    wordButtonArmed = false;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (saving) return;
    // Read visibility before changing selection or pausing. A second tap on a
    // revealed known word selects it; duplicate touch events never do.
    const hidden = element.classList.contains("clever-subtitle-known") &&
      !document.documentElement.classList.contains("clever-subtitle-reveal-known");
    if (trackedVideo && !trackedVideo.paused) trackedVideo.pause();
    if (fromTouch && hidden) {
      clearTimeout(hideTimer);
      hideTimer = null;
      interaction.reveal(wordState(element, "touch"));
      renderInteraction();
      return;
    }
    showWordButton(element, fromTouch, true);
  }

  function isBlockedTouch(x, y) {
    return blockedTouch && Date.now() <= blockedTouch.until &&
      Math.abs(x - (blockedTouch.clickX ?? blockedTouch.x)) <= 24 &&
      Math.abs(y - (blockedTouch.clickY ?? blockedTouch.y)) <= 24;
  }

  function handleTouchMove(event, x, y) {
    const touch = blockedTouch;
    if (touch?.control === "meaning") {
      if (touch.covered) {
        meanings.scroll(touch.lastY - y);
        touch.lastY = y;
        event.preventDefault();
      }
      event.stopImmediatePropagation();
      return;
    }
    if (!touch?.control || touch.released) return;
    moveReviewDrag(touch, x, y);
    if (Math.abs(x - touch.x) > 10 || Math.abs(y - touch.y) > 10) touch.cancelled = true;
    if (touch.control === "panel" && touch.covered && reviewedCaption) {
      reviewCaption.scrollTop += touch.lastY - y;
      touch.lastY = y;
      positionWordButton();
    }
    blockReviewTouch(event, touch);
  }

  function handleTouchEnd(event, x, y) {
    const touch = blockedTouch;
    if (!touch) return;
    if (touch.control === "meaning") {
      touch.released = true;
      touch.until = Date.now() + 900;
      if (touch.covered) event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (touch.control) {
      if (touch.released && !isBlockedTouch(x, y)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const visible = touch.control === "word" ? activeElement && !wordButton.hidden : review && !review.hidden;
      const activate = !touch.released && !touch.cancelled && visible && pointInside(touch.element, x, y);
      finishReviewDrag(touch);
      touch.released = true;
      touch.clickX = x;
      touch.clickY = y;
      touch.until = Date.now() + 900;
      if (activate && touch.control === "word") {
        void changeActiveWord(event);
      } else if (activate && touch.control === "toggle") {
        if (reviewedCaption) closeReview();
        else openReview();
      } else if (activate && touch.control === "close" && reviewedCaption) {
        closeReview();
        reviewToggle.focus();
      }
      return;
    }
    if (touch.released && !isBlockedTouch(x, y)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    touch.released = true;
    touch.clickX = x;
    touch.clickY = y;
    touch.until = Date.now() + 900;
  }

  document.addEventListener("mouseover", (event) => {
    if (saving || (Date.now() < suppressMouseHoverUntil &&
        event.sourceCapabilities?.firesTouchEvents !== false) ||
        event.sourceCapabilities?.firesTouchEvents) return;
    if (event.target === wordButton) {
      clearTimeout(hideTimer);
      hideTimer = null;
      return;
    }
    const element = event.target.closest?.(WORD_SELECTOR);
    if (element) showWordButton(element);
  });

  window.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch") {
      if (event.button !== 0 || (!wordButtonAtPoint(event.target, event.clientX, event.clientY) &&
          !meanings?.contains(event.target, event.clientX, event.clientY) &&
          !reviewControlAtPoint(event.target, event.clientX, event.clientY) &&
          !wordAtPoint(event.target, event.clientX, event.clientY))) return;
      suppressMouseHoverUntil = 0;
      handleTouchStart(event, event.clientX, event.clientY, false);
      if (!blockedTouch) return;
      blockedTouch.mouse = true;
      if (blockedTouch.control === "toggle") reviewToggle.focus();
      else if (blockedTouch.control === "close") reviewClose.focus();
      else if (blockedTouch.control === "word") wordButton.focus();
      return;
    }
    handleTouchStart(event, event.clientX, event.clientY);
  }, true);

  window.addEventListener("touchstart", (event) => {
    const touch = event.changedTouches[0];
    if (touch) handleTouchStart(event, touch.clientX, touch.clientY);
  }, { capture: true, passive: false });

  window.addEventListener("pointerup", (event) => {
    if (event.pointerType === "touch" || blockedTouch?.mouse) handleTouchEnd(event, event.clientX, event.clientY);
  }, true);

  window.addEventListener("touchend", (event) => {
    const touch = event.changedTouches[0];
    if (touch) handleTouchEnd(event, touch.clientX, touch.clientY);
  }, { capture: true, passive: false });

  window.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch" || blockedTouch?.mouse) handleTouchMove(event, event.clientX, event.clientY);
  }, { capture: true, passive: false });
  window.addEventListener("touchmove", (event) => {
    const touch = event.changedTouches[0];
    if (touch) handleTouchMove(event, touch.clientX, touch.clientY);
  }, { capture: true, passive: false });
  for (const type of ["pointercancel", "touchcancel"]) {
    window.addEventListener(type, (event) => {
      if (blockedTouch?.control) {
        finishReviewDrag(blockedTouch, true);
        blockedTouch.cancelled = true;
        blockedTouch.released = true;
        const point = event.changedTouches?.[0] || event;
        blockedTouch.clickX = point.clientX ?? blockedTouch.x;
        blockedTouch.clickY = point.clientY ?? blockedTouch.y;
        blockedTouch.until = Date.now() + 900;
      }
    }, true);
  }

  window.addEventListener("click", (event) => {
    if (meanings?.contains(event.target, event.clientX, event.clientY)) {
      event.stopImmediatePropagation();
      return;
    }
    if (event.detail !== 0 && blockedTouch?.control === "word" && isBlockedTouch(event.clientX, event.clientY)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (event.target === wordButton) {
      if (event.detail !== 0 && touchSelection && !wordButtonArmed) {
        event.preventDefault();
        event.stopImmediatePropagation();
        blockedTouch = null;
      }
      return;
    }
    if (event.detail === 0 || !isBlockedTouch(event.clientX, event.clientY)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    blockedTouch = null;
  }, true);

  document.addEventListener("mouseout", (event) => {
    if (!interaction.hovered) return;
    if (event.target !== activeElement && event.target !== wordButton) return;
    const next = event.relatedTarget;
    if (next === activeElement || next === wordButton) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(leaveHoveredWord, 250);
  });

  window.addEventListener("scroll", renderInteraction, true);
  window.addEventListener("resize", () => {
    renderInteraction();
    positionReview();
  });
  document.addEventListener("fullscreenchange", () => {
    renderInteraction();
    positionReview();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !reviewedCaption) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    closeReview();
    reviewToggle.focus();
  }, true);
  document.addEventListener("yt-navigate-start", resetCaptionHistory);
  document.addEventListener("yt-navigate-finish", updateCaptions);

  function involvesCaptions(record) {
    const target = record.target.nodeType === Node.ELEMENT_NODE
      ? record.target
      : record.target.parentElement;
    if (target?.closest?.(".caption-window, .captions-text, .ytp-caption-segment")) return true;
    if (target?.matches?.(".ytp-subtitles-button")) return true;
    return [...record.addedNodes, ...record.removedNodes].some((node) =>
      node.nodeType === Node.ELEMENT_NODE &&
      (node.matches(".ytp-caption-segment, video") || node.querySelector(".ytp-caption-segment, video"))
    );
  }

  const observer = new MutationObserver((records) => {
    if (records.some(involvesCaptions)) updateCaptions();
  });
  observer.observe(document.documentElement, {
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["aria-pressed"],
    subtree: true
  });
  loadWords();
})();
