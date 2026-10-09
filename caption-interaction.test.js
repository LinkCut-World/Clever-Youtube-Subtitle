const test = require("node:test");
const assert = require("node:assert/strict");
const { createInteraction } = require("./caption-interaction.js");
const word = (name, reveal = false, review = false) => ({ element: name, reveal, review });

test("hover changes only the temporary button and leaving restores the selected word", () => {
  const state = createInteraction(), a = word("visible-a"), b = word("known-b", true);
  state.select(a);
  state.hover(b);
  assert.equal(state.selected, a);
  assert.equal(state.button, b);
  assert.equal(state.revealKnown, true);
  state.leave();
  assert.equal(state.button, a);
  assert.equal(state.revealKnown, false);
  state.select(b);
  state.hover(a);
  assert.equal(state.button, a);
  assert.equal(state.revealKnown, true);
  state.leave();
  assert.equal(state.button, b);
  state.select(a);
  assert.equal(state.revealKnown, false);
});

test("a touch reveal has no selection, and a later visible selection replaces it", () => {
  const state = createInteraction(), hidden = word("known", true), visible = word("visible");
  state.select(visible);
  state.reveal(hidden);
  assert.equal(state.button, null);
  assert.equal(state.selected, null);
  assert.equal(state.revealKnown, true);
  state.select(hidden);
  assert.equal(state.button, hidden);
  assert.equal(state.revealKnown, true);
  state.select(visible);
  assert.equal(state.revealKnown, false);
  state.reveal(hidden);
  state.rebind(() => null);
  assert.equal(state.revealKnown, false, "A vanished reveal-only word cannot reveal a new caption");
});

test("closing review and losing one occurrence retain unrelated interaction state", () => {
  const state = createInteraction(), current = word("current"), review = word("review", true, true);
  state.select(current);
  state.hover(review);
  state.clearReview();
  assert.equal(state.button, current);
  assert.equal(state.revealKnown, false);
  state.select(review);
  state.hover(current);
  state.clearReview();
  assert.equal(state.selected, null);
  assert.equal(state.button, current);
  state.select(current);
  state.hover(review);
  state.rebind((entry) => entry === current ? { ...entry, element: "rebuilt" } : null);
  assert.equal(state.button.element, "rebuilt");
  assert.equal(state.revealKnown, false);
  state.drop("rebuilt");
  assert.equal(state.button, null);
});

test("resuming resets selection, hover and reveal-only states", () => {
  for (const action of ["select", "hover", "reveal"]) {
    const state = createInteraction();
    state[action](word("known", true));
    state.reset();
    assert.equal(state.button, null);
    assert.equal(state.selected, null);
    assert.equal(state.revealKnown, false);
  }
});
