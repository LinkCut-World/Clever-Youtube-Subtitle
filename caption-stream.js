/* MIT. Tracks word occurrences through append-only captions and line rolls.
   Linguistic results come only from the original model via nlp-client.js. */
(function (root) {
  "use strict";
  const splitWords = (text) => String(text).match(/\S+/gu) || [];
  const startsWith = (values, prefix) => values.length >= prefix.length &&
    prefix.every((value, index) => value === values[index]);

  function createStream(nlp, words, changed = () => {}) {
    let lines = [], recent, streaming = false, history = [];
    let nextId = 0, revision = 0, running, queued, lastText;
    const newWord = (text) => ({ id: String(++nextId), text, ready: false, lemmas: [], revision: 0 });

    function reset() {
      lines = [];
      recent = undefined;
      streaming = false;
      history = [];
      queued = undefined;
      running = undefined;
      lastText = undefined;
      // IDs and revisions never repeat. Old requests can finish for frozen
      // history, but their word references cannot belong to a new caption.
    }

    function partition(texts, units, oldLines, sources) {
      let offset = 0;
      return texts.map((text, index) => {
        const count = splitWords(text).length;
        const rowWords = units.slice(offset, offset + count);
        offset += count;
        const previous = oldLines.find((line) => line.units[0] === rowWords[0]);
        return { id: previous?.id || `line-${rowWords[0]?.id}`, text, units: rowWords,
          source: sources[index], snapshot: previous?.snapshot };
      });
    }

    function apply(snapshot, tokens) {
      const parts = words.captionPartsForSegments([snapshot.text], new Set(), tokens)[0]
        .filter((part) => !/^\s+$/u.test(part.text));
      for (const [index, unit] of snapshot.units.entries()) {
        if (unit.revision > snapshot.revision) continue;
        const part = parts[index];
        unit.lemmas = part?.text === unit.text ? part.lemmas || [] : [];
        unit.ready = true;
        unit.revision = snapshot.revision;
      }
    }

    function pump() {
      if (running || !queued) return;
      const snapshot = queued;
      queued = undefined;
      running = snapshot;
      Promise.resolve().then(() => nlp.analyze(snapshot.text)).catch(() => []).then((tokens) => {
        apply(snapshot, tokens);
        if (running === snapshot) running = undefined;
        changed();
        pump();
      });
    }

    function request() {
      if (!lines.length) return;
      const contextLines = recent ? [recent, ...lines] : lines;
      const text = contextLines.map((line) => line.text).join(" ");
      if (text === lastText) return;
      lastText = text;
      const snapshot = { text, units: contextLines.flatMap((line) => line.units), revision: ++revision };
      for (const line of contextLines) line.snapshot = snapshot;
      const cached = nlp.peek(text);
      if (cached !== undefined) {
        apply(snapshot, cached);
        queued = undefined;
      } else {
        queued = snapshot;
        pump();
      }
    }

    function finish(line) {
      const waiting = line.units.filter((unit) => !unit.ready);
      if (!waiting.length || line.finishing) return;
      const covers = (snapshot) => snapshot && waiting.every((unit) => snapshot.units.includes(unit));
      if (covers(running) || covers(queued)) return;
      // A frozen row may outlive the current stream's coalesced snapshots.
      // Finish it from its original context, rather than leaving it invisible
      // or guessing a lemma from the isolated row.
      const snapshot = line.snapshot || { text: line.text, units: line.units, revision: ++revision };
      const cached = nlp.peek(snapshot.text);
      if (cached !== undefined) { apply(snapshot, cached); return; }
      line.finishing = true;
      Promise.resolve().then(() => nlp.analyze(snapshot.text)).catch(() => []).then((tokens) => {
        apply(snapshot, tokens);
        line.finishing = false;
        changed();
      });
    }

    function update(values) {
      const descriptors = values.map((value) => typeof value === "string" ? { text: value } : value)
        .filter((value) => splitWords(value.text).length);
      const texts = descriptors.map((value) => splitWords(value.text).join(" "));
      const incoming = texts.flatMap(splitWords);
      const oldLines = lines;
      const oldUnits = oldLines.flatMap((line) => line.units);
      const oldWords = oldUnits.map((unit) => unit.text);
      let kind = "same", removed, units, historyRows;
      if (!incoming.length) {
        // A temporary blank can be a player reflow. Keep history unchanged
        // until a surviving row or the next distinct caption identifies it.
        return { kind: "blank", streaming, units: [] };
      }
      const movedSource = descriptors[0].source && oldLines.findIndex((line) => line.source === descriptors[0].source);
      if (!(movedSource > 0) && startsWith(incoming, oldWords) && oldWords.length) {
        units = [...oldUnits, ...incoming.slice(oldWords.length).map(newWord)];
        if (incoming.length > oldWords.length) { kind = "append"; streaming = true; }
        else if (texts.join("\n") !== oldLines.map((line) => line.text).join("\n")) kind = "reflow";
      } else {
        for (let dropped = 1; dropped < oldLines.length; dropped++) {
          if (movedSource > 0 && dropped !== movedSource) continue;
          const retained = oldLines.slice(dropped).flatMap((line) => line.units);
          if (!startsWith(incoming, retained.map((unit) => unit.text))) continue;
          removed = oldLines[dropped - 1];
          history = [...history, ...oldLines.slice(0, dropped)].slice(-2);
          historyRows = history;
          recent = removed;
          units = [...retained, ...incoming.slice(retained.length).map(newWord)];
          streaming = true;
          kind = "roll";
          break;
        }
        if (!units) {
          if (startsWith(incoming, oldWords) && oldWords.length) {
            // YouTube may recycle visual-row containers during a reflow.
            // A moved node whose text does not fit a roll is only a hint.
            units = [...oldUnits, ...incoming.slice(oldWords.length).map(newWord)];
            kind = incoming.length > oldWords.length ? "append" : "reflow";
            if (kind === "append") streaming = true;
          } else {
            removed = streaming ? oldLines.at(-1) : undefined;
            if (removed) historyRows = [...history, ...oldLines].slice(-2);
            reset();
            units = incoming.map(newWord);
            kind = "replace";
          }
        }
      }
      lines = partition(texts, units, oldLines, descriptors.map((value) => value.source));
      request();
      const previous = historyRows && { lines: historyRows,
        text: historyRows.map((line) => line.text).join("\n") };
      return { kind, streaming, removed, units, lines, history: previous };
    }

    function parts(texts, knownWords, units = lines.flatMap((line) => line.units)) {
      let index = 0;
      return texts.map((text) => [...String(text).matchAll(/\s+|\S+/gu)].map(([value]) => {
        if (/^\s+$/u.test(value)) return { text: value, hidden: false };
        const unit = units[index++];
        // Preserve the actual DOM's spacing. Tracking uses whitespace-normalized
        // words, while model annotations were validated against their snapshot.
        const matches = unit?.text === value;
        const part = words.matchWord(value, matches ? unit.lemmas : [], knownWords);
        part.pending = !matches || !unit.ready;
        if (matches) part.id = unit.id;
        return part;
      }));
    }
    return { update, parts, finish, reset };
  }

  root.CleverSubtitleStream = { createStream };
  if (typeof module !== "undefined" && module.exports) module.exports = { createStream };
})(globalThis);
