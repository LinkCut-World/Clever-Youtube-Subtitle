(function () {
  "use strict";

  const STORAGE_KEY = "knownWords";
  const { parseWordList } = globalThis.CleverSubtitleWords;
  const { canonicalWords, mergeWords, searchWords, pageWords } = globalThis.CleverSubtitleVocabulary;
  const elements = {
    count: document.getElementById("word-count"),
    message: document.getElementById("message"),
    file: document.getElementById("word-file"),
    preview: document.getElementById("import-preview"),
    importButton: document.getElementById("import-button"),
    addInput: document.getElementById("add-input"),
    addButton: document.getElementById("add-button"),
    search: document.getElementById("search-input"),
    resultCount: document.getElementById("result-count"),
    list: document.getElementById("word-list"),
    empty: document.getElementById("empty-state"),
    previous: document.getElementById("prev-button"),
    next: document.getElementById("next-button"),
    pageLabel: document.getElementById("page-label"),
    exportButton: document.getElementById("export-button"),
    clearButton: document.getElementById("clear-button")
  };

  let words = [];
  let pendingImport = null;
  let page = 1;
  let busy = false;
  let ready = false;

  function showMessage(text, isError = false) {
    elements.message.textContent = text;
    elements.message.classList.toggle("error", isError);
  }

  function render() {
    const matching = searchWords(words, elements.search.value);
    const pageData = pageWords(matching, page);
    page = pageData.page;

    elements.count.textContent = words.length.toLocaleString();
    elements.resultCount.textContent = elements.search.value.trim()
      ? `${matching.length.toLocaleString()} words found`
      : `${matching.length.toLocaleString()} words`;
    elements.pageLabel.textContent = `Page ${page} of ${pageData.pageCount}`;
    elements.previous.disabled = page <= 1;
    elements.next.disabled = page >= pageData.pageCount;
    elements.empty.hidden = matching.length > 0;
    elements.importButton.disabled = !ready || busy || !pendingImport?.length;
    elements.addButton.disabled = !ready || busy;
    elements.exportButton.disabled = !ready || busy || words.length === 0;
    elements.clearButton.disabled = !ready || busy || words.length === 0;

    const fragment = document.createDocumentFragment();
    for (const word of pageData.items) {
      const row = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = word;
      label.title = word;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.dataset.word = word;
      remove.disabled = !ready || busy;
      remove.setAttribute("aria-label", `Remove “${word}” from My Vocabulary`);
      row.append(label, remove);
      fragment.appendChild(row);
    }
    elements.list.replaceChildren(fragment);
  }

  async function saveWords(nextWords, successText) {
    if (!ready || busy) return false;
    busy = true;
    render();
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: nextWords });
      words = nextWords;
      render();
      showMessage(successText);
      return true;
    } catch (error) {
      showMessage("Could not save. Please try again.", true);
      return false;
    } finally {
      busy = false;
      render();
    }
  }

  async function loadWords() {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      words = canonicalWords(result[STORAGE_KEY]);
      ready = true;
      render();
    } catch (error) {
      showMessage("Could not load My Vocabulary. Please open this page again.", true);
    }
  }

  elements.file.addEventListener("change", async () => {
    const file = elements.file.files?.[0];
    pendingImport = null;
    if (!file) {
      elements.preview.textContent = "No file chosen";
      render();
      return;
    }
    elements.preview.textContent = `Reading ${file.name}…`;
    render();
    try {
      const text = await file.text();
      if (elements.file.files?.[0] !== file) return;
      pendingImport = parseWordList(text);
      elements.preview.textContent = `${file.name}: ${pendingImport.length.toLocaleString()} different words`;
      if (!pendingImport.length) showMessage("No words found in this file.", true);
      render();
    } catch (error) {
      elements.preview.textContent = "Could not read the file";
      showMessage("Could not read the file. Please choose it again.", true);
      render();
    }
  });

  elements.importButton.addEventListener("click", async () => {
    if (!ready || busy || !pendingImport?.length) return;
    const mode = document.querySelector('input[name="import-mode"]:checked')?.value;
    if (mode === "replace" && words.length &&
        !window.confirm(`Replace all ${words.length.toLocaleString()} saved words with ${pendingImport.length.toLocaleString()} words from this file?`)) return;

    const nextWords = mode === "replace" ? pendingImport : mergeWords(words, pendingImport);
    const added = Math.max(0, nextWords.length - words.length);
    const message = mode === "replace"
      ? `My Vocabulary now has ${nextWords.length.toLocaleString()} words.`
      : `Added ${added.toLocaleString()} words to My Vocabulary.`;
    if (await saveWords(nextWords, message)) {
      pendingImport = null;
      elements.file.value = "";
      elements.preview.textContent = "No file chosen";
      render();
    }
  });

  elements.addButton.addEventListener("click", async () => {
    if (!ready || busy) return;
    const additions = parseWordList(elements.addInput.value);
    if (!additions.length) {
      showMessage("Please enter at least one word.", true);
      return;
    }
    const nextWords = mergeWords(words, additions);
    const added = nextWords.length - words.length;
    if (!added) {
      showMessage("These words are already in My Vocabulary.");
      return;
    }
    if (await saveWords(nextWords, `Added ${added.toLocaleString()} words to My Vocabulary.`)) {
      elements.addInput.value = "";
    }
  });

  elements.search.addEventListener("input", () => {
    page = 1;
    render();
  });
  elements.previous.addEventListener("click", () => { page -= 1; render(); });
  elements.next.addEventListener("click", () => { page += 1; render(); });

  elements.list.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-word]");
    if (!button || !ready || busy) return;
    const word = button.dataset.word;
    await saveWords(words.filter((entry) => entry !== word), `Removed “${word}” from My Vocabulary.`);
  });

  elements.exportButton.addEventListener("click", () => {
    if (!ready || !words.length) return;
    const blob = new Blob([`${words.join("\n")}\n`], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `clever-youtube-subtitle-words-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  elements.clearButton.addEventListener("click", async () => {
    if (!ready || busy || !words.length) return;
    if (!window.confirm(`Remove all ${words.length.toLocaleString()} words from My Vocabulary? You cannot undo this.`)) return;
    await saveWords([], "Removed all words from My Vocabulary.");
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[STORAGE_KEY] && !busy) {
      words = canonicalWords(changes[STORAGE_KEY].newValue);
      render();
    }
  });

  render();
  loadWords();
})();
