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
  constructor(text = "") {
    this.nodeType = 1;
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
    this.nodes = [new FakeText(text)];
  }

  closest(selector) {
    if (selector.startsWith(".ytp-caption-segment .clever-subtitle-unknown")) {
      return ["clever-subtitle-unknown", "clever-subtitle-known"].some((name) => this.classList.contains(name)) ? this : null;
    }
    return this;
  }

  querySelectorAll(selector) {
    const classes = selector.split(", ").map((name) => name.slice(1));
    return this.nodes.filter((node) => classes.some((name) => node.classList?.contains(name)));
  }

  replaceChildren(fragment) {
    this.nodes = [...fragment.nodes];
    for (const node of this.nodes) node.parentElement = this;
  }

  appendChild(node) {
    this.nodes.push(node);
    node.parentElement = this;
  }

  contains(node) { return this === node || this.nodes.includes(node); }

  addEventListener(type, listener) { this.listeners[type] = listener; }
  setAttribute(name, value) { this[name] = value; }
  getBoundingClientRect() { return { left: 100, top: 200, bottom: 220, width: 50 }; }
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
      createElement: () => new FakeElement(),
      createTextNode: (text) => new FakeText(text),
      createDocumentFragment: () => ({
        nodes: [],
        appendChild(node) { this.nodes.push(node); }
      })
    },
    chrome: {
      runtime: { lastError: null },
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
  segments.splice(0, 1, replacementFirst, replacementLast);
  onMutation([{ target: replacementLast, addedNodes: [replacementLast] }]);
  assert.equal(button.hidden, false);
  assert.equal(replacementLast.querySelectorAll(".clever-subtitle-unknown")
    .find((node) => node.textContent === "word").classList.contains("clever-subtitle-active"), true);
  segments.pop();
  onMutation([{ target: segment, addedNodes: [] }]);
  assert.equal(button.hidden, true);
});
