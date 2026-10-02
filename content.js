(function () {
  "use strict";

  const STORAGE_KEY = "knownWords";
  const WORD_SELECTOR = ".ytp-caption-segment .clever-subtitle-unknown, .ytp-caption-segment .clever-subtitle-known, .clever-subtitle-review-caption .clever-subtitle-unknown, .clever-subtitle-review-caption .clever-subtitle-known";
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
  let wordButtonArmed = false;
  let activeCaptionText = null;
  let activeRect = null;
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
  let reviewPosition = { side: "left", verticalRatio: 0 };
  let reviewResizeObserver;
  let trackedVideo = null;
  let resumeVideo = null;
  let staleCaptionKey = null;

  function hideWordButton() {
    clearTimeout(hideTimer);
    hideTimer = null;
    activeElement?.classList.remove("clever-subtitle-active");
    activeElement = null;
    touchSelection = false;
    wordButtonArmed = false;
    activeCaptionText = null;
    activeRect = null;
    activeInReview = false;
    if (wordButton) wordButton.hidden = true;
  }

  function closeReview(resume = true) {
    if (activeInReview) hideWordButton();
    reviewedCaption = null;
    if (reviewPanel) {
      reviewPanel.hidden = true;
      reviewToggle.setAttribute("aria-expanded", "false");
    }
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
    if (review) review.hidden = true;
    if (blockedTouch?.drag) finishReviewDrag(blockedTouch, true);
  }

  function onVideoPlay() {
    // If the user resumes through YouTube, dismiss the frozen caption too.
    if (touchSelection) hideWordButton();
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
    hideWordButton();
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
    if (!reviewedCaption || reviewRevision === wordsRevision) return;
    const parts = captionPartsForSegments([reviewedCaption.text], knownWords)[0];
    updateSegment(reviewCaption, parts, reviewedCaption.text);
    reviewRevision = wordsRevision;
  }

  function updateCaptionHistory(texts) {
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
    if (key && !video.seeking) {
      if (key === staleCaptionKey) return;
      staleCaptionKey = null;
      const next = { key, text: texts.join(" ") };
      if (currentCaption && currentCaption.key !== key && !key.startsWith(`${currentCaption.key} `)) {
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
        hideWordButton();
        return;
      }
    }
    if (rect.width > 0 && rect.height > 0) activeRect = rect;
    const width = wordButton.offsetWidth;
    const height = wordButton.offsetHeight;
    const above = rect.top - height;
    wordButton.style.left = `${Math.min(
      Math.max(8, rect.left + rect.width / 2 - width / 2),
      Math.max(8, window.innerWidth - width - 8)
    )}px`;
    wordButton.style.top = `${above >= 0 ? above : rect.bottom}px`;
  }

  function captionText(texts) {
    return texts.join(" ").replace(/\s+/gu, " ").trim();
  }

  async function changeActiveWord(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!activeElement || saving) return;
    // The tap that opened this button can also produce a click on the new button.
    // Wait for a separate touch on the button before changing stored words.
    if (touchSelection && blockedTouch && Date.now() <= blockedTouch.until && !wordButtonArmed) return;
    const word = activeElement.dataset.cleverWord;
    const removing = activeElement.classList.contains("clever-subtitle-known");
    if (!word) return;
    saving = true;
    wordButton.disabled = true;
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
    if (activeElement !== element) {
      activeElement?.classList.remove("clever-subtitle-active");
      touchSelection = fromTouch;
    } else if (fromTouch) {
      touchSelection = true;
    }
    activeElement = element;
    activeInReview = Boolean(reviewedCaption && reviewCaption.contains(element));
    activeCaptionText = activeInReview ? reviewedCaption.key : captionText([...document.querySelectorAll(".ytp-caption-segment")]
      .map((segment) => segment.textContent || ""));
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
    const selection = activeElement && {
      captionText: activeCaptionText,
      text: activeElement.textContent,
      word: activeElement.dataset.cleverWord,
      known: activeElement.classList.contains("clever-subtitle-known"),
      rect: activeRect,
      touch: touchSelection,
      review: activeInReview
    };
    const texts = segments.map((segment) => segment.textContent || "");
    const context = JSON.stringify(texts);
    if (context !== analyzedContext || wordsRevision !== analyzedRevision) {
      analyzedContext = context;
      analyzedRevision = wordsRevision;
      analyzedParts = captionPartsForSegments(texts, knownWords);
    }
    segments.forEach((segment, index) => updateSegment(segment, analyzedParts[index], context));
    updateCaptionHistory(texts);
    if (!selection) return;
    // YouTube may rebuild or split a caption when player controls appear.
    // Keep the selected word if the displayed sentence is still the same.
    const selectedCaption = selection.review ? reviewedCaption?.key : captionText(texts);
    const selectedSegments = selection.review && reviewedCaption ? [reviewCaption] : segments;
    if (selection.captionText !== selectedCaption) {
      hideWordButton();
      return;
    }
    if (selectedSegments.some((segment) => segment.contains(activeElement))) {
      positionWordButton();
      return;
    }
    const candidates = [...document.querySelectorAll(WORD_SELECTOR)].filter((element) =>
      selectedSegments.some((segment) => segment.contains(element)) &&
      element.textContent === selection.text &&
      element.dataset.cleverWord === selection.word &&
      element.classList.contains("clever-subtitle-known") === selection.known
    );
    candidates.sort((a, b) => {
      const point = selection.rect;
      if (!point) return 0;
      const distance = (element) => {
        const rect = element.getBoundingClientRect();
        return Math.abs(rect.left - point.left) + Math.abs(rect.top - point.top);
      };
      return distance(a) - distance(b);
    });
    if (candidates[0]) showWordButton(candidates[0], selection.touch);
    else hideWordButton();
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
    const insideReview = reviewedCaption && pointInside(reviewPanel, x, y);
    for (const element of document.querySelectorAll(WORD_SELECTOR)) {
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

  function blockReviewTouch(event, touch) {
    // Let a directly targeted review panel keep its native scroll gesture.
    if (touch.control !== "panel" || touch.covered) event.preventDefault();
    event.stopImmediatePropagation();
  }

  function handleTouchStart(event, x, y) {
    if (event.target === wordButton) return;
    if (blockedTouch?.control && !blockedTouch.released && isBlockedTouch(x, y)) {
      blockReviewTouch(event, blockedTouch);
      return;
    }
    const control = reviewControlAtPoint(event.target, x, y);
    if (control) {
      blockedTouch = { ...control, x, y, until: Date.now() + 900, released: false, cancelled: false };
      if (control.control === "toggle") beginReviewDrag(blockedTouch, x, y);
      hideWordButton();
      blockReviewTouch(event, blockedTouch);
      return;
    }
    const element = wordAtPoint(event.target, x, y);
    if (!element && reviewedCaption && (reviewPanel.contains(event.target) || pointInside(reviewPanel, x, y))) {
      blockedTouch = { control: "panel", element: reviewPanel, x, y, lastY: y,
        covered: !reviewPanel.contains(event.target), until: Date.now() + 900, released: false };
      hideWordButton();
      blockReviewTouch(event, blockedTouch);
      return;
    }
    if (review?.contains(event.target) && !event.target.closest?.(WORD_SELECTOR)) {
      blockedTouch = null;
      hideWordButton();
      return;
    }
    if (!element) {
      blockedTouch = null;
      hideWordButton();
      return;
    }
    blockedTouch = { x, y, until: Date.now() + 900, released: false };
    wordButtonArmed = false;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (trackedVideo && !trackedVideo.paused) trackedVideo.pause();
    showWordButton(element, true);
  }

  function isBlockedTouch(x, y) {
    return blockedTouch && Date.now() <= blockedTouch.until &&
      Math.abs(x - (blockedTouch.clickX ?? blockedTouch.x)) <= 24 &&
      Math.abs(y - (blockedTouch.clickY ?? blockedTouch.y)) <= 24;
  }

  function handleTouchMove(event, x, y) {
    const touch = blockedTouch;
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
    if (touch.control) {
      if (touch.released && !isBlockedTouch(x, y)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const activate = !touch.released && !touch.cancelled && !review.hidden && pointInside(touch.element, x, y);
      finishReviewDrag(touch);
      touch.released = true;
      touch.clickX = x;
      touch.clickY = y;
      touch.until = Date.now() + 900;
      if (activate && touch.control === "toggle") {
        if (reviewedCaption) closeReview();
        else openReview();
      } else if (activate && touch.control === "close" && reviewedCaption) {
        closeReview();
        reviewToggle.focus();
      }
      return;
    }
    if (isBlockedTouch(x, y)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      touch.released = true;
    }
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
    if (event.pointerType !== "touch") {
      if (event.button !== 0 || reviewControlAtPoint(event.target, event.clientX, event.clientY)?.control !== "toggle") return;
      handleTouchStart(event, event.clientX, event.clientY);
      blockedTouch.mouse = true;
      reviewToggle.focus();
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
    if (event.target === wordButton) {
      if (blockedTouch && Date.now() <= blockedTouch.until && !wordButtonArmed) {
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
    if (!activeElement || touchSelection) return;
    if (event.target !== activeElement && event.target !== wordButton) return;
    const next = event.relatedTarget;
    if (next === activeElement || next === wordButton) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideWordButton, 250);
  });

  window.addEventListener("scroll", positionWordButton, true);
  window.addEventListener("resize", () => {
    positionWordButton();
    positionReview();
  });
  document.addEventListener("fullscreenchange", () => {
    hideWordButton();
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
