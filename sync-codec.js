(function (root) {
  "use strict";

  const model = root.CleverSubtitleSyncModel ||
    (typeof module !== "undefined" && module.exports ? require("./sync-model.js") : null);

  async function encodeState(value) {
    const compressed = new Blob([JSON.stringify(value)]).stream()
      .pipeThrough(new CompressionStream("gzip"));
    return new Uint8Array(await new Response(compressed).arrayBuffer());
  }

  async function decodeState(bytes) {
    const decompressed = new Blob([bytes]).stream()
      .pipeThrough(new DecompressionStream("gzip"));
    return model.cleanState(JSON.parse(await new Response(decompressed).text()));
  }

  const api = { encodeState, decodeState };
  root.CleverSubtitleSyncCodec = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
