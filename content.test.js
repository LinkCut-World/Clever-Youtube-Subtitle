const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const words = require("./word-utils.js");

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
  getBoundingClientRect() { return { left: 100, top: 200, right: 150, bottom: 220, width: 50, height: 20 }; }
  getClientRects() { return []; }
  get offsetWidth() { return 28; }
  get offsetHeight() { return 28; }
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
    Node: { ELEMENT_NODE: 1 },
    setTimeout,
    clearTimeout,
    window: {
      innerWidth: 1200,
      addEventListener(type, listener) { windowListeners[type] = listener; }
    },
    document: {
      documentElement: {},
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
  assert.deepEqual(hidden(), ["saw."]);

  const preceding = new FakeElement("a");
  preceding.className = "ytp-caption-segment";
  segments.unshift(preceding);
  onMutation([{ target: preceding, addedNodes: [preceding] }]);
  assert.equal(segment.textContent, "saw.");
  assert.deepEqual(hidden(), []);

  segments.shift();
  onMutation([{ target: segment, addedNodes: [], removedNodes: [preceding] }]);
  assert.deepEqual(hidden(), ["saw."]);

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
  assert.equal(knownLike.classList.contains("clever-subtitle-active"), true);
  assert.equal(button.textContent, "−");
  assert.equal(button.title, "Remove “like” from My Vocabulary");
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
  documentListeners.mouseover({ target: newWord });
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

function createPlayer({ paused = false, knownWords = [] } = {}) {
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
  const context = {
    CleverSubtitleWords: words,
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
    }
  };
  context.globalThis = context;
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
  return {
    body, player, video, cc, captions, context, documentListeners, windowListeners, setCaption, mutate,
    savedWords: () => Array.from(savedWords),
    setKnownWords(next) { savedWords = next; onStorageChanged({ knownWords: {} }, "local"); },
    find: (selector) => body.querySelector(selector),
    hover: (element) => documentListeners.mouseover({ target: element }),
    click: (element) => element.listeners.click({ preventDefault() {}, stopPropagation() {} })
  };
}

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
      assert.equal(word.classList.contains("clever-subtitle-active"), true);
      const button = app.find(".clever-subtitle-word-button");
      assert.equal(button.hidden, false);
      assert.equal(button.textContent, knownWords.length ? "−" : "+");
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
  assert.equal(button.hidden, true);
});

test("desktop hover and outside touches preserve playback while resuming clears a touch selection", () => {
  const app = createPlayer();
  const [segment] = app.setCaption("A curious word");
  const word = segment.querySelectorAll(".clever-subtitle-unknown")[1];
  app.hover(word);
  app.windowListeners.pointerdown({ pointerType: "mouse", target: word });
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
    const app = createPlayer();
    app.setCaption("First sentence");
    app.setCaption("Second sentence");
    app.click(app.find(".clever-subtitle-review-toggle"));
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
