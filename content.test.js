const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const words = require("./word-utils.js");
const streams = require("./caption-stream.js");
const interactions = require("./caption-interaction.js");
const originalModel = require("./nlp-test-helper.cjs");
test.before(originalModel.loadEngine);
const cachedNLP = { peek: originalModel.analyze };
const dictionary = require("./dictionary.js");
const offlineDictionary = dictionary.createDictionary(require("./dictionary-test-helper.cjs").load);

class FakeText {
  constructor(text) {
    this.nodeType = 3;
    this.textContent = text;
  }
}

class FakeElement {
  constructor(text = "", tagName = "div") {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.className = "";
    this.classList = {
      contains: (name) => this.className.split(/\s+/u).includes(name),
      add: (name) => {
        if (!this.classList.contains(name)) this.className = `${this.className} ${name}`.trim();
      },
      remove: (name) => {
        this.className = this.className.split(/\s+/u).filter((entry) => entry !== name).join(" ");
      }
    };
    this.dataset = {};
    this.style = {};
    this.listeners = {};
    this.scrollTop = 0;
    this.textContent = text;
  }

  get textContent() {
    return this.nodes.map((node) => node.textContent).join("");
  }

  set textContent(text) {
    for (const node of this.nodes || []) node.parentElement = null;
    this.nodes = [new FakeText(text)];
    this.nodes[0].parentElement = this;
  }

  closest(selector) {
    for (let element = this; element; element = element.parentElement) {
      if (element.matches(selector)) return element;
    }
    return null;
  }

  matches(selector) {
    return selector.split(",").some((entry) => {
      const parts = entry.trim().split(/\s+/u);
      const matchesPart = (element, part) => {
        const [tagName, ...classes] = part.split(".");
        return (!tagName || element.tagName === tagName.toUpperCase()) &&
          classes.every((name) => element.classList.contains(name));
      };
      if (!matchesPart(this, parts.pop())) return false;
      let ancestor = this.parentElement;
      while (parts.length) {
        const part = parts.pop();
        while (ancestor && !matchesPart(ancestor, part)) ancestor = ancestor.parentElement;
        if (!ancestor) return false;
        ancestor = ancestor.parentElement;
      }
      return true;
    });
  }

  querySelectorAll(selector) {
    return this.nodes.flatMap((node) => node.nodeType === 1
      ? [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)]
      : []);
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }

  replaceChildren(fragment) {
    for (const node of this.nodes) node.parentElement = null;
    this.nodes = [...fragment.nodes];
    for (const node of this.nodes) node.parentElement = this;
  }

  appendChild(node) {
    if (node.parentElement) {
      node.parentElement.nodes = node.parentElement.nodes.filter((entry) => entry !== node);
    }
    this.nodes.push(node);
    node.parentElement = this;
  }

  contains(node) { return this === node || this.nodes.some((child) => child === node || child.contains?.(node)); }

  addEventListener(type, listener) { this.listeners[type] = listener; }
  removeEventListener(type, listener) {
    if (this.listeners[type] === listener) delete this.listeners[type];
  }
  setAttribute(name, value) { this[name] = value; }
  getAttribute(name) { return this[name] ?? null; }
  focus() { this.focused = true; }
  getBoundingClientRect() {
    if (this.classList.contains("clever-subtitle-meaning")) {
      const left = parseFloat(this.style.left || "0"), top = parseFloat(this.style.top || "0");
      const width = parseFloat(this.style.width || "320"), height = Math.min(160, parseFloat(this.style.maxHeight || "260"));
      return { left, top, right: left + width, bottom: top + height, width, height };
    }
    if (this.classList.contains("clever-subtitle-word-button")) {
      const left = parseFloat(this.style.left || "0");
      const top = parseFloat(this.style.top || "0");
      return { left, top, right: left + this.offsetWidth, bottom: top + this.offsetHeight,
        width: this.offsetWidth, height: this.offsetHeight };
    }
    const layouts = {
      "clever-subtitle-review-toggle": { left: 20, top: 20, right: 180, bottom: 64, width: 160, height: 44 },
      "clever-subtitle-review-close": { left: 36, top: 320, right: 206, bottom: 364, width: 170, height: 44 },
      "clever-subtitle-review-panel": { left: 20, top: 72, right: 560, bottom: 380, width: 540, height: 308 },
      "clever-subtitle-review-caption": { left: 36, top: 88, right: 540, bottom: 288, width: 504, height: 200 }
    };
    return layouts[this.className] || { left: 100, top: 200, right: 150, bottom: 220, width: 50, height: 20 };
  }
  getClientRects() { return []; }
  get offsetWidth() { return 28; }
  get offsetHeight() { return this.classList.contains("clever-subtitle-meaning") ? 160 : 28; }
}

test("caption words keep spacing and can be added or removed from the hover button", async () => {
  let savedWords = ["hello"];
  let onStorageChanged;
  let onMutation;
  const documentListeners = {};
  const windowListeners = {};
  const segment = new FakeElement("Hello,   curious world!");
  segment.className = "ytp-caption-segment";
  const segments = [segment];
  const body = new FakeElement();
  const context = {
    CleverSubtitleWords: words,
    CleverSubtitleStream: streams,
    CleverSubtitleInteraction: interactions,
    CleverSubtitleNLP: cachedNLP,
    Node: { ELEMENT_NODE: 1 },
    setTimeout,
    clearTimeout,
    window: {
      innerWidth: 1200,
      addEventListener(type, listener) { windowListeners[type] = listener; }
    },
    document: {
      documentElement: body,
      body,
      addEventListener: (type, listener) => { documentListeners[type] = listener; },
      querySelectorAll: (selector) => selector === ".ytp-caption-segment"
        ? segments
        : segments.flatMap((item) => item.querySelectorAll(".clever-subtitle-known, .clever-subtitle-unknown")),
      querySelector: () => null,
      createElement: () => new FakeElement(),
      createTextNode: (text) => new FakeText(text),
      createDocumentFragment: () => ({
        nodes: [],
        appendChild(node) { this.nodes.push(node); }
      })
    },
    chrome: {
      runtime: {
        lastError: null,
        async sendMessage({ type, mutation }) {
          assert.equal(type, "vocab:mutate");
          const next = new Set(savedWords);
          for (const word of mutation.add || []) next.add(word);
          for (const word of mutation.remove || []) next.delete(word);
          savedWords = [...next].sort();
          onStorageChanged({ knownWords: {} }, "local");
          return { ok: true, words: savedWords };
        }
      },
      storage: {
        local: {
          get: (_key, callback) => callback
            ? callback({ knownWords: savedWords })
            : Promise.resolve({ knownWords: savedWords }),
          set: async ({ knownWords }) => {
            savedWords = knownWords;
            onStorageChanged({ knownWords: {} }, "local");
          }
        },
        onChanged: { addListener: (listener) => { onStorageChanged = listener; } }
      }
    },
    MutationObserver: class {
      constructor(callback) { onMutation = callback; }
      observe() {}
    }
  };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync("content.js", "utf8"), context);

  const hidden = () => segment.querySelectorAll(".clever-subtitle-known").map((node) => node.textContent);
  assert.equal(segment.textContent, "Hello,   curious world!");
  assert.deepEqual(hidden(), ["Hello,"]);

  // Our own DOM mutation must not lose the original sentence.
  onMutation([{ target: segment, addedNodes: [] }]);
  assert.equal(segment.textContent, "Hello,   curious world!");
  assert.deepEqual(hidden(), ["Hello,"]);

  savedWords = ["hello", "curious", "world"];
  onStorageChanged({ knownWords: {} }, "local");
  assert.equal(segment.textContent, "Hello,   curious world!");
  assert.deepEqual(hidden(), ["Hello,", "curious", "world!"]);

  segment.textContent = "HELLO, something new.";
  onMutation([{ target: segment, addedNodes: [] }]);
  assert.equal(segment.textContent, "HELLO, something new.");
  assert.deepEqual(hidden(), ["HELLO,"]);

  savedWords = [];
  onStorageChanged({ knownWords: {} }, "local");
  assert.equal(segment.textContent, "HELLO, something new.");
  assert.deepEqual(hidden(), []);

  segment.textContent = "He likes her";
  savedWords = ["like"];
  onStorageChanged({ knownWords: {} }, "local");
  assert.equal(segment.textContent, "He likes her");
  assert.deepEqual(hidden(), ["likes"]);

  segment.textContent = "saw.";
  savedWords = ["see"];
  onStorageChanged({ knownWords: {} }, "local");
  assert.deepEqual(hidden(), []);

  const preceding = new FakeElement("I");
  preceding.className = "ytp-caption-segment";
  segments.unshift(preceding);
  onMutation([{ target: preceding, addedNodes: [preceding] }]);
  assert.equal(segment.textContent, "saw.");
  assert.deepEqual(hidden(), ["saw."]);

  segments.shift();
  onMutation([{ target: segment, addedNodes: [], removedNodes: [preceding] }]);
  assert.deepEqual(hidden(), []);

  segment.textContent = "He likes her";
  savedWords = ["existing"];
  onStorageChanged({ knownWords: {} }, "local");
  const visible = segment.querySelectorAll(".clever-subtitle-unknown");
  assert.equal(segment.textContent, "He likes her");
  assert.equal(visible[1].textContent, "likes");
  assert.equal(visible[1].dataset.cleverWord, "like");

  documentListeners.mouseover({ target: visible[1] });
  const button = body.nodes.find((node) => node.className === "clever-subtitle-word-button");
  assert.equal(button.textContent, "+");
  assert.equal(button.title, "Add “like” to My Vocabulary");
  assert.equal(button["aria-label"], button.title);
  assert.equal(button.style.top, "172px");
  assert.equal(button.style.left, "111px");
  await button.listeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(Array.from(savedWords), ["existing", "like"]);
  assert.equal(segment.textContent, "He likes her");
  assert.deepEqual(hidden(), ["likes"]);

  const knownLike = segment.querySelectorAll(".clever-subtitle-known")[0];
  assert.equal(knownLike.dataset.cleverWord, "like");
  knownLike.getClientRects = () => [{ left: 100, top: 200, right: 150, bottom: 220, width: 50, height: 20 }];
  const playerOverlay = new FakeElement();
  let touchWasHandled = false;
  windowListeners.pointerdown({
    pointerType: "touch",
    target: playerOverlay,
    clientX: 125,
    clientY: 210,
    preventDefault() { touchWasHandled = true; },
    stopImmediatePropagation() {}
  });
  assert.equal(touchWasHandled, true);
  assert.equal(knownLike.classList.contains("clever-subtitle-active"), false);
  assert.equal(body.classList.contains("clever-subtitle-reveal-known"), true);
  assert.equal(button.hidden, true, "The first tap only reveals known words");
  let touchStartWasBlocked = false;
  windowListeners.touchstart({
    target: playerOverlay,
    changedTouches: [{ clientX: 125, clientY: 210 }],
    preventDefault() { touchStartWasBlocked = true; },
    stopImmediatePropagation() {}
  });
  assert.equal(touchStartWasBlocked, true);
  let touchEndWasBlocked = false;
  windowListeners.touchend({
    target: playerOverlay,
    changedTouches: [{ clientX: 125, clientY: 210 }],
    preventDefault() { touchEndWasBlocked = true; },
    stopImmediatePropagation() {}
  });
  assert.equal(touchEndWasBlocked, true);
  windowListeners.pointerdown({
    pointerType: "touch", target: playerOverlay, clientX: 125, clientY: 210,
    preventDefault() {}, stopImmediatePropagation() {}
  });
  windowListeners.pointerup({
    pointerType: "touch", clientX: 125, clientY: 210,
    preventDefault() {}, stopImmediatePropagation() {}
  });
  assert.equal(knownLike.classList.contains("clever-subtitle-active"), true);
  assert.equal(button.textContent, "−");
  assert.equal(button.title, "Remove “like” from My Vocabulary");
  documentListeners.mouseout({ target: knownLike, relatedTarget: null });
  assert.equal(button.hidden, false);
  await button.listeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(Array.from(savedWords), ["existing", "like"]);
  let accidentalButtonClickWasBlocked = false;
  windowListeners.click({
    target: button,
    clientX: 125,
    clientY: 210,
    preventDefault() { accidentalButtonClickWasBlocked = true; },
    stopImmediatePropagation() {}
  });
  assert.equal(accidentalButtonClickWasBlocked, true);
  assert.deepEqual(Array.from(savedWords), ["existing", "like"]);
  assert.equal(button.hidden, false);

  windowListeners.pointerdown({
    pointerType: "touch",
    target: playerOverlay,
    clientX: 125,
    clientY: 210,
    preventDefault() {},
    stopImmediatePropagation() {}
  });
  let playerClickWasBlocked = false;
  windowListeners.click({
    target: playerOverlay,
    clientX: 125,
    clientY: 210,
    preventDefault() { playerClickWasBlocked = true; },
    stopImmediatePropagation() {}
  });
  assert.equal(playerClickWasBlocked, true);
  button.listeners.pointerdown({ pointerType: "touch", stopPropagation() {} });
  await button.listeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(Array.from(savedWords), ["existing"]);
  assert.equal(segment.textContent, "He likes her");
  assert.deepEqual(hidden(), []);

  segment.textContent = "A new word";
  onMutation([{ target: segment, addedNodes: [] }]);
  const newWord = segment.querySelectorAll(".clever-subtitle-unknown").find((node) => node.textContent === "word");
  documentListeners.mouseover({ target: newWord, sourceCapabilities: { firesTouchEvents: false } });
  assert.equal(button.hidden, false);
  let outsideTapWasBlocked = false;
  windowListeners.pointerdown({
    pointerType: "touch",
    target: playerOverlay,
    clientX: 900,
    clientY: 100,
    preventDefault() { outsideTapWasBlocked = true; },
    stopImmediatePropagation() {}
  });
  assert.equal(outsideTapWasBlocked, false);
  assert.equal(button.hidden, true);
  newWord.getClientRects = () => [{ left: 100, top: 200, right: 150, bottom: 220, width: 50, height: 20 }];
  windowListeners.pointerdown({
    pointerType: "touch",
    target: playerOverlay,
    clientX: 125,
    clientY: 210,
    preventDefault() {},
    stopImmediatePropagation() {}
  });
  const replacementFirst = new FakeElement("A new");
  const replacementLast = new FakeElement("word");
  replacementFirst.className = "ytp-caption-segment";
  replacementLast.className = "ytp-caption-segment";
  segments.splice(0, 1, replacementFirst, replacementLast);
  onMutation([{ target: replacementLast, addedNodes: [replacementLast] }]);
  assert.equal(button.hidden, false);
  assert.equal(replacementLast.querySelectorAll(".clever-subtitle-unknown")
    .find((node) => node.textContent === "word").classList.contains("clever-subtitle-active"), true);
  segments.pop();
  onMutation([{ target: segment, addedNodes: [] }]);
  assert.equal(button.hidden, true);
});

function createPlayer({ paused = false, knownWords = [], nlp = cachedNLP, deferVocabularyRead = false,
    dictionaryLanguage, dictionaryLookup = offlineDictionary.lookup } = {}) {
  const body = new FakeElement();
  const player = new FakeElement();
  player.className = "html5-video-player";
  body.appendChild(player);
  const video = new FakeElement("", "video");
  video.className = "html5-main-video";
  video.paused = paused;
  video.ended = false;
  video.seeking = false;
  video.isConnected = true;
  video.currentTime = 24;
  video.pauseCalls = 0;
  video.playCalls = 0;
  video.pause = () => { video.pauseCalls++; video.paused = true; };
  video.play = () => {
    video.playCalls++;
    video.paused = false;
    video.listeners.play?.();
    return Promise.resolve();
  };
  player.appendChild(video);
  const cc = new FakeElement("", "button");
  cc.className = "ytp-subtitles-button";
  cc.setAttribute("aria-pressed", "true");
  player.appendChild(cc);
  const captions = new FakeElement();
  captions.className = "captions-text";
  player.appendChild(captions);
  const documentListeners = {};
  const windowListeners = {};
  let onMutation;
  let onStorageChanged;
  let savedWords = knownWords;
  let onPlayerResize;
  let vocabularyCallback;
  let selectedDictionaryLanguage = dictionaryLanguage;
  const dictionaryRequests = [];
  const context = {
    CleverSubtitleWords: words,
    CleverSubtitleStream: streams,
    CleverSubtitleInteraction: interactions,
    CleverSubtitleNLP: nlp,
    Node: { ELEMENT_NODE: 1 },
    setTimeout,
    clearTimeout,
    window: {
      innerWidth: 1200,
      innerHeight: 720,
      addEventListener(type, listener) { windowListeners[type] = listener; }
    },
    document: {
      documentElement: body,
      body,
      addEventListener(type, listener) { documentListeners[type] = listener; },
      querySelectorAll: (selector) => body.querySelectorAll(selector),
      querySelector: (selector) => body.querySelector(selector),
      createElement: (tagName) => new FakeElement("", tagName),
      createTextNode: (text) => new FakeText(text),
      createDocumentFragment: () => ({
        nodes: [],
        appendChild(node) { this.nodes.push(node); }
      })
    },
    chrome: {
      runtime: {
        lastError: null,
        async sendMessage(message) {
          const { type, mutation } = message;
          if (type === "dictionary:lookup") {
            dictionaryRequests.push(message);
            return { ok: true, result: await dictionaryLookup(message) };
          }
          assert.equal(type, "vocab:mutate");
          const next = new Set(savedWords);
          for (const word of mutation.add || []) next.add(word);
          for (const word of mutation.remove || []) next.delete(word);
          savedWords = [...next].sort();
          onStorageChanged({ knownWords: {} }, "local");
          return { ok: true, words: savedWords };
        }
      },
      storage: {
        local: {
          get: (_key, callback) => {
            if (_key === dictionary.STORAGE_KEY) {
              const data = { [dictionary.STORAGE_KEY]: selectedDictionaryLanguage };
              return callback ? callback(data) : Promise.resolve(data);
            }
            if (!callback) return Promise.resolve({ knownWords: savedWords });
            if (deferVocabularyRead) vocabularyCallback = callback;
            else callback({ knownWords: savedWords });
          },
          set: async ({ knownWords: next }) => {
            savedWords = next;
            onStorageChanged({ knownWords: {} }, "local");
          }
        },
        onChanged: { addListener: (listener) => { onStorageChanged = listener; } }
      }
    },
    MutationObserver: class {
      constructor(callback) { onMutation = callback; }
      observe() {}
    },
    ResizeObserver: class {
      constructor(callback) { onPlayerResize = callback; }
      disconnect() {}
      observe() {}
    }
  };
  context.globalThis = context;
  if (dictionaryLanguage !== undefined) {
    vm.runInNewContext(fs.readFileSync("dictionary-catalog.js", "utf8"), context);
    vm.runInNewContext(fs.readFileSync("dictionary.js", "utf8"), context);
    vm.runInNewContext(fs.readFileSync("word-meaning.js", "utf8"), context);
  }
  vm.runInNewContext(fs.readFileSync("content.js", "utf8"), context);
  const mutate = (target = captions, { addedNodes = [], removedNodes = [] } = {}) =>
    onMutation([{ target, addedNodes, removedNodes }]);
  const setCaption = (...texts) => {
    const segments = texts.map((text) => {
      const segment = new FakeElement(text);
      segment.className = "ytp-caption-segment";
      return segment;
    });
    captions.replaceChildren({ nodes: segments });
    mutate();
    return segments;
  };
  const setCaptionRows = (...rows) => {
    const elements = rows.map((texts) => {
      const row = new FakeElement();
      row.className = "caption-visual-line";
      for (const text of texts) {
        const segment = new FakeElement(text);
        segment.className = "ytp-caption-segment";
        row.appendChild(segment);
      }
      return row;
    });
    captions.replaceChildren({ nodes: elements });
    mutate();
    return elements;
  };
  return {
    body, player, video, cc, captions, context, documentListeners, windowListeners, setCaption, setCaptionRows, mutate,
    savedWords: () => Array.from(savedWords),
    dictionaryRequests,
    setDictionaryLanguage(next) {
      selectedDictionaryLanguage = next;
      onStorageChanged({ [dictionary.STORAGE_KEY]: { newValue: next } }, "local");
    },
    refreshDictionarySettings(changes) { onStorageChanged(changes, "local"); },
    resizePlayer: () => onPlayerResize?.(),
    loadVocabulary: () => vocabularyCallback({ knownWords: savedWords }),
    setKnownWords(next) { savedWords = next; onStorageChanged({ knownWords: {} }, "local"); },
    find: (selector) => body.querySelector(selector),
    hover: (element) => documentListeners.mouseover({ target: element,
      sourceCapabilities: { firesTouchEvents: false } }),
    click: (element) => element.listeners.click({ preventDefault() {}, stopPropagation() {} })
  };
}

function emitTouch(app, type, target, x, y, extra = {}) {
  const result = { prevented: false, blocked: false };
  app.windowListeners[type]({
    pointerType: "touch", target, clientX: x, clientY: y,
    changedTouches: [{ clientX: x, clientY: y }],
    ...extra,
    preventDefault() { result.prevented = true; },
    stopImmediatePropagation() { result.blocked = true; }
  });
  return result;
}

const settleMeanings = () => new Promise((resolve) => setImmediate(resolve));
function selectWithMouse(app, word) {
  const rect = word.getBoundingClientRect();
  const x = (rect.left + rect.right) / 2, y = (rect.top + rect.bottom) / 2;
  emitTouch(app, "pointerdown", word, x, y, { pointerType: "mouse", button: 0 });
  emitTouch(app, "pointerup", word, x, y, { pointerType: "mouse", button: 0 });
}

function interactionScene(options = {}) {
  const app = createPlayer({ knownWords: ["like", "give"], dictionaryLanguage: "zh", ...options });
  app.setCaption("I like this");
  app.setCaption("It gives conditions");
  app.click(app.find(".clever-subtitle-review-toggle"));
  const placeWords = () => {
    for (const [location, caption] of [["current", app.captions], ["review", app.find(".clever-subtitle-review-caption")]]) {
      const words = caption.querySelectorAll(".clever-subtitle-known, .clever-subtitle-unknown");
      words.forEach((word, index) => {
        const left = location === "current" ? 700 + index * 90 : 60 + index * 145;
        const top = location === "current" ? 430 : 150;
        word.getBoundingClientRect = () => ({ left, top, right: left + 55, bottom: top + 24, width: 55, height: 24 });
        word.getClientRects = () => [word.getBoundingClientRect()];
      });
    }
  };
  placeWords();
  const getWord = (text, location) => (location === "current" ? app.captions : app.find(".clever-subtitle-review-caption"))
    .querySelectorAll(".clever-subtitle-known, .clever-subtitle-unknown").find((word) => word.textContent === text);
  return { app, getWord, placeWords, known: (location) => getWord(location === "current" ? "gives" : "like", location),
    visible: (location) => getWord(location === "current" ? "conditions" : "this", location) };
}

test("desktop click, hover, reflow and save keep the word card separate from the temporary button", async () => {
  for (const selectedLocation of ["current", "review"]) for (const hoverLocation of ["current", "review"]) {
    const { app, known, visible, placeWords } = interactionScene();
    const selectedText = visible(selectedLocation).textContent;
    const hoveredText = known(hoverLocation).textContent;
    selectWithMouse(app, visible(selectedLocation));
    await settleMeanings();
    const card = app.find(".clever-subtitle-meaning");
    const heading = card.querySelector(".clever-subtitle-meaning-word").textContent;
    const pauses = app.video.pauseCalls, requests = app.dictionaryRequests.length;
    assert.equal(app.body.classList.contains("clever-subtitle-reveal-known"), false);
    app.hover(known(hoverLocation));
    assert.equal(app.find(".clever-subtitle-active").textContent, hoveredText);
    assert.equal(app.find(".clever-subtitle-word-button").textContent, "−");
    assert.equal(app.body.classList.contains("clever-subtitle-reveal-known"), true);
    assert.equal(card.querySelector(".clever-subtitle-meaning-word").textContent, heading);
    app.setCaption("It gives", "conditions");
    placeWords();
    app.mutate();
    assert.equal(app.find(".clever-subtitle-active").textContent, hoveredText);
    assert.equal(card.querySelector(".clever-subtitle-meaning-word").textContent, heading);
    const button = app.find(".clever-subtitle-word-button");
    await app.click(button);
    assert.ok(!app.savedWords().includes(hoverLocation === "current" ? "give" : "like"));
    assert.equal(button.textContent, "+");
    assert.equal(card.querySelector(".clever-subtitle-meaning-word").textContent, heading,
      "Changing the hovered word must not change the clicked word's dictionary card");
    app.documentListeners.mouseout({ target: known(hoverLocation), relatedTarget: null });
    await new Promise((resolve) => setTimeout(resolve, 270));
    assert.equal(app.find(".clever-subtitle-active").textContent, selectedText);
    assert.equal(app.body.classList.contains("clever-subtitle-reveal-known"), false);
    assert.equal(app.dictionaryRequests.length, requests, "Hovering and saving must not query another word");
    assert.equal(app.video.pauseCalls, pauses);
    app.context.document.fullscreenElement = app.player;
    app.documentListeners.fullscreenchange();
    assert.equal(card.parentElement, app.player);
    await app.video.play();
    assert.equal(card.hidden, true);
    assert.equal(button.hidden, true);
  }
});

test("desktop clicking a fully visible word replaces a known-word reveal across both caption views", async () => {
  for (const hiddenLocation of ["current", "review"]) for (const visibleLocation of ["current", "review"]) {
    const { app, known, visible } = interactionScene();
    selectWithMouse(app, known(hiddenLocation));
    await settleMeanings();
    assert.equal(app.body.classList.contains("clever-subtitle-reveal-known"), true);
    app.hover(visible(visibleLocation));
    assert.equal(app.body.classList.contains("clever-subtitle-reveal-known"), true,
      "A temporary visible-word hover must not cancel the clicked known-word reveal");
    selectWithMouse(app, visible(visibleLocation));
    await settleMeanings();
    assert.equal(app.body.classList.contains("clever-subtitle-reveal-known"), false);
    assert.equal(app.find(".clever-subtitle-active"), visible(visibleLocation));
    assert.equal(app.find(".clever-subtitle-word-button").textContent, "+");
    const card = app.find(".clever-subtitle-meaning");
    const heading = card.querySelector(".clever-subtitle-meaning-word").textContent;
    await app.click(app.find(".clever-subtitle-word-button"));
    assert.equal(app.find(".clever-subtitle-word-button").textContent, "−");
    assert.equal(app.body.classList.contains("clever-subtitle-reveal-known"), false,
      "Saving a word does not reinterpret the last click as a hidden-word click");
    assert.equal(card.querySelector(".clever-subtitle-meaning-word").textContent, heading);
    app.hover(known(hiddenLocation));
    assert.equal(app.body.classList.contains("clever-subtitle-reveal-known"), true);
    await app.video.play();
    assert.equal(app.body.classList.contains("clever-subtitle-reveal-known"), false);
    assert.equal(app.find(".clever-subtitle-word-button").hidden, true);
    assert.equal(card.hidden, true);
  }
});

test("mobile reveal, faint selection, visible selection and repeat reveal use one transition per physical tap", async () => {
  for (const paths of [["pointer"], ["touch"], ["pointer", "touch"]]) {
    for (const hiddenLocation of ["current", "review"]) for (const visibleLocation of ["current", "review"]) {
      const { app, known, visible } = interactionScene();
      const tap = (word) => {
        const rect = word.getBoundingClientRect(), x = rect.left + 25, y = rect.top + 12;
        for (const path of paths) emitTouch(app, path === "pointer" ? "pointerdown" : "touchstart", app.player, x, y);
        for (const path of paths) emitTouch(app, path === "pointer" ? "pointerup" : "touchend", app.player, x, y);
        emitTouch(app, "click", app.player, x, y, { detail: 1 });
      };
      tap(known(hiddenLocation));
      await settleMeanings();
      assert.equal(app.find(".clever-subtitle-word-button"), null);
      assert.equal(app.dictionaryRequests.length, 0);
      tap(known(hiddenLocation));
      await settleMeanings();
      assert.equal(app.find(".clever-subtitle-word-button").textContent, "−");
      assert.equal(app.body.classList.contains("clever-subtitle-reveal-known"), true);
      tap(visible(visibleLocation));
      await settleMeanings();
      assert.equal(app.body.classList.contains("clever-subtitle-reveal-known"), false);
      assert.equal(app.find(".clever-subtitle-active"), visible(visibleLocation));
      const requests = app.dictionaryRequests.length;
      tap(known(hiddenLocation));
      await settleMeanings();
      assert.equal(app.find(".clever-subtitle-word-button").hidden, true);
      assert.equal(app.find(".clever-subtitle-meaning").hidden, true);
      assert.equal(app.dictionaryRequests.length, requests, "The next hidden tap must reveal only again");
      tap(known(hiddenLocation));
      await settleMeanings();
      const card = app.find(".clever-subtitle-meaning");
      assert.equal(card.hidden, false);
      assert.equal(app.body.classList.contains("clever-subtitle-reveal-known"), true);
      app.documentListeners.mouseover({ target: visible(visibleLocation), sourceCapabilities: { firesTouchEvents: true } });
      assert.equal(app.find(".clever-subtitle-active"), known(hiddenLocation));
      assert.equal(app.video.pauseCalls, 1);
      assert.equal(app.video.currentTime, 24);
      assert.deepEqual(app.savedWords(), ["like", "give"]);
    }
  }
});

test("closing review or dropping one word does not clear a selected word in the other caption", async () => {
  const { app, known, visible } = interactionScene({ paused: true });
  selectWithMouse(app, visible("current"));
  await settleMeanings();
  const card = app.find(".clever-subtitle-meaning");
  app.hover(known("review"));
  app.click(app.find(".clever-subtitle-review-close"));
  assert.equal(app.find(".clever-subtitle-active"), visible("current"));
  assert.equal(card.hidden, false);
  assert.equal(app.body.classList.contains("clever-subtitle-reveal-known"), false);
  assert.equal(app.video.playCalls, 0, "Closing review preserves a video that was already paused");
  app.click(app.find(".clever-subtitle-review-toggle"));
  selectWithMouse(app, known("review"));
  await settleMeanings();
  app.hover(visible("current"));
  app.setCaption("The current words are gone");
  assert.equal(app.find(".clever-subtitle-active"), known("review"));
  assert.equal(card.hidden, false);
  assert.equal(app.body.classList.contains("clever-subtitle-reveal-known"), true);
  app.video.seeking = true;
  app.video.listeners.seeking({ type: "seeking" });
  assert.equal(card.hidden, true);
  assert.equal(app.find(".clever-subtitle-word-button").hidden, true);
  assert.equal(app.body.classList.contains("clever-subtitle-reveal-known"), false);
});

test("word cards show only a base form and at most three different displayed entries", async () => {
  const app = createPlayer({ dictionaryLanguage: "zh", dictionaryLookup: async () => ({ word: "condition", entries: [
    { pos: "noun", translations: ["条件"] }, { pos: "noun", translations: ["条件"] },
    { pos: "noun", translations: ["情况"] }, { pos: "verb", translations: ["调节"] },
    { pos: "noun", translations: ["状态"] }
  ] }) });
  const [caption] = app.setCaption("These conditions matter.");
  selectWithMouse(app, caption.querySelectorAll(".clever-subtitle-unknown")[1]);
  await settleMeanings();
  const card = app.find(".clever-subtitle-meaning");
  assert.equal(card.querySelector(".clever-subtitle-meaning-word").textContent, "condition");
  assert.equal(card.querySelectorAll(".clever-subtitle-meaning-entry").length, 3);
  assert.doesNotMatch(card.textContent, /conditions|→|状态|Common meanings|WikDict|Offline/);
});

test("offline word cards appear on desktop clicks in current and previous captions, using the lemma independently of removal", async () => {
  for (const inReview of [false, true]) {
    const app = createPlayer({ dictionaryLanguage: "zh", knownWords: ["understanding"] });
    const [current] = app.setCaption("His focus was on understanding what happens.");
    let caption = current;
    if (inReview) {
      app.setCaption("A new sentence.");
      app.click(app.find(".clever-subtitle-review-toggle"));
      caption = app.find(".clever-subtitle-review-caption");
    }
    const selected = caption.querySelectorAll(".clever-subtitle-known").find((word) => word.textContent === "understanding");
    assert.equal(selected.dataset.cleverWord, "understanding");
    assert.equal(selected.dataset.cleverLemma, "understand");
    app.hover(selected);
    assert.equal(app.find(".clever-subtitle-meaning"), null);
    assert.equal(app.dictionaryRequests.length, 0);
    selectWithMouse(app, selected);
    await settleMeanings();
    const card = app.find(".clever-subtitle-meaning");
    assert.equal(card.hidden, false);
    assert.equal(card.querySelector(".clever-subtitle-meaning-word").textContent, "understand");
    assert.match(card.textContent, /明白/);
    assert.equal(app.video.paused, true);
    assert.equal(app.find(".clever-subtitle-word-button").textContent, "−");
    app.mutate(caption);
    await settleMeanings();
    assert.equal(app.dictionaryRequests.length, 1, "Re-rendering must not repeatedly look up the same word");
    const fullscreen = new FakeElement();
    app.body.appendChild(fullscreen);
    app.context.document.fullscreenElement = fullscreen;
    app.documentListeners.fullscreenchange();
    assert.equal(card.parentElement, fullscreen);
    await app.video.play();
    assert.equal(card.hidden, true);
  }
});

test("mobile reveal-only taps do not query dictionaries, while the second tap opens a card without changing vocabulary", async () => {
  for (const inReview of [false, true]) {
    const app = createPlayer({ dictionaryLanguage: "zh", knownWords: ["give"] });
    const [current] = app.setCaption("It gives you a result.");
    let caption = current;
    if (inReview) {
      app.setCaption("Now another sentence.");
      app.click(app.find(".clever-subtitle-review-toggle"));
      caption = app.find(".clever-subtitle-review-caption");
    }
    const word = caption.querySelector(".clever-subtitle-known");
    const tap = () => {
      for (const type of ["pointerdown", "touchstart", "pointerup", "touchend"]) emitTouch(app, type, word, 125, 210);
    };
    tap();
    await settleMeanings();
    assert.equal(app.find(".clever-subtitle-meaning"), null);
    assert.equal(app.dictionaryRequests.length, 0);
    tap();
    await settleMeanings();
    const card = app.find(".clever-subtitle-meaning");
    assert.equal(card.hidden, false);
    assert.equal(card.querySelector(".clever-subtitle-meaning-word").textContent, "give");
    assert.match(card.textContent, /给/);
    assert.equal(app.dictionaryRequests.length, 1);
    assert.deepEqual(app.savedWords(), ["give"]);
    assert.equal(app.find(".clever-subtitle-word-button").textContent, "−");
  }
  const app = createPlayer({ dictionaryLanguage: "zh" });
  const [caption] = app.setCaption("I like this.");
  const word = caption.querySelectorAll(".clever-subtitle-unknown").find((node) => node.textContent === "like");
  emitTouch(app, "pointerdown", word, 125, 210);
  emitTouch(app, "pointerup", word, 125, 210);
  await settleMeanings();
  assert.match(app.find(".clever-subtitle-meaning").textContent, /喜欢/);
});

test("old dictionary replies cannot replace another word, another language, or a closed card", async () => {
  const pending = [];
  const app = createPlayer({ dictionaryLanguage: "zh", dictionaryLookup: (query) => new Promise((resolve) => pending.push({ query, resolve })) });
  const [caption] = app.setCaption("I like the bank.");
  const words = caption.querySelectorAll(".clever-subtitle-unknown");
  selectWithMouse(app, words.find((word) => word.textContent === "like"));
  await settleMeanings();
  selectWithMouse(app, words.find((word) => word.textContent === "bank."));
  await settleMeanings();
  app.setDictionaryLanguage("es");
  await settleMeanings();
  const answer = (task, translation) => task.resolve({ word: task.query.lemma, language: task.query.language,
    entries: [{ pos: "noun", translations: [translation] }] });
  answer(pending[2], "banco");
  await settleMeanings();
  const card = app.find(".clever-subtitle-meaning");
  assert.match(card.textContent, /banco/);
  answer(pending[0], "喜欢"); answer(pending[1], "银行");
  await settleMeanings();
  assert.match(card.textContent, /banco/);
  assert.doesNotMatch(card.textContent, /喜欢|银行/);
  selectWithMouse(app, words.find((word) => word.textContent === "like"));
  await settleMeanings();
  await app.video.play();
  answer(pending[3], "gustar");
  await settleMeanings();
  assert.equal(card.hidden, true);
});

test("word cards allow scrolling and block the player, stay inside a phone viewport, and reset on seeking", async () => {
  const app = createPlayer({ dictionaryLanguage: "zh" });
  app.context.window.innerWidth = 360;
  app.context.window.innerHeight = 640;
  const [caption] = app.setCaption("I like this.");
  const word = caption.querySelectorAll(".clever-subtitle-unknown").find((node) => node.textContent === "like");
  word.getBoundingClientRect = () => ({ left: 160, right: 200, top: 590, bottom: 615, width: 40, height: 25 });
  emitTouch(app, "pointerdown", word, 180, 600);
  emitTouch(app, "pointerup", word, 180, 600);
  await settleMeanings();
  const card = app.find(".clever-subtitle-meaning"), rect = card.getBoundingClientRect();
  assert.ok(rect.left >= 8 && rect.right <= 352);
  assert.ok(rect.top >= 8 && rect.bottom <= 590 - 28);
  const x = rect.left + 10, y = rect.top + 10;
  const pauses = app.video.pauseCalls;
  const direct = emitTouch(app, "pointerdown", card, x, y);
  assert.equal(direct.blocked, true);
  assert.equal(direct.prevented, false, "Direct card touches must retain native scrolling");
  emitTouch(app, "pointerup", card, x, y);
  const covered = emitTouch(app, "pointerdown", app.player, x, y);
  assert.equal(covered.blocked, true);
  emitTouch(app, "pointermove", app.player, x, y - 20);
  emitTouch(app, "pointerup", app.player, x, y - 20);
  assert.equal(card.scrollTop, 20);
  assert.equal(app.video.pauseCalls, pauses);
  assert.deepEqual(app.savedWords(), []);
  app.video.seeking = true;
  app.video.listeners.seeking({ type: "seeking" });
  assert.equal(card.hidden, true);
});

test("word cards explain an unset language, show missing meanings, and retry a failed local lookup", async () => {
  let fail = true;
  const app = createPlayer({ dictionaryLanguage: "off", dictionaryLookup: async (query) => {
    if (fail) { fail = false; throw new Error("Could not load the offline dictionary."); }
    return offlineDictionary.lookup(query);
  } });
  const [caption] = app.setCaption("qqqnotarealwordqqq");
  const word = caption.querySelector(".clever-subtitle-unknown");
  selectWithMouse(app, word);
  await settleMeanings();
  const card = app.find(".clever-subtitle-meaning");
  assert.match(card.textContent, /Choose a language/);
  assert.equal(app.dictionaryRequests.length, 0);
  app.setDictionaryLanguage("zh");
  await settleMeanings();
  assert.match(card.textContent, /Could not load/);
  selectWithMouse(app, word);
  await settleMeanings();
  assert.match(card.textContent, /No meaning found/);
});

test("perilous has a readable grammar label and no unexplained reverse translation or footer", async () => {
  const app = createPlayer({ dictionaryLanguage: "zh" });
  const [caption] = app.setCaption("A perilous journey.");
  const word = caption.querySelectorAll(".clever-subtitle-unknown").find((node) => node.textContent === "perilous");
  selectWithMouse(app, word);
  await settleMeanings();
  const card = app.find(".clever-subtitle-meaning");
  assert.match(card.textContent, /形容词: 危险/);
  assert.doesNotMatch(card.textContent, /岌|Common meanings|WikDict|Offline|adjective/);
  assert.equal(card.querySelector(".clever-subtitle-meaning-source"), null);
  app.setDictionaryLanguage("es");
  await settleMeanings();
  assert.match(card.textContent, /adjetivo: /);
});

test("changing the meaning provider or key refreshes a selected card and rejects its old response", async () => {
  const pending = [];
  const app = createPlayer({ dictionaryLanguage: "zh-Hans", dictionaryLookup: (query) =>
    new Promise((resolve) => pending.push({ query, resolve })) });
  const [caption] = app.setCaption("conditions");
  selectWithMouse(app, caption.querySelector(".clever-subtitle-unknown"));
  await settleMeanings();
  app.refreshDictionarySettings({ [dictionary.PROVIDER_KEY]: { newValue: "microsoft" },
    [dictionary.MICROSOFT_CONFIG_KEY]: { newValue: { key: "test-key" } } });
  await settleMeanings();
  assert.equal(pending.length, 2);
  const result = (translation) => ({ word: "condition", language: "zh-Hans",
    entries: [{ pos: "noun", translations: [translation] }] });
  pending[1].resolve(result("new meaning")); await settleMeanings();
  const card = app.find(".clever-subtitle-meaning");
  assert.match(card.textContent, /condition.*名词: new meaning/);
  pending[0].resolve(result("old meaning")); await settleMeanings();
  assert.doesNotMatch(card.textContent, /old meaning/);
  assert.equal(pending[1].query.lemma, "condition");
  assert.equal(pending[1].query.key, undefined, "Content scripts never send the Microsoft key");
});

function movableReview(app, { scale = 1 } = {}) {
  const geometry = { left: 80, top: 60, width: 640, height: 420, scale };
  const review = app.find(".clever-subtitle-review");
  const toggle = app.find(".clever-subtitle-review-toggle");
  const panel = app.find(".clever-subtitle-review-panel");
  const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });
  app.player.getBoundingClientRect = () => rect(geometry.left, geometry.top,
    geometry.width * geometry.scale, geometry.height * geometry.scale);
  Object.defineProperty(app.player, "clientWidth", { get: () => geometry.width });
  Object.defineProperty(app.player, "clientHeight", { get: () => geometry.height });
  toggle.getBoundingClientRect = () => {
    const left = review.style.left === "auto"
      ? geometry.width - 160 - parseFloat(review.style.right)
      : parseFloat(review.style.left || "12");
    return rect(geometry.left + left * geometry.scale,
      geometry.top + parseFloat(review.style.top || "12") * geometry.scale, 160 * geometry.scale, 44 * geometry.scale);
  };
  app.resizePlayer();
  const center = () => {
    const bounds = toggle.getBoundingClientRect();
    return [bounds.left + bounds.width / 2, bounds.top + bounds.height / 2];
  };
  return { review, toggle, panel, geometry, center };
}

test("a separate covered tap changes a word on release without waiting for a native click", async () => {
  for (const paths of [["pointer"], ["touch"], ["pointer", "touch"], ["mouse"]]) {
    const app = createPlayer();
    const [segment] = app.setCaption("He likes her");
    const word = segment.querySelectorAll(".clever-subtitle-unknown")[1];
    word.getClientRects = () => [word.getBoundingClientRect()];
    if (paths[0] === "mouse") app.hover(word);
    else {
      emitTouch(app, "pointerdown", app.player, 125, 210);
      emitTouch(app, "pointerup", app.player, 125, 210);
    }
    const button = app.find(".clever-subtitle-word-button");
    const { left, top, width, height } = button.getBoundingClientRect();
    const x = left + width / 2, y = top + height / 2;
    for (const path of paths) {
      const type = path === "touch" ? "touchstart" : "pointerdown";
      assert.equal(emitTouch(app, type, app.player, x, y,
        { pointerType: path === "mouse" ? "mouse" : "touch", button: 0 }).blocked, true);
    }
    assert.deepEqual(app.savedWords(), [], "Pressing the button must wait for release");
    for (const path of paths) emitTouch(app, path === "touch" ? "touchend" : "pointerup", app.player, x, y,
      { pointerType: path === "mouse" ? "mouse" : "touch", button: 0 });
    await new Promise(setImmediate);
    assert.deepEqual(app.savedWords(), ["like"]);
    assert.equal(emitTouch(app, "click", app.player, x, y).blocked, true,
      "The following synthetic click must not reach YouTube");
    assert.equal(segment.querySelector(".clever-subtitle-known").textContent, "likes");
    assert.equal(button.hidden, false, "Changing vocabulary keeps the current word target");
    assert.equal(button.textContent, "−");
  }
});

test("slow local saves show immediate feedback and failed saves remain retryable", async () => {
  const app = createPlayer();
  const [segment] = app.setCaption("He likes her");
  app.hover(segment.querySelectorAll(".clever-subtitle-unknown")[1]);
  const button = app.find(".clever-subtitle-word-button");
  const original = app.context.chrome.runtime.sendMessage;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  app.context.chrome.runtime.sendMessage = async (message) => { await gate; return original(message); };
  const pending = app.click(button);
  assert.equal(button.textContent, "…", "The saving state must be visible without hovering a tooltip");
  assert.equal(button.disabled, true);
  assert.deepEqual(app.savedWords(), []);
  release();
  await pending;
  assert.deepEqual(app.savedWords(), ["like"]);
  app.hover(segment.querySelector(".clever-subtitle-known"));
  app.context.chrome.runtime.sendMessage = async () => ({ ok: false, error: "Disk unavailable" });
  await app.click(button);
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "!");
  assert.deepEqual(app.savedWords(), ["like"]);
  app.context.chrome.runtime.sendMessage = original;
  await app.click(button);
  assert.deepEqual(app.savedWords(), []);
});

test("the selecting gesture and cancelled button gestures never change words, while the next separate tap does", async () => {
  const app = createPlayer();
  const [segment] = app.setCaption("He likes her");
  const word = segment.querySelectorAll(".clever-subtitle-unknown")[1];
  word.getClientRects = () => [word.getBoundingClientRect()];
  emitTouch(app, "pointerdown", app.player, 125, 210);
  const button = app.find(".clever-subtitle-word-button");
  const rect = button.getBoundingClientRect();
  const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
  // The browser can retarget the selecting touch to the newly shown button.
  emitTouch(app, "touchstart", button, x, y);
  emitTouch(app, "pointerup", app.player, 125, 210);
  emitTouch(app, "click", button, x, y);
  await new Promise(setImmediate);
  assert.deepEqual(app.savedWords(), []);
  assert.equal(button.hidden, false);
  emitTouch(app, "pointerdown", app.player, x, y);
  emitTouch(app, "pointermove", app.player, x + 40, y);
  emitTouch(app, "pointerup", app.player, x + 40, y);
  assert.deepEqual(app.savedWords(), []);
  emitTouch(app, "touchstart", app.player, x, y);
  emitTouch(app, "touchcancel", app.player, x, y);
  emitTouch(app, "touchend", app.player, x, y);
  assert.deepEqual(app.savedWords(), []);
  emitTouch(app, "pointerdown", app.player, x, y);
  emitTouch(app, "pointerup", app.player, x, y);
  await new Promise(setImmediate);
  assert.deepEqual(app.savedWords(), ["like"]);
});

test("a covered minus button in Previous caption removes the saved base word exactly once", async () => {
  const app = createPlayer({ knownWords: ["like"] });
  app.setCaption("He likes her");
  app.setCaption("The next sentence");
  app.click(app.find(".clever-subtitle-review-toggle"));
  const word = app.find(".clever-subtitle-review-caption").querySelector(".clever-subtitle-known");
  word.getClientRects = () => [word.getBoundingClientRect()];
  emitTouch(app, "touchstart", app.player, 125, 210);
  emitTouch(app, "touchend", app.player, 125, 210);
  assert.equal(app.find(".clever-subtitle-word-button"), null, "A hidden word needs a separate selecting tap");
  assert.equal(app.body.classList.contains("clever-subtitle-reveal-known"), true);
  emitTouch(app, "touchstart", app.player, 125, 210);
  emitTouch(app, "touchend", app.player, 125, 210);
  const button = app.find(".clever-subtitle-word-button");
  assert.equal(button.textContent, "−");
  const rect = button.getBoundingClientRect();
  const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
  let mutations = 0;
  const original = app.context.chrome.runtime.sendMessage;
  app.context.chrome.runtime.sendMessage = (message) => { mutations++; return original(message); };
  emitTouch(app, "pointerdown", app.player, x, y);
  emitTouch(app, "touchstart", app.player, x, y);
  emitTouch(app, "pointerup", app.player, x, y);
  emitTouch(app, "touchend", app.player, x, y);
  await new Promise(setImmediate);
  emitTouch(app, "click", button, x, y);
  assert.equal(mutations, 1);
  assert.deepEqual(app.savedWords(), []);
  assert.equal(app.find(".clever-subtitle-review-panel").hidden, false);
  assert.equal(app.video.paused, true);
});

test("Previous caption drags through covered mouse and touch targets and snaps to either player edge", () => {
  for (const paths of [["pointer"], ["touch"], ["pointer", "touch"], ["mouse"]]) {
    const app = createPlayer();
    app.setCaption("First sentence");
    app.setCaption("Second sentence");
    const { review, toggle, panel, center } = movableReview(app);
    const emit = (phase, x, y) => {
      for (const path of paths) {
        const type = path === "touch" ? { start: "touchstart", move: "touchmove", end: "touchend" }[phase]
          : { start: "pointerdown", move: "pointermove", end: "pointerup" }[phase];
        assert.equal(emitTouch(app, type, app.player, x, y,
          { pointerType: path === "mouse" ? "mouse" : "touch", button: 0 }).blocked, true);
      }
    };
    const [x, y] = center();
    emit("start", x, y);
    emit("move", x + 360, y + 130);
    assert.equal(review.classList.contains("clever-subtitle-review-dragging"), true);
    assert.equal(panel.hidden, true);
    app.setCaption("Third sentence");
    assert.equal(review.style.left, "372px", "A caption update must not undo an active drag");
    emit("end", x + 360, y + 130);
    assert.equal(review.style.left, "auto");
    assert.equal(review.style.right, "12px");
    assert.equal(review.style.top, "142px");
    assert.equal(review.classList.contains("clever-subtitle-review-dragging"), false);
    assert.equal(emitTouch(app, "click", toggle, x + 360, y + 130).blocked, true);
    const [rightX, rightY] = center();
    emit("start", rightX, rightY);
    emit("move", rightX - 410, rightY - 90);
    emit("end", rightX - 410, rightY - 90);
    assert.equal(review.style.left, "12px");
    assert.equal(review.style.right, "auto");
    assert.ok(Math.abs(parseFloat(review.style.top) - 52) < 0.001);
    assert.equal(panel.hidden, true);
    assert.equal(app.video.pauseCalls, 0, "Moving the button must not open review or affect playback");
    assert.equal(app.video.playCalls, 0);
  }
});

test("small mouse movements still open review once, cancelled drags stay closed, and keyboard clicks remain available", () => {
  const app = createPlayer();
  app.setCaption("First sentence");
  app.setCaption("Second sentence");
  const { review, toggle, panel, center } = movableReview(app);
  let [x, y] = center();
  const mouse = { pointerType: "mouse", button: 0 };
  emitTouch(app, "pointerdown", toggle, x, y, mouse);
  emitTouch(app, "pointermove", app.player, x + 3, y + 2, mouse);
  emitTouch(app, "pointerup", app.player, x + 3, y + 2, mouse);
  assert.equal(panel.hidden, false);
  assert.equal(app.video.pauseCalls, 1);
  assert.equal(emitTouch(app, "click", toggle, x + 3, y + 2, { detail: 1 }).blocked, true);
  assert.equal(panel.hidden, false);
  app.click(toggle);
  [x, y] = center();
  emitTouch(app, "pointerdown", app.player, x, y);
  emitTouch(app, "pointermove", app.player, x + 400, y + 100);
  emitTouch(app, "pointercancel", app.player, x + 400, y + 100);
  assert.equal(review.style.right, "12px");
  assert.equal(review.classList.contains("clever-subtitle-review-dragging"), false);
  assert.equal(emitTouch(app, "click", toggle, x + 400, y + 100, { detail: 1 }).blocked, true);
  assert.equal(panel.hidden, true);
  assert.equal(emitTouch(app, "click", toggle, 0, 0, { detail: 0 }).blocked, false);
  app.click(toggle);
  assert.equal(panel.hidden, false, "A keyboard click opens the review after a drag");
});

test("dragging an open review stays paused and keeps the panel in a scaled or resized player", () => {
  const app = createPlayer();
  app.setCaption("First sentence");
  app.setCaption("Second sentence");
  const { review, toggle, panel, geometry, center } = movableReview(app, { scale: 0.5 });
  app.click(toggle);
  const [x, y] = center();
  emitTouch(app, "touchstart", app.player, x, y);
  emitTouch(app, "touchmove", app.player, x + 800, y + 800);
  emitTouch(app, "touchend", app.player, x + 800, y + 800);
  assert.equal(panel.hidden, false);
  assert.equal(app.video.paused, true);
  assert.equal(app.video.playCalls, 0);
  assert.equal(review.style.right, "12px");
  assert.equal(review.style.top, "364px");
  assert.equal(panel.style.right, "0px");
  assert.equal(panel.style.bottom, "calc(100% + 8px)");
  assert.equal(panel.style.maxHeight, "300px");
  geometry.width = 320;
  geometry.height = 180;
  geometry.scale = 1;
  app.resizePlayer();
  assert.equal(review.style.right, "12px");
  assert.equal(review.style.top, "124px");
  assert.equal(panel.style.width, "296px");
  assert.equal(panel.style.maxHeight, "104px");
  app.documentListeners.fullscreenchange();
  assert.equal(review.style.top, "124px");
  app.click(toggle);
  app.setCaption("Third sentence");
  assert.equal(review.style.right, "12px", "A new caption keeps the chosen edge and height");
});

test("covered review buttons open and close once across touch and pointer events", () => {
  for (const paths of [["pointer"], ["touch"], ["pointer", "touch"]]) {
    const app = createPlayer();
    app.setCaption("First sentence");
    app.setCaption("Second sentence");
    const panel = app.find(".clever-subtitle-review-panel");
    const toggle = app.find(".clever-subtitle-review-toggle");
    const close = app.find(".clever-subtitle-review-close");
    for (const prefix of paths) {
      const type = prefix === "pointer" ? "pointerdown" : "touchstart";
      assert.equal(emitTouch(app, type, app.player, 60, 40).blocked, true);
    }
    assert.equal(panel.hidden, true, "A review button acts on release");
    for (const prefix of paths) {
      assert.equal(emitTouch(app, prefix === "pointer" ? "pointerup" : "touchend", app.player, 60, 40).blocked, true);
    }
    assert.equal(panel.hidden, false);
    assert.equal(app.video.pauseCalls, 1);
    assert.equal(app.find(".clever-subtitle-review-caption").textContent, "First sentence");
    assert.equal(emitTouch(app, "click", toggle, 60, 40).blocked, true,
      "A synthetic click must not immediately close the review again");
    assert.equal(panel.hidden, false);

    for (const prefix of paths) emitTouch(app, prefix === "pointer" ? "pointerdown" : "touchstart", app.player, 60, 340);
    for (const prefix of paths) emitTouch(app, prefix === "pointer" ? "pointerup" : "touchend", app.player, 60, 340);
    assert.equal(panel.hidden, true);
    assert.equal(app.video.playCalls, 1);
    assert.equal(emitTouch(app, "click", close, 60, 340).blocked, true);
    assert.equal(app.video.playCalls, 1);
  }
});

test("direct review taps toggle safely and preserve an existing pause", () => {
  const app = createPlayer({ paused: true });
  app.setCaption("First sentence");
  app.setCaption("Second sentence");
  const toggle = app.find(".clever-subtitle-review-toggle");
  const panel = app.find(".clever-subtitle-review-panel");
  for (const expectedHidden of [false, true]) {
    assert.equal(emitTouch(app, "pointerdown", toggle, 60, 40).blocked, true);
    emitTouch(app, "pointerup", toggle, 60, 40);
    assert.equal(panel.hidden, expectedHidden);
    emitTouch(app, "click", toggle, 60, 40);
    assert.equal(panel.hidden, expectedHidden);
  }
  assert.equal(app.video.paused, true);
  assert.equal(app.video.playCalls, 0);
});

test("dragged or cancelled review taps do not activate, and hidden review controls do not intercept", () => {
  const app = createPlayer();
  app.setCaption("First sentence");
  app.setCaption("Second sentence");
  const panel = app.find(".clever-subtitle-review-panel");
  emitTouch(app, "pointerdown", app.player, 60, 40);
  emitTouch(app, "pointermove", app.player, 300, 40);
  emitTouch(app, "pointerup", app.player, 300, 40);
  assert.equal(emitTouch(app, "click", app.player, 300, 40).blocked, true);
  assert.equal(panel.hidden, true);
  emitTouch(app, "touchstart", app.player, 60, 40);
  emitTouch(app, "touchcancel", app.player, 60, 40);
  emitTouch(app, "touchend", app.player, 60, 40);
  assert.equal(panel.hidden, true);
  assert.equal(app.video.pauseCalls, 0);
  app.cc.setAttribute("aria-pressed", "false");
  app.mutate(app.cc);
  assert.equal(emitTouch(app, "pointerdown", app.player, 60, 40).blocked, false);
});

test("covered review panel selects its words, clips hidden text, and scrolls without controlling YouTube", () => {
  const app = createPlayer();
  app.setCaption("A curious word");
  const [current] = app.setCaption("Current caption");
  app.click(app.find(".clever-subtitle-review-toggle"));
  const caption = app.find(".clever-subtitle-review-caption");
  const reviewedWord = caption.querySelectorAll(".clever-subtitle-unknown")[1];
  const currentWord = current.querySelectorAll(".clever-subtitle-unknown")[0];
  const rect = { left: 100, top: 200, right: 150, bottom: 220, width: 50, height: 20 };
  reviewedWord.getClientRects = currentWord.getClientRects = () => [rect];
  emitTouch(app, "pointerdown", app.player, 125, 210);
  assert.equal(reviewedWord.classList.contains("clever-subtitle-active"), true);
  assert.equal(currentWord.classList.contains("clever-subtitle-active"), false);
  emitTouch(app, "pointerup", app.player, 125, 210);

  reviewedWord.getClientRects = () => [{ ...rect, top: 300, bottom: 310 }];
  emitTouch(app, "touchstart", app.player, 125, 305);
  assert.equal(app.find(".clever-subtitle-word-button").hidden, false,
    "Touching empty panel space does not clear an existing word selection");
  emitTouch(app, "touchend", app.player, 125, 305);

  assert.equal(emitTouch(app, "pointerdown", app.player, 400, 150).prevented, true);
  emitTouch(app, "pointermove", app.player, 400, 100);
  emitTouch(app, "touchmove", app.player, 400, 100);
  assert.equal(caption.scrollTop, 50, "The two event paths must not double-scroll");
  emitTouch(app, "pointerup", app.player, 400, 100);
  assert.equal(emitTouch(app, "touchstart", caption, 400, 150).prevented, false,
    "A panel that receives the event directly should retain native scrolling");
  assert.equal(emitTouch(app, "touchmove", caption, 400, 100).prevented, false);
  emitTouch(app, "touchend", caption, 400, 100);
  assert.equal(app.find(".clever-subtitle-review-panel").hidden, false);
  assert.equal(app.video.paused, true);
  assert.equal(app.video.playCalls, 0);
  app.click(app.find(".clever-subtitle-review-close"));
  app.click(app.find(".clever-subtitle-review-toggle"));
  assert.equal(caption.scrollTop, 0, "Opening review should start at the top of its text");
});

test("touching a current caption word pauses playback for both touch event paths", () => {
  for (const knownWords of [[], ["like"]]) {
    for (const eventType of ["pointerdown", "touchstart"]) {
      const app = createPlayer({ knownWords });
      const [segment] = app.setCaption("He likes her");
      const word = segment.querySelectorAll(".clever-subtitle-known, .clever-subtitle-unknown")[1];
      let prevented = false;
      app.windowListeners[eventType]({
        pointerType: "touch", target: word, clientX: 125, clientY: 210,
        changedTouches: [{ clientX: 125, clientY: 210 }],
        preventDefault() { prevented = true; }, stopImmediatePropagation() {}
      });
      assert.equal(prevented, true);
      assert.equal(app.video.paused, true);
      assert.equal(app.video.pauseCalls, 1);
      assert.equal(app.video.currentTime, 24);
      assert.equal(word.classList.contains("clever-subtitle-active"), !knownWords.length);
      const button = app.find(".clever-subtitle-word-button");
      if (knownWords.length) {
        assert.equal(button, null);
        assert.equal(app.body.classList.contains("clever-subtitle-reveal-known"), true);
      } else {
        assert.equal(button.hidden, false);
        assert.equal(button.textContent, "+");
        assert.equal(app.body.classList.contains("clever-subtitle-reveal-known"), false);
      }
      assert.deepEqual(app.savedWords(), knownWords);
    }
  }
});

test("touching a covered current caption pauses once and preserves selection through reflow and saving", async () => {
  const app = createPlayer();
  const [segment] = app.setCaption("He likes her");
  const word = segment.querySelectorAll(".clever-subtitle-unknown")[1];
  word.getClientRects = () => [{ left: 100, top: 200, right: 150, bottom: 220, width: 50, height: 20 }];
  const overlay = new FakeElement();
  app.windowListeners.pointerdown({
    pointerType: "touch", target: overlay, clientX: 125, clientY: 210,
    preventDefault() {}, stopImmediatePropagation() {}
  });
  app.windowListeners.touchstart({
    target: overlay, changedTouches: [{ clientX: 125, clientY: 210 }],
    preventDefault() {}, stopImmediatePropagation() {}
  });
  assert.equal(app.video.pauseCalls, 1);
  const button = app.find(".clever-subtitle-word-button");
  app.setCaption("He likes", "her");
  assert.equal(button.hidden, false);
  assert.equal(app.find(".clever-subtitle-active").textContent, "likes");
  await app.click(button);
  assert.deepEqual(app.savedWords(), []);
  app.windowListeners.pointerup({
    pointerType: "touch", clientX: 125, clientY: 210,
    preventDefault() {}, stopImmediatePropagation() {}
  });
  button.listeners.pointerdown({ pointerType: "touch", stopPropagation() {} });
  await app.click(button);
  assert.deepEqual(app.savedWords(), ["like"]);
  assert.equal(app.video.paused, true);
  assert.equal(app.video.playCalls, 0);
  assert.equal(button.hidden, false, "Saving does not dismiss a selected word");
  assert.equal(button.textContent, "−");
});

test("desktop hover and outside touches preserve playback while resuming clears a touch selection", () => {
  const app = createPlayer();
  const [segment] = app.setCaption("A curious word");
  const word = segment.querySelectorAll(".clever-subtitle-unknown")[1];
  app.hover(word);
  assert.equal(app.video.paused, false);
  app.windowListeners.pointerdown({
    pointerType: "touch", target: app.player, clientX: 900, clientY: 100,
    preventDefault() { assert.fail("An outside touch must reach YouTube"); }, stopImmediatePropagation() {}
  });
  assert.equal(app.video.paused, false);
  assert.equal(app.video.pauseCalls, 0);
  app.windowListeners.pointerdown({
    pointerType: "touch", target: word, clientX: 125, clientY: 210,
    preventDefault() {}, stopImmediatePropagation() {}
  });
  assert.equal(app.video.paused, true);
  const button = app.find(".clever-subtitle-word-button");
  assert.equal(button.hidden, false);
  app.video.play();
  assert.equal(button.hidden, true);
  assert.equal(word.classList.contains("clever-subtitle-active"), false);
});

test("desktop hover reveals all known words across both captions and leaves playback alone", async () => {
  const app = createPlayer({ knownWords: ["he", "like", "give"] });
  app.setCaption("He likes her");
  const [segment] = app.setCaption("It gives you");
  const gives = segment.querySelector(".clever-subtitle-known");
  app.hover(gives);
  const button = app.find(".clever-subtitle-word-button");
  assert.equal(button.textContent, "−");
  assert.equal(app.body.classList.contains("clever-subtitle-reveal-known"), true);
  assert.equal(app.video.paused, false);
  assert.equal(app.video.pauseCalls, 0);
  app.documentListeners.mouseout({ target: gives, relatedTarget: null });
  await new Promise((resolve) => setTimeout(resolve, 270));
  assert.equal(button.hidden, true);
  assert.equal(app.body.classList.contains("clever-subtitle-reveal-known"), false);

  app.click(app.find(".clever-subtitle-review-toggle"));
  assert.equal(app.body.classList.contains("clever-subtitle-reveal-known"), false,
    "Opening Previous caption must not reveal any hidden words");
  const review = app.find(".clever-subtitle-review-caption");
  app.hover(review.querySelector(".clever-subtitle-known"));
  assert.equal(app.body.querySelectorAll(".clever-subtitle-known").length, 3);
  assert.equal(app.body.classList.contains("clever-subtitle-reveal-known"), true);
  assert.equal(app.video.pauseCalls, 1, "Hovering in review must not change playback");
  app.hover(segment.querySelector(".clever-subtitle-unknown"));
  assert.equal(app.body.classList.contains("clever-subtitle-reveal-known"), false);
  assert.equal(button.textContent, "+");
  assert.equal(app.video.pauseCalls, 1);
});

test("desktop word clicks survive mouse leave and native reflow while other hovers temporarily replace the button", async () => {
  for (const location of ["current", "review"]) {
    for (const known of [false, true]) {
      for (const covered of [false, true]) {
        const app = createPlayer({ knownWords: known ? ["he", "like"] : ["he"] });
        let [caption] = app.setCaption("He likes her");
        if (location === "review") {
          app.setCaption("Next caption");
          app.click(app.find(".clever-subtitle-review-toggle"));
          caption = app.find(".clever-subtitle-review-caption");
        }
        const wordsInCaption = caption.querySelectorAll(".clever-subtitle-known, .clever-subtitle-unknown");
        const likes = wordsInCaption[1];
        likes.getClientRects = () => [likes.getBoundingClientRect()];
        const target = covered ? app.player : likes;
        const mouse = { pointerType: "mouse", button: 0 };
        assert.equal(emitTouch(app, "pointerdown", target, 125, 210, mouse).blocked, true);
        assert.equal(emitTouch(app, "pointerup", target, 125, 210, mouse).blocked, true);
        assert.equal(emitTouch(app, "click", target, 125, 210, { ...mouse, detail: 1 }).blocked, true);
        const button = app.find(".clever-subtitle-word-button");
        assert.equal(app.video.paused, true);
        assert.equal(app.video.pauseCalls, 1);
        assert.equal(app.video.currentTime, 24);
        assert.equal(button.hidden, false);
        assert.equal(button.textContent, known ? "−" : "+");
        assert.equal(app.body.classList.contains("clever-subtitle-reveal-known"), known);
        app.documentListeners.mouseout({ target: likes, relatedTarget: null });
        app.hover(wordsInCaption[2]);
        assert.equal(button.hidden, false);
        assert.equal(caption.querySelector(".clever-subtitle-active").textContent, "her",
          "Hovering another word temporarily moves the button");
        app.documentListeners.mouseout({ target: wordsInCaption[2], relatedTarget: null });
        await new Promise((resolve) => setTimeout(resolve, 270));
        assert.equal(caption.querySelector(".clever-subtitle-active").textContent, "likes",
          "Leaving the hovered word restores the clicked word's button");
        if (location === "current") {
          app.setCaption("He likes", "her");
          assert.equal(button.hidden, false);
          assert.equal(app.find(".clever-subtitle-active").textContent, "likes");
          app.context.document.fullscreenElement = app.player;
          app.documentListeners.fullscreenchange();
          assert.equal(button.hidden, false);
          assert.equal(button.parentElement, app.player);
        }
        app.video.play();
        assert.equal(button.hidden, true);
        assert.equal(app.body.classList.contains("clever-subtitle-reveal-known"), false);
        assert.equal(app.find(".clever-subtitle-active"), null);
      }
    }
  }
});

test("a pinned desktop button stays selected after add and remove in either caption", async () => {
  for (const location of ["current", "review"]) {
    for (const known of [false, true]) {
      const app = createPlayer({ knownWords: known ? ["he", "like"] : ["he"] });
      let [caption] = app.setCaption("He likes her");
      if (location === "review") {
        app.setCaption("Next caption");
        app.click(app.find(".clever-subtitle-review-toggle"));
        caption = app.find(".clever-subtitle-review-caption");
      }
      const likes = caption.querySelectorAll(".clever-subtitle-known, .clever-subtitle-unknown")[1];
      const mouse = { pointerType: "mouse", button: 0 };
      emitTouch(app, "pointerdown", likes, 125, 210, mouse);
      emitTouch(app, "pointerup", likes, 125, 210, mouse);
      emitTouch(app, "click", likes, 125, 210, { ...mouse, detail: 1 });
      const button = app.find(".clever-subtitle-word-button");
      await app.click(button);
      assert.deepEqual(app.savedWords(), known ? ["he"] : ["he", "like"]);
      assert.equal(button.hidden, false);
      assert.equal(button.textContent, known ? "+" : "−");
      assert.equal(caption.querySelector(".clever-subtitle-active").textContent, "likes");
      assert.equal(app.body.classList.contains("clever-subtitle-reveal-known"), known,
        "Saving a previously visible word must not reveal all known words");
      await app.click(button);
      assert.deepEqual(app.savedWords(), known ? ["he", "like"] : ["he"]);
      assert.equal(button.hidden, false);
      assert.equal(button.textContent, known ? "−" : "+");
      assert.equal(app.video.paused, true);
      assert.equal(app.video.playCalls, 0);
      app.video.play();
      assert.equal(button.hidden, true);
      assert.equal(app.body.classList.contains("clever-subtitle-reveal-known"), false);
    }
  }
});

test("mobile hidden-word taps reveal both captions before a separate visible-word tap selects a button", () => {
  for (const location of ["current", "review"]) {
    for (const paths of [["pointer"], ["touch"], ["pointer", "touch"]]) {
      const app = createPlayer({ knownWords: ["he", "like", "give"] });
      app.setCaption("He likes her");
      const [segment] = app.setCaption("It gives you");
      app.click(app.find(".clever-subtitle-review-toggle"));
      const review = app.find(".clever-subtitle-review-caption");
      const likes = review.querySelectorAll(".clever-subtitle-known")[1];
      const gives = segment.querySelector(".clever-subtitle-known");
      gives.getBoundingClientRect = () => ({ left: 700, top: 430, right: 750, bottom: 450, width: 50, height: 20 });
      gives.getClientRects = () => [gives.getBoundingClientRect()];
      likes.getClientRects = () => [likes.getBoundingClientRect()];
      const first = location === "current" ? gives : likes;
      const second = location === "current" ? likes : gives;
      const tap = (word) => {
        const rect = word.getBoundingClientRect();
        const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
        for (const path of paths) {
          assert.equal(emitTouch(app, path === "pointer" ? "pointerdown" : "touchstart", app.player, x, y).blocked, true);
        }
        for (const path of paths) emitTouch(app, path === "pointer" ? "pointerup" : "touchend", app.player, x, y);
        assert.equal(emitTouch(app, "click", app.player, x, y, { detail: 1 }).blocked, true);
      };
      assert.equal(app.body.classList.contains("clever-subtitle-reveal-known"), false);
      tap(first);
      assert.equal(app.video.paused, true);
      assert.equal(app.video.pauseCalls, 1);
      assert.equal(app.body.classList.contains("clever-subtitle-reveal-known"), true);
      assert.equal(app.body.querySelectorAll(".clever-subtitle-known").length, 3);
      assert.equal(app.find(".clever-subtitle-word-button"), null,
        "The first tap must not create a word button, even with duplicate event paths");
      app.documentListeners.mouseover({ target: first, sourceCapabilities: { firesTouchEvents: true } });
      app.documentListeners.mouseover({ target: first });
      assert.equal(app.find(".clever-subtitle-word-button"), null,
        "Touch-generated mouse hover events must not select the revealed word");
      tap(second);
      const button = app.find(".clever-subtitle-word-button");
      assert.equal(button.hidden, false);
      assert.equal(button.textContent, "−");
      assert.equal(app.find(".clever-subtitle-active"), second);
      assert.equal(app.body.classList.contains("clever-subtitle-reveal-known"), true);
      const you = segment.querySelectorAll(".clever-subtitle-unknown")[1];
      you.getBoundingClientRect = () => ({ left: 800, top: 430, right: 850, bottom: 450, width: 50, height: 20 });
      you.getClientRects = () => [you.getBoundingClientRect()];
      tap(you);
      assert.equal(button.textContent, "+");
      assert.equal(app.body.classList.contains("clever-subtitle-reveal-known"), false,
        "Selecting a fully visible word replaces the previous reveal intent");
      assert.equal(app.video.pauseCalls, 1);
      assert.deepEqual(app.savedWords(), ["he", "like", "give"]);
      app.video.play();
      assert.equal(button.hidden, true);
      assert.equal(app.body.classList.contains("clever-subtitle-reveal-known"), false);
      assert.equal(app.find(".clever-subtitle-review-panel").hidden, true);
      tap(gives);
      assert.equal(button.hidden, true, "After resuming, a known word again needs a first reveal tap");
      assert.equal(app.body.classList.contains("clever-subtitle-reveal-known"), true);
      assert.equal(app.video.pauseCalls, 2);
    }
  }
});

test("mobile reveal-only taps pause a playing video once and keep word changes separate", async () => {
  const app = createPlayer({ knownWords: ["he", "like"] });
  const [caption] = app.setCaption("He likes her");
  const likes = caption.querySelectorAll(".clever-subtitle-known")[1];
  emitTouch(app, "pointerdown", likes, 125, 210);
  emitTouch(app, "touchstart", likes, 125, 210);
  emitTouch(app, "pointerup", likes, 125, 210);
  emitTouch(app, "touchend", likes, 125, 210);
  assert.equal(app.video.pauseCalls, 1);
  assert.equal(app.find(".clever-subtitle-word-button"), null);
  assert.deepEqual(app.savedWords(), ["he", "like"]);
  emitTouch(app, "pointerdown", likes, 125, 210);
  emitTouch(app, "pointerup", likes, 125, 210);
  const button = app.find(".clever-subtitle-word-button");
  assert.equal(button.textContent, "−");
  assert.deepEqual(app.savedWords(), ["he", "like"]);
  const rect = button.getBoundingClientRect();
  const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
  emitTouch(app, "pointerdown", app.player, x, y);
  emitTouch(app, "touchstart", app.player, x, y);
  emitTouch(app, "pointerup", app.player, x, y);
  emitTouch(app, "touchend", app.player, x, y);
  await new Promise(setImmediate);
  emitTouch(app, "click", button, x, y, { detail: 1 });
  assert.deepEqual(app.savedWords(), ["he"]);
  assert.equal(app.body.classList.contains("clever-subtitle-reveal-known"), true);
  assert.equal(app.video.paused, true);
  app.video.play();
  assert.equal(app.body.classList.contains("clever-subtitle-reveal-known"), false);
});

test("touching an already paused caption keeps the existing pause", () => {
  const app = createPlayer({ paused: true });
  const [segment] = app.setCaption("A curious word");
  const word = segment.querySelectorAll(".clever-subtitle-unknown")[1];
  app.windowListeners.pointerdown({
    pointerType: "touch", target: word, clientX: 125, clientY: 210,
    preventDefault() {}, stopImmediatePropagation() {}
  });
  assert.equal(app.video.pauseCalls, 0);
  assert.equal(app.video.paused, true);
  assert.equal(app.video.playCalls, 0);
  assert.equal(app.find(".clever-subtitle-word-button").hidden, false);
});

test("previous caption opens paused without seeking and stays available while changing vocabulary", async () => {
  const app = createPlayer({ knownWords: ["existing"] });
  app.setCaption("He likes her");
  assert.equal(app.find(".clever-subtitle-review"), null);
  app.setCaption("The video has moved on");
  const review = app.find(".clever-subtitle-review");
  const toggle = app.find(".clever-subtitle-review-toggle");
  const panel = app.find(".clever-subtitle-review-panel");
  assert.equal(review.hidden, false);
  assert.equal(panel.hidden, true);
  assert.equal(app.video.paused, false);
  app.click(toggle);
  assert.equal(app.video.paused, true);
  assert.equal(app.video.currentTime, 24);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  const caption = app.find(".clever-subtitle-review-caption");
  assert.equal(caption.textContent, "He likes her");
  const likes = caption.querySelectorAll(".clever-subtitle-unknown")[1];
  app.hover(likes);
  const button = app.find(".clever-subtitle-word-button");
  assert.equal(button.title, "Add “like” to My Vocabulary");

  // A queued caption mutation must not dismiss the word being reviewed.
  app.setCaption("Another caption appeared");
  assert.equal(button.hidden, false);
  assert.equal(caption.textContent, "He likes her");
  await app.click(button);
  assert.deepEqual(app.savedWords(), ["existing", "like"]);
  assert.equal(caption.querySelector(".clever-subtitle-known").textContent, "likes");
  assert.equal(panel.hidden, false);
  assert.equal(app.video.paused, true);
  assert.equal(app.video.playCalls, 0);

  app.hover(caption.querySelector(".clever-subtitle-known"));
  assert.equal(button.title, "Remove “like” from My Vocabulary");
  await app.click(button);
  assert.deepEqual(app.savedWords(), ["existing"]);
  assert.equal(panel.hidden, false);
  app.click(app.find(".clever-subtitle-review-close"));
  assert.equal(app.video.playCalls, 1);
  assert.equal(panel.hidden, true);
  assert.equal(toggle.focused, true);
});

test("closing review preserves an existing pause and the selected caption", () => {
  const app = createPlayer({ paused: true });
  app.setCaption("First sentence");
  app.setCaption("Second sentence");
  const toggle = app.find(".clever-subtitle-review-toggle");
  app.click(toggle);
  assert.equal(app.find(".clever-subtitle-review-close").textContent, "Close");
  app.click(toggle);
  assert.equal(app.video.paused, true);
  assert.equal(app.video.playCalls, 0);
  app.click(toggle);
  assert.equal(app.find(".clever-subtitle-review-caption").textContent, "First sentence");
});

test("caption reflow, progressive text and blank gaps preserve the last distinct caption", () => {
  const app = createPlayer();
  app.setCaption("An earlier sentence");
  app.setCaption("A new");
  app.setCaption("A new sentence");
  app.setCaption("A new", "sentence");
  app.setCaption();
  app.click(app.find(".clever-subtitle-review-toggle"));
  assert.equal(app.find(".clever-subtitle-review-caption").textContent, "An earlier sentence");
  app.click(app.find(".clever-subtitle-review-close"));
  app.setCaption("The next caption");
  app.click(app.find(".clever-subtitle-review-toggle"));
  assert.equal(app.find(".clever-subtitle-review-caption").textContent, "A new sentence");
});

test("external vocabulary changes update the frozen caption and retain the touch selection", () => {
  const app = createPlayer();
  app.setCaption("He likes her");
  app.setCaption("Next caption");
  app.click(app.find(".clever-subtitle-review-toggle"));
  const caption = app.find(".clever-subtitle-review-caption");
  const her = caption.querySelectorAll(".clever-subtitle-unknown")[2];
  const touchEvent = {
    pointerType: "touch", target: her, clientX: 125, clientY: 210,
    preventDefault() {}, stopImmediatePropagation() {}
  };
  app.windowListeners.pointerdown(touchEvent);
  app.setKnownWords(["like"]);
  assert.equal(app.find(".clever-subtitle-word-button").hidden, false);
  assert.equal(caption.querySelector(".clever-subtitle-known").textContent, "likes");
  assert.equal(caption.querySelector(".clever-subtitle-active").textContent, "her");
  assert.equal(app.video.paused, true);
});

test("touch review words require a separate tap to change vocabulary and keep the review paused", async () => {
  const app = createPlayer();
  app.setCaption("A curious word");
  app.setCaption("Next caption");
  app.click(app.find(".clever-subtitle-review-toggle"));
  const word = app.find(".clever-subtitle-review-caption").querySelectorAll(".clever-subtitle-unknown")[1];
  app.windowListeners.pointerdown({
    pointerType: "touch", target: word, clientX: 125, clientY: 210,
    preventDefault() {}, stopImmediatePropagation() {}
  });
  const button = app.find(".clever-subtitle-word-button");
  await app.click(button);
  assert.deepEqual(app.savedWords(), []);
  app.windowListeners.pointerup({
    pointerType: "touch", clientX: 125, clientY: 210,
    preventDefault() {}, stopImmediatePropagation() {}
  });
  button.listeners.pointerdown({ pointerType: "touch", stopPropagation() {} });
  await app.click(button);
  assert.deepEqual(app.savedWords(), ["curious"]);
  assert.equal(app.find(".clever-subtitle-review-panel").hidden, false);
  assert.equal(app.video.paused, true);
});

test("seeking, disabling captions and navigation discard stale review without resuming", () => {
  for (const action of ["seek", "disable", "navigate"]) {
    const app = createPlayer({ knownWords: ["sentence"] });
    app.setCaption("First sentence");
    app.setCaption("Second sentence");
    app.click(app.find(".clever-subtitle-review-toggle"));
    const word = app.find(".clever-subtitle-review-caption").querySelector(".clever-subtitle-known");
    emitTouch(app, "pointerdown", word, 125, 210, { pointerType: "mouse", button: 0 });
    emitTouch(app, "pointerup", word, 125, 210, { pointerType: "mouse", button: 0 });
    assert.equal(app.body.classList.contains("clever-subtitle-reveal-known"), true);
    if (action === "seek") {
      app.video.seeking = true;
      app.video.listeners.seeking({ type: "seeking" });
    } else if (action === "disable") {
      app.cc.setAttribute("aria-pressed", "false");
      app.mutate(app.cc);
    } else {
      app.documentListeners["yt-navigate-start"]({ type: "yt-navigate-start" });
    }
    assert.equal(app.find(".clever-subtitle-review").hidden, true, action);
    assert.equal(app.find(".clever-subtitle-review-panel").hidden, true, action);
    assert.equal(app.find(".clever-subtitle-word-button").hidden, true, action);
    assert.equal(app.body.classList.contains("clever-subtitle-reveal-known"), false, action);
    assert.equal(app.video.playCalls, 0, action);
  }
});

test("a stale caption left in the DOM after seeking is not remembered at the new position", () => {
  const app = createPlayer();
  app.setCaption("First sentence");
  app.setCaption("Second sentence");
  app.video.seeking = true;
  app.video.listeners.seeking({ type: "seeking" });
  app.video.seeking = false;
  app.video.listeners.seeked();
  app.setKnownWords(["sentence"]);
  app.setCaption("Caption at the new position");
  assert.equal(app.find(".clever-subtitle-review").hidden, true);
  app.setCaption("Next caption at the new position");
  app.click(app.find(".clever-subtitle-review-toggle"));
  assert.equal(app.find(".clever-subtitle-review-caption").textContent, "Caption at the new position");
});

test("manual playback dismisses review without issuing another play request", () => {
  const app = createPlayer();
  app.setCaption("First sentence");
  app.setCaption("Second sentence");
  app.click(app.find(".clever-subtitle-review-toggle"));
  app.video.paused = false;
  app.video.listeners.play();
  assert.equal(app.find(".clever-subtitle-review-panel").hidden, true);
  assert.equal(app.video.playCalls, 0);
});

test("uncached captions keep their text and layout hidden until analysis settles", async () => {
  const { createClient } = require("./nlp-client.js");
  let release;
  const nlp = createClient(async ({ text }) => {
    await new Promise((resolve) => { release = resolve; });
    return { ok: true, tokens: originalModel.analyze(text) };
  });
  const app = createPlayer({ knownWords: ["understand"], nlp });
  const text = "his main focus was on understanding what happens when you plug in a complex value for s.";
  const [segment] = app.setCaption(text);
  assert.equal(segment.dataset.cleverReady, "false");
  assert.equal(segment.textContent, text, "Pending analysis must preserve the original text and spacing");
  const pending = app.captions.querySelectorAll(".clever-subtitle-unknown").find((word) => word.textContent === "understanding");
  app.documentListeners.mouseover({ target: pending });
  assert.equal(app.find(".clever-subtitle-word-button"), null, "Invisible pending words must not offer vocabulary actions");
  const tap = emitTouch(app, "pointerdown", pending, 125, 210);
  assert.equal(tap.blocked, false, "Pending words must not capture the player's touch gesture");
  assert.equal(app.video.pauseCalls, 0);
  assert.deepEqual(app.savedWords(), ["understand"]);
  await new Promise(setImmediate);
  release();
  await new Promise(setImmediate);
  assert.equal(segment.dataset.cleverReady, "true");
  assert.equal(app.captions.textContent, text);
  const matched = app.captions.querySelector(".clever-subtitle-known");
  assert.equal(matched.textContent, "understanding");
  app.hover(matched);
  const button = app.find(".clever-subtitle-word-button");
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "−");
  await app.click(button);
  assert.deepEqual(app.savedWords(), []);
  const [cachedSegment] = app.setCaption(text);
  assert.equal(cachedSegment.dataset.cleverReady, "true", "Cached analysis is available on the first render");
  assert.equal(cachedSegment.querySelector(".clever-subtitle-unknown").textContent, "his");
});

test("a failed caption analysis reveals exact-word fallback and releases punctuation-only captions", async () => {
  const { createClient } = require("./nlp-client.js");
  let requests = 0;
  const nlp = createClient(async () => {
    requests++;
    throw new Error("Word model unavailable");
  });
  const app = createPlayer({ knownWords: ["he", "like", "her"], nlp });
  const [segment] = app.setCaption("He likes her.");
  assert.equal(segment.dataset.cleverReady, "false");
  await new Promise(setImmediate);
  assert.equal(segment.dataset.cleverReady, "true");
  assert.equal(segment.textContent, "He likes her.");
  assert.deepEqual(segment.querySelectorAll(".clever-subtitle-known").map((word) => word.textContent), ["He", "her."]);
  assert.equal(segment.querySelector(".clever-subtitle-unknown").textContent, "likes");
  app.mutate();
  await new Promise(setImmediate);
  assert.equal(requests, 1, "Fallback must settle without a mutation-driven retry loop");
  const [punctuation] = app.setCaption("...");
  assert.equal(punctuation.dataset.cleverReady, "false");
  await new Promise(setImmediate);
  assert.equal(punctuation.dataset.cleverReady, "true");
  assert.equal(punctuation.textContent, "...");
});

test("native word appends hide only new words and preserve the selected word through saving and model completion", async () => {
  const { createClient } = require("./nlp-client.js");
  const requests = [];
  const nlp = createClient((message) => new Promise((resolve) => requests.push({ ...message, resolve })));
  const app = createPlayer({ knownWords: ["give"], nlp });
  const [, second] = app.setCaptionRows(["when", " you", " plug", " in"], ["it", " gives"]);
  await new Promise(setImmediate);
  requests[0].resolve({ ok: true, tokens: originalModel.analyze(requests[0].text) });
  await new Promise(setImmediate);
  const gives = second.querySelector(".clever-subtitle-known");
  const id = gives.dataset.cleverId;
  app.hover(gives);
  const button = app.find(".clever-subtitle-word-button");
  const appended = new FakeElement(" you");
  appended.className = "ytp-caption-segment";
  second.appendChild(appended);
  app.mutate(second, { addedNodes: [appended] });
  assert.equal(gives.dataset.cleverId, id);
  assert.equal(gives.dataset.cleverPending, "false");
  assert.equal(gives.classList.contains("clever-subtitle-active"), true);
  assert.equal(button.hidden, false);
  assert.equal(button.textContent, "−");
  assert.equal(appended.dataset.cleverReady, "true", "Only the pending words, rather than the whole line, should be hidden");
  assert.equal(appended.querySelector(".clever-subtitle-unknown").classList.contains("clever-subtitle-pending"), true);
  assert.equal(appended.textContent, " you");
  await app.click(button);
  assert.deepEqual(app.savedWords(), [], "Ready words must remain editable while new words are being analysed");
  const visible = second.querySelectorAll(".clever-subtitle-unknown").find((word) => word.textContent === "gives");
  assert.equal(visible.dataset.cleverId, id);
  assert.equal(visible.dataset.cleverPending, "false");
  await new Promise(setImmediate);
  assert.equal(requests.length, 2);
  requests[1].resolve({ ok: true, tokens: originalModel.analyze(requests[1].text) });
  await new Promise(setImmediate);
  assert.equal(appended.querySelector(".clever-subtitle-unknown").dataset.cleverPending, "false");
  assert.equal(appended.querySelector(".clever-subtitle-unknown").classList.contains("clever-subtitle-pending"), false);
});

test("native row rolls preserve a touch selection and record the last two rows that left the screen", async () => {
  const app = createPlayer({ knownWords: ["like", "give"] });
  const [, second] = app.setCaptionRows(["He likes her"], ["it gives you"]);
  const gives = second.querySelector(".clever-subtitle-known");
  const id = gives.dataset.cleverId;
  emitTouch(app, "pointerdown", gives, 125, 210);
  emitTouch(app, "pointerup", gives, 125, 210);
  emitTouch(app, "pointerdown", gives, 125, 210);
  emitTouch(app, "pointerup", gives, 125, 210);
  const button = app.find(".clever-subtitle-word-button");
  const next = new FakeElement();
  next.className = "caption-visual-line";
  const segment = new FakeElement("1 plus 4");
  segment.className = "ytp-caption-segment";
  next.appendChild(segment);
  app.captions.replaceChildren({ nodes: [second, next] });
  app.mutate();
  assert.equal(button.hidden, false);
  assert.equal(button.title, "Remove “give” from My Vocabulary");
  assert.equal(second.querySelector(".clever-subtitle-active").dataset.cleverId, id);
  assert.equal(app.video.pauseCalls, 1);
  app.click(app.find(".clever-subtitle-review-toggle"));
  const review = app.find(".clever-subtitle-review-caption");
  assert.equal(review.textContent, "He likes her");
  assert.equal(review.querySelector(".clever-subtitle-known").textContent, "likes");
  app.hover(review.querySelector(".clever-subtitle-known"));
  await app.click(button);
  assert.deepEqual(app.savedWords(), ["give"]);
  assert.equal(review.textContent, "He likes her");
  assert.equal(review.querySelector(".clever-subtitle-known"), null);
  app.click(app.find(".clever-subtitle-review-close"));
  app.setCaptionRows(["it gives you"], ["1 plus 4 plus 9"]);
  app.click(app.find(".clever-subtitle-review-toggle"));
  assert.equal(review.textContent, "He likes her", "Appending must not replace the most recently removed row");
  app.click(app.find(".clever-subtitle-review-close"));
  app.setCaptionRows(["1 plus 4 plus 9"], ["on and on"]);
  app.click(app.find(".clever-subtitle-review-toggle"));
  assert.equal(review.textContent, "He likes her\nit gives you");
  app.hover(review.querySelectorAll(".clever-subtitle-known").find((word) => word.textContent === "gives"));
  await app.click(button);
  assert.deepEqual(app.savedWords(), []);
  assert.equal(review.textContent, "He likes her\nit gives you");
  app.click(app.find(".clever-subtitle-review-close"));
  app.setCaptionRows(["on and on"], ["next words"]);
  app.click(app.find(".clever-subtitle-review-toggle"));
  assert.equal(review.textContent, "it gives you\n1 plus 4 plus 9");
});

test("reusing a ready native node with raw text rebuilds the processed output, including punctuation", () => {
  const app = createPlayer({ knownWords: ["like"] });
  for (const text of ["He likes her.", "..."]) {
    const [segment] = app.setCaption(text);
    assert.equal(segment.dataset.cleverReady, "true");
    assert.ok(segment.querySelector(".clever-subtitle-output"));
    segment.textContent = text;
    assert.equal(segment.dataset.cleverReady, "true", "YouTube's replacement can leave the old ready flag behind");
    assert.equal(segment.querySelector(".clever-subtitle-output"), null,
      "Native replacement has no processed tokens allowed to be visible");
    app.mutate(segment);
    assert.ok(segment.querySelector(".clever-subtitle-output"));
    assert.equal(segment.textContent, text);
    if (text.includes("likes")) assert.equal(segment.querySelector(".clever-subtitle-known").textContent, "likes");
    segment.querySelector(".clever-subtitle-output").textContent = text;
    app.mutate(segment);
    assert.equal(segment.textContent, text);
    assert.ok(segment.querySelector(".clever-subtitle-known, .clever-subtitle-unknown, .clever-subtitle-text"),
      "Replacing only the output's text must restore classified tokens as well");
  }
});

test("a ready model cannot reveal a caption before the saved vocabulary finishes loading", () => {
  const app = createPlayer({ knownWords: ["like"], deferVocabularyRead: true });
  const [segment] = app.setCaption("He likes her.");
  assert.equal(segment.dataset.cleverReady, "false");
  const word = segment.querySelector(".clever-subtitle-unknown");
  app.hover(word);
  assert.equal(app.find(".clever-subtitle-word-button"), null);
  assert.equal(emitTouch(app, "pointerdown", word, 125, 210).blocked, false);
  app.loadVocabulary();
  assert.equal(segment.dataset.cleverReady, "true");
  assert.equal(segment.querySelector(".clever-subtitle-known").textContent, "likes");
});

test("rolling during model loading finishes the preserved line and frozen history from older snapshots", async () => {
  const { createClient } = require("./nlp-client.js");
  const requests = [];
  const nlp = createClient((message) => new Promise((resolve) => requests.push({ ...message, resolve })));
  const app = createPlayer({ knownWords: ["like", "give"], nlp });
  app.setCaptionRows(["He likes her"], ["it gives you"]);
  await new Promise(setImmediate);
  app.setCaptionRows(["it gives you"], ["1 plus 4"]);
  app.click(app.find(".clever-subtitle-review-toggle"));
  const history = app.find(".clever-subtitle-review-caption");
  assert.equal(history.textContent, "He likes her");
  assert.equal(history.querySelector(".clever-subtitle-unknown").dataset.cleverPending, "true");
  requests[0].resolve({ ok: true, tokens: originalModel.analyze(requests[0].text) });
  await new Promise(setImmediate);
  assert.equal(history.querySelector(".clever-subtitle-known").textContent, "likes");
  assert.equal(app.captions.querySelector(".clever-subtitle-known").textContent, "gives");
  assert.equal(app.captions.querySelectorAll(".clever-subtitle-unknown")
    .find((word) => word.textContent === "plus").dataset.cleverPending, "true");
  assert.equal(requests.length, 2);
  assert.equal(requests[1].text, "He likes her it gives you 1 plus 4");
  requests[1].resolve({ ok: true, tokens: originalModel.analyze(requests[1].text) });
  await new Promise(setImmediate);
  assert.ok(app.captions.querySelectorAll(".clever-subtitle-unknown")
    .every((word) => word.dataset.cleverPending === "false"));
  assert.equal(history.textContent, "He likes her");
});

test("out-of-order analysis cannot overwrite a newer caption and still updates frozen review", async () => {
  const { createClient } = require("./nlp-client.js");
  const releases = new Map();
  const nlp = createClient(async ({ text }) => {
    await new Promise((resolve) => { releases.set(text, resolve); });
    return { ok: true, tokens: originalModel.analyze(text) };
  });
  const app = createPlayer({ knownWords: ["like", "give"], nlp });
  app.setCaption("He likes her.");
  const [current] = app.setCaption("it gives you 1");
  app.click(app.find(".clever-subtitle-review-toggle"));
  const frozen = app.find(".clever-subtitle-review-caption");
  assert.equal(current.dataset.cleverReady, "false");
  assert.equal(frozen.dataset.cleverReady, "false");
  await new Promise(setImmediate);
  releases.get("it gives you 1")();
  await new Promise(setImmediate);
  assert.equal(current.dataset.cleverReady, "true");
  assert.equal(frozen.dataset.cleverReady, "false");
  assert.equal(app.captions.textContent, "it gives you 1");
  assert.equal(app.captions.querySelector(".clever-subtitle-known").textContent, "gives");
  releases.get("He likes her.")();
  await new Promise(setImmediate);
  assert.equal(current.dataset.cleverReady, "true");
  assert.equal(frozen.dataset.cleverReady, "true");
  assert.equal(app.captions.textContent, "it gives you 1");
  assert.equal(app.captions.querySelector(".clever-subtitle-known").textContent, "gives");
  assert.equal(app.find(".clever-subtitle-review-caption").querySelector(".clever-subtitle-known").textContent, "likes");
  assert.equal(app.video.paused, true);
});

test("replacing the video detaches old listeners and clears review without resuming the old video", () => {
  const app = createPlayer();
  app.setCaption("Old first sentence");
  app.setCaption("Old second sentence");
  app.click(app.find(".clever-subtitle-review-toggle"));
  const replacement = new FakeElement("", "video");
  replacement.className = "html5-main-video";
  replacement.paused = true;
  replacement.isConnected = true;
  replacement.pause = () => {};
  app.player.nodes = app.player.nodes.filter((node) => node !== app.video);
  app.video.parentElement = null;
  app.video.isConnected = false;
  app.player.appendChild(replacement);
  app.mutate(app.player, { addedNodes: [replacement], removedNodes: [app.video] });
  assert.equal(app.find(".clever-subtitle-review").hidden, true);
  assert.equal(app.find(".clever-subtitle-review-panel").hidden, true);
  assert.equal(app.video.playCalls, 0);
  assert.equal(app.video.listeners.play, undefined);
  assert.equal(typeof replacement.listeners.play, "function");
  app.setCaption("New first sentence");
  assert.equal(app.find(".clever-subtitle-review").hidden, true);
  app.setCaption("New second sentence");
  app.click(app.find(".clever-subtitle-review-toggle"));
  assert.equal(app.find(".clever-subtitle-review-caption").textContent, "New first sentence");
});

test("Escape closes review, restores focus and resumes only playback paused by review", () => {
  for (const paused of [false, true]) {
    const app = createPlayer({ paused });
    app.setCaption("First sentence");
    app.setCaption("Second sentence");
    app.click(app.find(".clever-subtitle-review-toggle"));
    let prevented = false;
    app.documentListeners.keydown({
      key: "Escape", preventDefault() { prevented = true; }, stopImmediatePropagation() {}
    });
    assert.equal(prevented, true);
    assert.equal(app.find(".clever-subtitle-review-panel").hidden, true);
    assert.equal(app.find(".clever-subtitle-review-toggle").focused, true);
    assert.equal(app.video.playCalls, paused ? 0 : 1);
  }
});
