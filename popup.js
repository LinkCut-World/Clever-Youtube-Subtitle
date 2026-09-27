(function () {
  "use strict";

  const count = document.getElementById("word-count");
  const message = document.getElementById("message");

  chrome.storage.local.get("knownWords", (result) => {
    if (chrome.runtime.lastError) {
      message.textContent = "Could not load My Vocabulary. Close and open this popup again.";
      message.classList.add("error");
      return;
    }
    const saved = result.knownWords;
    count.textContent = Array.isArray(saved) ? saved.length.toLocaleString() : "0";
  });

  document.getElementById("manage-button").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
})();
