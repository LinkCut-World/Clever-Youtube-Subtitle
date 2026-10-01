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
    const url = chrome.runtime.getURL("options.html");
    // Open a real tab. Kiwi may create an invisible options iframe when the
    // browser's embedded-options route is used.
    chrome.tabs.create({ url, active: true }, () => {
      if (!chrome.runtime.lastError) return;
      message.textContent = "Could not open a tab. Use the link below.";
      message.classList.add("error");
      const link = document.getElementById("manage-link");
      link.href = url;
      link.hidden = false;
    });
  });
})();
