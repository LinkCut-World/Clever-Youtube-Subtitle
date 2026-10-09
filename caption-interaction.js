/* MIT. Word interaction state is independent of the button and dictionary UI. */
(function (root) {
  "use strict";
  function createInteraction() {
    let hovered = null, selected = null, revealed = null;
    return {
      get hovered() { return hovered; },
      get selected() { return selected; },
      get button() { return hovered || selected; },
      get revealKnown() { return Boolean(revealed || hovered?.reveal || selected?.reveal); },
      hover(word) { hovered = word; },
      leave() { hovered = null; },
      select(word) { hovered = null; revealed = null; selected = word; },
      reveal(word) { hovered = null; selected = null; revealed = word; },
      reset() { hovered = null; selected = null; revealed = null; },
      clearReview() {
        if (hovered?.review) hovered = null;
        if (selected?.review) selected = null;
        if (revealed?.review) revealed = null;
      },
      drop(element) {
        if (hovered?.element === element) hovered = null;
        if (selected?.element === element) selected = null;
        if (revealed?.element === element) revealed = null;
      },
      rebind(resolve) {
        if (hovered) hovered = resolve(hovered);
        if (selected) selected = resolve(selected);
        if (revealed) revealed = resolve(revealed);
      }
    };
  }
  root.CleverSubtitleInteraction = { createInteraction };
  if (typeof module !== "undefined" && module.exports) module.exports = { createInteraction };
})(globalThis);
