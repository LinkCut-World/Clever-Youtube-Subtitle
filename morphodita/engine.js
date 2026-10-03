/* MIT. Transport and Unicode offsets only; model lemmas and tags are unchanged. */
(function (root) {
  "use strict";
  async function createEngine(factory, bytes, options = {}) {
    const encoder = new TextEncoder();
    const module = await factory(options);
    const pointer = module._malloc(bytes.length);
    if (!pointer) throw new Error("Could not allocate the model buffer.");
    let context;
    try {
      module.HEAPU8.set(bytes, pointer);
      context = module._morpho_create(pointer, bytes.length);
      if (!context) throw new Error(module.UTF8ToString(module._morpho_error()));
    } finally { module._free(pointer); }
    return {
      heapBytes: () => module.HEAPU8.byteLength,
      analyze(text) {
        if (!context) throw new Error("The engine is closed.");
        const input = encoder.encode(text);
        if (input.length > 200000) throw new Error("Text is too long.");
        const data = module._malloc(input.length + 1);
        if (!data) throw new Error("Could not allocate the text buffer.");
        try {
          module.HEAPU8.set(input, data);
          module.HEAPU8[data + input.length] = 0;
          const result = module._morpho_analyze(context, data, input.length);
          if (!result) throw new Error(module.UTF8ToString(module._morpho_error()));
          const tokens = JSON.parse(module.UTF8ToString(result));
          const offsets = [0];
          let cursor = 0;
          for (const character of text) { cursor += character.length; offsets.push(cursor); }
          for (const token of tokens) {
            token.start = offsets[token.startCodePoint];
            token.end = offsets[token.startCodePoint + token.lengthCodePoints];
            if (text.slice(token.start, token.end) !== token.form) throw new Error("Token offsets do not match the input.");
          }
          return tokens;
        } finally { module._free(data); }
      },
      close() { if (context) module._morpho_destroy(context); context = 0; }
    };
  }
  root.createMorphoEngine = createEngine;
  if (typeof module !== "undefined" && module.exports) module.exports = createEngine;
})(globalThis);
