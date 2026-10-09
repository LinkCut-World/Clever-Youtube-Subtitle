/* MIT. Adapt official WikDict SQLite data to the existing offline lookup store. */
(function (root) {
  "use strict";
  function convert(SQL, bytes, entry, progress = () => {}) {
    const normalize = root.CleverSubtitleWords.normalizeWord;
    if (bytes.length < 16 || new TextDecoder().decode(bytes.subarray(0, 16)) !== "SQLite format 3\0") {
      throw new Error("Choose an official WikDict SQLite file (.sqlite3).");
    }
    let db, statement;
    try {
      db = new SQL.Database(bytes);
      db.run("PRAGMA query_only = ON");
      const columns = db.exec("PRAGMA table_info(translation)")[0]?.values.map((row) => row[1]) || [];
      if (!["written_rep", "lexentry", "trans_list", "is_good", "score"].every((name) => columns.includes(name))) {
        throw new Error("This SQLite file does not have the supported WikDict format.");
      }
      const total = db.exec("SELECT COUNT(*) FROM translation")[0].values[0][0];
      statement = db.prepare("SELECT written_rep, lexentry, trans_list FROM translation ORDER BY is_good DESC, score DESC, written_rep, lexentry, trans_list");
      const groups = new Map();
      let processed = 0;
      progress({ phase: "prepare", done: 0, total });
      while (statement.step()) {
        const [surface, lexentry, raw] = statement.get();
        processed++;
        if (processed % 10000 === 0) progress({ phase: "prepare", done: processed, total });
        if (typeof surface !== "string" || typeof raw !== "string") continue;
        const word = normalize(surface);
        if (!word || word.length > 120 || /\s/u.test(word)) continue;
        const translations = [...new Set(raw.split(" | ").map((value) => value.trim()).filter(Boolean))];
        if (!translations.length || translations.length > 512 || translations.some((text) => text.length > 10000)) continue;
        const pos = typeof lexentry === "string" ? /__(\w+)__/u.exec(lexentry)?.[1]?.toLowerCase() || "" : "";
        const meaning = { pos, translations }, signature = JSON.stringify(meaning);
        if (!groups.has(word)) groups.set(word, { linked: [], fallback: [], linkedSeen: new Set(), fallbackSeen: new Set() });
        const group = groups.get(word), kind = lexentry ? "linked" : "fallback";
        if (group[kind].length < 10 && !group[`${kind}Seen`].has(signature)) {
          group[kind].push(meaning); group[`${kind}Seen`].add(signature);
        }
      }
      const data = Object.create(null);
      for (const [word, group] of groups) data[word] = group.linked.length ? group.linked : group.fallback;
      const words = Object.keys(data).length;
      if (!words || words !== entry.words) throw new Error("This dictionary does not match the listed version. Please download it again.");
      progress({ phase: "prepare", done: total, total });
      return { language: entry.language, version: entry.version, words, data };
    } catch (error) {
      if (error.message?.startsWith("This ") || error.message?.startsWith("Choose ")) throw error;
      throw new Error("Could not read this WikDict file. Download the official file again.");
    } finally {
      if (statement) statement.free();
      if (db) db.close();
    }
  }
  const api = { convert };
  root.CleverSubtitleWikDictSQLite = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
