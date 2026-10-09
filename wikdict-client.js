/* MIT. Transfer downloaded bytes once, and keep the SQL runtime off the UI thread. */
(function (root) {
  "use strict";
  function createInstaller(Worker, getURL, timeoutMs = 120000) {
    return (bytes, entry, progress = () => {}) => new Promise((resolve, reject) => {
      let worker, timer, ended = false;
      function finish(error, result) {
        if (ended) return;
        ended = true;
        clearTimeout(timer); worker?.terminate();
        if (error) reject(new Error(error)); else resolve(result);
      }
      try {
        worker = new Worker(getURL("wikdict-worker.js"));
        timer = setTimeout(() => finish("Reading this dictionary took too long. Try again."), timeoutMs);
        worker.onmessage = ({ data }) => {
          if (ended) return;
          if (data.type === "progress") progress(data.progress);
          else if (data.type === "result") finish(null, data.metadata);
          else if (data.type === "error") finish(data.error);
        };
        worker.onerror = (event) => {
          event.preventDefault?.();
          finish("Could not start the dictionary reader. Reload the extension and try again.");
        };
        const buffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer
          : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        worker.postMessage({ buffer, language: entry.language }, [buffer]);
      } catch (error) { finish("Could not start the dictionary reader. Reload the extension and try again."); }
    });
  }
  const api = { createInstaller };
  root.CleverSubtitleWikDictClient = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
