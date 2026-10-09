/* MIT. Shared word-meaning settings. Downloaded data has its own license. */
(function (root) {
  "use strict";
  const STORAGE_KEY = "dictionaryLanguage";
  const PROVIDER_KEY = "dictionaryProvider";
  const MICROSOFT_CONFIG_KEY = "microsoftDictionaryConfig";
  const PACK_REVISION_KEY = "dictionaryPackRevision";
  const catalog = root.CleverSubtitleDictionaryCatalog ||
    (typeof module !== "undefined" && module.exports ? require("./dictionary-catalog.js") : null);
  const LANGUAGES = (catalog?.packs || []).map((entry) => ({ code: entry.language,
    name: entry.englishName && entry.englishName !== entry.name ? `${entry.englishName} · ${entry.name}` : entry.name }));
  const POS_LANGUAGES = ["zh", "es", "fr", "de", "ja"];
  // English dictionary targets from Microsoft's Languages API, 2026-10-08.
  // This list is for Dictionary Lookup, not the broader Translate operation.
  const MICROSOFT_LANGUAGES = [
    ["af", "Afrikaans"], ["ar", "العربية"], ["bg", "Български"], ["bn", "বাংলা"],
    ["bs", "Bosanski"], ["ca", "Català"], ["cs", "Čeština"], ["cy", "Cymraeg"],
    ["da", "Dansk"], ["de", "Deutsch"], ["el", "Ελληνικά"], ["es", "Español"],
    ["et", "Eesti"], ["fa", "فارسی"], ["fi", "Suomi"], ["fr", "Français"],
    ["he", "עברית"], ["hi", "हिन्दी"], ["hr", "Hrvatski"], ["hu", "Magyar"],
    ["id", "Indonesia"], ["is", "Íslenska"], ["it", "Italiano"], ["ja", "日本語"],
    ["ko", "한국어"], ["lt", "Lietuvių"], ["lv", "Latviešu"], ["ms", "Melayu"],
    ["mt", "Malti"], ["mww", "Hmong Daw"], ["nb", "Norsk Bokmål"], ["nl", "Nederlands"],
    ["pl", "Polski"], ["pt", "Português (Brasil)"], ["ro", "Română"], ["ru", "Русский"],
    ["sk", "Slovenčina"], ["sl", "Slovenščina"], ["sr-Latn", "Srpski (latinica)"],
    ["sv", "Svenska"], ["sw", "Kiswahili"], ["ta", "தமிழ்"], ["th", "ไทย"],
    ["tlh-Latn", "Klingon (Latin)"], ["tr", "Türkçe"], ["uk", "Українська"],
    ["ur", "اردو"], ["vi", "Tiếng Việt"], ["zh-Hans", "中文 (简体)"]
  ].map(([code, name]) => ({ code, name }));
  const normalize = (value) => root.CleverSubtitleWords.normalizeWord(value);
  const isOfflineLanguage = (code) => LANGUAGES.some((language) => language.code === code);
  const microsoftLanguage = (code) => code === "zh" ? "zh-Hans" : code;
  const isMicrosoftLanguage = (code) => MICROSOFT_LANGUAGES.some((entry) => entry.code === microsoftLanguage(code));
  const isLanguage = (code) => isOfflineLanguage(code) || isMicrosoftLanguage(code);
  function languagesFor(provider) { return provider === "microsoft" ? MICROSOFT_LANGUAGES : LANGUAGES; }
  function languageFor(provider, code) {
    const language = provider === "microsoft" ? microsoftLanguage(code) : code === "zh-Hans" ? "zh" : code;
    return languagesFor(provider).some((entry) => entry.code === language) ? language : "off";
  }
  function candidatesFor({ word, lemma }) {
    if (typeof word !== "string" || word.length > 120 ||
        (lemma !== undefined && (typeof lemma !== "string" || lemma.length > 120))) {
      throw new Error("This word is too long to look up.");
    }
    return [...new Set([normalize(lemma || word), normalize(word)].filter(Boolean))];
  }
  // Grammar labels are part of the dictionary explanation, so use its language.
  const POS_LABELS = {
    noun: ["名词", "sustantivo", "nom", "Nomen", "名詞"],
    verb: ["动词", "verbo", "verbe", "Verb", "動詞"],
    adjective: ["形容词", "adjetivo", "adjectif", "Adjektiv", "形容詞"],
    adverb: ["副词", "adverbio", "adverbe", "Adverb", "副詞"],
    pronoun: ["代词", "pronombre", "pronom", "Pronomen", "代名詞"],
    preposition: ["介词", "preposición", "préposition", "Präposition", "前置詞"],
    conjunction: ["连词", "conjunción", "conjonction", "Konjunktion", "接続詞"],
    interjection: ["感叹词", "interjección", "interjection", "Interjektion", "間投詞"],
    determiner: ["限定词", "determinante", "déterminant", "Determinativ", "限定詞"],
    article: ["冠词", "artículo", "article", "Artikel", "冠詞"],
    propernoun: ["专有名词", "nombre propio", "nom propre", "Eigenname", "固有名詞"],
    numeral: ["数词", "numeral", "numéral", "Numerale", "数詞"],
    prefix: ["前缀", "prefijo", "préfixe", "Präfix", "接頭辞"],
    suffix: ["后缀", "sufijo", "suffixe", "Suffix", "接尾辞"]
  };
  function partOfSpeech(pos, language) {
    const index = POS_LANGUAGES.indexOf(language === "zh-Hans" ? "zh" : language);
    return POS_LABELS[pos.replace(/[_ -]/gu, "")]?.[index] || pos;
  }
  function shardFor(word) {
    let hash = 2166136261;
    for (const character of word) hash = Math.imul(hash ^ character.codePointAt(0), 16777619) >>> 0;
    return (hash % 128).toString(16).padStart(2, "0");
  }

  function createDictionary(loadShard) {
    // Small files and a bounded cache avoid loading a whole dictionary on a phone.
    const cache = new Map();
    async function read(language, word) {
      const shard = shardFor(word), key = `${language}/${shard}`;
      if (cache.has(key)) {
        const hit = cache.get(key);
        cache.delete(key); cache.set(key, hit);
        return hit;
      }
      const task = Promise.resolve().then(() => loadShard(language, shard));
      cache.set(key, task);
      if (cache.size > 4) cache.delete(cache.keys().next().value);
      try { return await task; }
      catch (error) { if (cache.get(key) === task) cache.delete(key); throw error; }
    }
    async function lookup({ word, lemma, language }) {
      if (!isOfflineLanguage(language)) throw new Error("Choose a language in Settings → Dictionary.");
      const candidates = candidatesFor({ word, lemma });
      for (const candidate of candidates) {
        const data = await read(language, candidate);
        if (Object.hasOwn(data, candidate) && Array.isArray(data[candidate]) && data[candidate].length) {
          return { word: candidate, language, entries: data[candidate] };
        }
      }
      return { word: candidates[0] || "", language, entries: [] };
    }
    return { lookup, clear: () => cache.clear() };
  }
  const api = { STORAGE_KEY, PROVIDER_KEY, MICROSOFT_CONFIG_KEY, PACK_REVISION_KEY, LANGUAGES, MICROSOFT_LANGUAGES,
    isLanguage, isOfflineLanguage, isMicrosoftLanguage, microsoftLanguage, languagesFor, languageFor,
    candidatesFor, partOfSpeech, shardFor, createDictionary };
  root.CleverSubtitleDictionary = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
