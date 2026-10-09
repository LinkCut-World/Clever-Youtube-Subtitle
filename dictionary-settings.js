/* MIT. Settings never read a saved key back into the page. */
(function (root) {
  "use strict";
  function createSettings(document, chrome) {
    const dictionary = root.CleverSubtitleDictionary;
    const microsoft = root.CleverSubtitleMicrosoftDictionary;
    const get = (id) => document.getElementById(`dictionary-${id}`);
    const ui = Object.fromEntries(["provider", "language", "microsoft", "key", "key-note", "region", "test-word",
      "offline-help", "save", "forget-key", "status", "test-result"].map((id) => [id, get(id)]));
    let busy = false, ready = false, hasKey = false, regionEdited = false;
    async function send(message) {
      const reply = await chrome.runtime.sendMessage(message);
      if (!reply?.ok) throw new Error(reply?.error || "Could not save dictionary settings.");
      return reply;
    }
    function note(text, error = false) {
      ui.status.textContent = text;
      ui.status.classList.toggle("error", error);
    }
    function renderControls() {
      const online = ui.provider.value === "microsoft";
      ui.microsoft.hidden = !online;
      ui["offline-help"].hidden = online;
      ui["forget-key"].hidden = !hasKey;
      ui["key-note"].textContent = hasKey
        ? "A key is saved. Leave the key box empty to keep it. It stays in this browser and is not synced or exported."
        : "Your key stays in this browser. It is not part of vocabulary sync or TXT export.";
      ui.key.placeholder = hasKey ? "Leave empty to keep the saved key" : "Paste your Azure Translator key";
      ui.save.textContent = online && ui.language.value !== "off" ? "Save and check" : "Save";
      for (const name of ["provider", "language", "key", "region", "test-word", "save", "forget-key"]) {
        ui[name].disabled = busy || !ready;
      }
    }
    function renderLanguages(value) {
      ui.language.replaceChildren();
      for (const language of [{ code: "off", name: "Off" }, ...dictionary.languagesFor(ui.provider.value)]) {
        const option = document.createElement("option");
        option.value = language.code; option.textContent = language.name;
        ui.language.appendChild(option);
      }
      ui.language.value = dictionary.languageFor(ui.provider.value, value);
    }
    function showResult(result) {
      ui["test-result"].replaceChildren();
      ui["test-result"].hidden = !result;
      if (!result) return;
      const heading = document.createElement("strong");
      heading.textContent = result.word;
      ui["test-result"].appendChild(heading);
      for (const entry of result.entries.slice(0, 3)) {
        const row = document.createElement("p");
        row.lang = result.language;
        row.textContent = `${entry.pos ? dictionary.partOfSpeech(entry.pos, result.language) + ": " : ""}${entry.translations.join("; ")}`;
        ui["test-result"].appendChild(row);
      }
      if (!result.entries.length) {
        const row = document.createElement("p");
        row.textContent = "No meaning found for this word.";
        ui["test-result"].appendChild(row);
      }
    }
    async function load() {
      try {
        const status = await send({ type: "dictionary:status" });
        if (busy) return;
        // Offer the online trial on first setup, without changing the saved
        // provider until the user saves and a real request succeeds.
        ui.provider.value = !status.configured && status.language === "off" && !status.hasKey ? "microsoft" : status.provider;
        hasKey = status.hasKey;
        ui.region.value = status.region;
        renderLanguages(status.language);
        ready = true;
        note(status.language === "off" ? "Choose a language, then save to use the dictionary."
          : "Settings loaded. Click a caption word to see its meanings.");
        renderControls();
      } catch (error) { note(error.message, true); }
    }
    ui.provider.addEventListener("change", () => {
      renderLanguages(ui.language.value);
      showResult(null); renderControls();
      note("Save to use this source.");
    });
    ui.language.addEventListener("change", () => {
      showResult(null); renderControls(); note("Save to use this language.");
    });
    ui.save.addEventListener("click", async () => {
      if (busy || !ready) return;
      busy = true; renderControls(); showResult(null);
      try {
        // Snapshot the form before awaiting any browser/API action. A pending
        // settings refresh must not change the source or language mid-save.
        const draft = { provider: ui.provider.value, language: ui.language.value,
          key: ui.key.value.trim(), region: ui.region.value.trim(), word: ui["test-word"].value };
        const language = dictionary.languageFor(draft.provider, draft.language);
        if (draft.language !== "off" && language === "off") throw new Error("Choose a language under Translate to, then save.");
        draft.language = language;
        if (draft.provider === "offline" && language !== "off") {
          const status = await send({ type: "dictionary:status" });
          if (!Array.isArray(status.offlineLanguages) || !status.offlineLanguages.includes(language)) {
            throw new Error("Reload Clever Youtube Subtitle on the Extensions page, then reopen Settings to update the offline language list.");
          }
        }
        const online = draft.provider === "microsoft" && language !== "off";
        if (online) {
          if (!draft.key && !hasKey) throw new Error("Paste your Microsoft key first.");
          note("Allow access to Microsoft if asked. Checking your key and looking up the word…");
          const allowed = await root.CleverSubtitleSyncAccess.ensureServerAccess(chrome.permissions, microsoft.ORIGIN);
          if (!allowed) throw new Error("Allow access to Microsoft to check and save your key.");
        }
        const result = await send({ type: "dictionary:configure", ...draft });
        hasKey = result.hasKey;
        if (online) ui.key.value = "";
        regionEdited = false;
        ui.region.value = result.region;
        showResult(result.result);
        note(result.language === "off" ? "Saved. Dictionary is off."
          : online ? "Connected to Microsoft. Settings saved. Click a caption word to see its meanings."
          : "Saved. Offline dictionary is on.");
      } catch (error) { note(error.message, true); }
      finally { busy = false; renderControls(); }
    });
    ui["forget-key"].addEventListener("click", async () => {
      if (busy || !ready) return;
      busy = true; renderControls();
      try {
        const result = await send({ type: "dictionary:forget-key" });
        hasKey = result.hasKey;
        ui.key.value = ""; ui.region.value = "";
        regionEdited = false;
        renderLanguages(result.language);
        showResult(null);
        note(result.provider === "microsoft" ? "Key removed. Dictionary is off." : "Key removed. Offline dictionary is still on.");
      } catch (error) { note(error.message, true); }
      finally { busy = false; renderControls(); }
    });
    ui.region.addEventListener("input", () => { regionEdited = true; });
    chrome.storage?.onChanged?.addListener((changes, area) => {
      if (area === "local" && !busy && !ui.key.value && !regionEdited &&
          (changes[dictionary.PROVIDER_KEY] || changes[dictionary.STORAGE_KEY] || changes[dictionary.MICROSOFT_CONFIG_KEY])) {
        showResult(null);
        return load();
      }
    });
    const loaded = load();
    return { loaded };
  }
  root.CleverSubtitleDictionarySettings = { createSettings };
  if (typeof module !== "undefined" && module.exports) module.exports = { createSettings };
  else createSettings(document, chrome);
})(globalThis);
