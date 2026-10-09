/* MIT. Downloads run in this visible extension page, not a background timer. */
(function (root) {
  "use strict";
  function createManager(document, chrome, packs, catalog) {
    const get = (id) => document.getElementById(`packs-${id}`);
    const ui = Object.fromEntries(["summary", "list", "status", "file", "import", "search", "matching", "empty"].map((id) => [id, get(id)]));
    let busy = false, installed = [];
    const size = (bytes) => bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    const searchText = (value) => String(value || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();
    let localNames;
    try { localNames = new Intl.DisplayNames([root.navigator?.language || "en"], { type: "language" }); }
    catch (error) { /* Names and codes still work on older browsers. */ }
    function matches(entry, query) {
      let localName = "";
      try { localName = localNames?.of(entry.language) || ""; } catch (error) {}
      return !query || searchText([entry.name, entry.englishName, entry.language, localName].join(" ")).includes(query);
    }
    function note(text, error = false) { ui.status.textContent = text; ui.status.classList.toggle("error", error); }
    function render() {
      ui.list.replaceChildren();
      ui.summary.textContent = `${installed.length} installed · ${size(installed.reduce((total, pack) => total + pack.unpackedBytes, 0))} of dictionary data`;
      const query = searchText(ui.search.value);
      const visible = catalog.packs.filter((entry) => matches(entry, query));
      visible.sort((left, right) => Number(right.language === query) - Number(left.language === query));
      ui.matching.textContent = query ? `${visible.length} of ${catalog.packs.length} languages` : `${catalog.packs.length} languages available`;
      ui.empty.hidden = visible.length !== 0;
      for (const entry of visible) {
        const current = installed.find((pack) => pack.language === entry.language);
        const row = document.createElement("article"); row.className = "dictionary-pack";
        const info = document.createElement("div");
        const heading = document.createElement("h3");
        heading.textContent = `${entry.englishName && entry.englishName !== entry.name ? entry.englishName + " · " : ""}${entry.name} (${entry.language})`;
        info.appendChild(heading);
        const detail = document.createElement("p");
        detail.textContent = `${entry.words.toLocaleString()} words · ${size(entry.bytes)} download · ${size(entry.unpackedBytes)} data`;
        info.appendChild(detail);
        const state = document.createElement("p");
        state.textContent = current ? `Installed: ${current.version} · ${current.sha256 === entry.sha256 ? "Up to date" : "Update available"}`
          : `Not downloaded · Version ${entry.version}`;
        info.appendChild(state); row.appendChild(info);
        const actions = document.createElement("div"); actions.className = "dictionary-pack-actions";
        for (const [action, label] of [["download", current ? current.sha256 === entry.sha256 ? "Download again" : "Update" : "Download"],
          ...(current ? [["use", "Use"], ["remove", "Delete"]] : [])]) {
          const button = document.createElement("button");
          button.type = "button"; button.className = action === "remove" ? "danger" : "secondary";
          button.textContent = label; button.dataset.action = action; button.dataset.language = entry.language; button.disabled = busy;
          button.addEventListener("click", () => perform(action, entry));
          actions.appendChild(button);
        }
        const manual = document.createElement("a"); manual.href = entry.url;
        manual.target = "_blank"; manual.rel = "noreferrer"; manual.textContent = "Get file";
        actions.appendChild(manual); row.appendChild(actions); ui.list.appendChild(row);
      }
      ui.file.disabled = busy;
      ui.import.disabled = busy || !ui.file.files?.length;
    }
    async function refresh() { installed = await packs.list(); render(); }
    async function perform(action, entry) {
      if (busy) return;
      busy = true; render();
      try {
        if (action === "download") {
          note(`Allow download access if asked. Downloading ${entry.name}…`);
          if (!await root.CleverSubtitleSyncAccess.ensureServerAccess(chrome.permissions, catalog.origins)) {
            throw new Error("Allow access to the download server, or use Import file.");
          }
          await packs.download(entry.language, (bytes, progress) => {
            if (progress?.phase === "prepare") note(`Reading ${entry.name}… ${Math.round(progress.done / Math.max(1, progress.total) * 100)}%`);
            else if (progress?.phase === "save") note(`Saving ${entry.name}…`);
            else note(`Downloading ${entry.name}… ${Math.min(100, Math.round(bytes / entry.bytes * 100))}%`);
          });
          note(`${entry.name} saved. It is ready for offline use.`);
        } else if (action === "remove") {
          await packs.remove(entry.language);
          note(`${entry.name} deleted. Your vocabulary is still here.`);
        } else if (action === "use") {
          const reply = await chrome.runtime.sendMessage({ type: "dictionary:configure", provider: "offline", language: entry.language });
          if (!reply?.ok) throw new Error(reply?.error || "Could not select this dictionary.");
          note(`Dictionary set to ${entry.name}.`);
        }
        await refresh();
      } catch (error) { note(error.message || "Could not complete this action. Please try again.", true); }
      finally { busy = false; render(); }
    }
    ui.file.addEventListener("change", render);
    ui.search.addEventListener("input", render);
    ui.import.addEventListener("click", async () => {
      if (busy || !ui.file.files?.length) return;
      busy = true; render(); note("Checking and saving the dictionary…");
      try {
        const result = await packs.importFile(ui.file.files[0], (progress) => {
          if (progress?.phase === "prepare") note(`Reading dictionary… ${Math.round(progress.done / Math.max(1, progress.total) * 100)}%`);
          else if (progress?.phase === "save") note("Saving dictionary…");
        });
        note(`${catalog.packs.find((entry) => entry.language === result.language).name} imported. It is ready for offline use.`);
        ui.file.value = "";
        await refresh();
      } catch (error) { note(error.message || "Could not import this file.", true); }
      finally { busy = false; render(); }
    });
    const loaded = refresh().catch((error) => note(error.message, true));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[root.CleverSubtitleDictionary.PACK_REVISION_KEY] && !busy) {
        refresh().catch((error) => note(error.message, true));
      }
    });
    return { loaded };
  }
  root.CleverSubtitleDictionaryManager = { createManager };
  if (typeof module !== "undefined" && module.exports) module.exports = { createManager };
  else {
    const store = root.CleverSubtitleDictionaryStore.createStore(indexedDB);
    const installSQLite = root.CleverSubtitleWikDictClient.createInstaller(Worker, (path) => chrome.runtime.getURL(path));
    const packs = root.CleverSubtitleDictionaryPacks.createPacks({ catalog: root.CleverSubtitleDictionaryCatalog,
      store, fetcher: fetch, crypto, storage: chrome.storage.local, installSQLite });
    createManager(document, chrome, packs, root.CleverSubtitleDictionaryCatalog);
  }
})(globalThis);
