const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { normalizeWord, parseWordList, captionParts, captionPartsForSegments } = require("./word-utils.js");

test("word lists are normalized, deduplicated, and case insensitive", () => {
  assert.deepEqual(parseWordList("Hello, WORLD\nhello; It's"), ["hello", "it's", "world"]);
  assert.equal(normalizeWord("“We’re!”"), "we're");
});

test("caption parts keep exact spacing while marking familiar words", () => {
  const known = new Set(parseWordList("I hello world"));
  const parts = captionParts("Hello,   curious\nworld!", known);
  assert.equal(parts.map((part) => part.text).join(""), "Hello,   curious\nworld!");
  assert.deepEqual(parts.filter((part) => part.hidden).map((part) => part.text), ["Hello,", "world!"]);
  assert.deepEqual(captionParts("HELLO, WORLD!", known).filter((part) => part.hidden).map((part) => part.text), ["HELLO,", "WORLD!"]);
});

test("base words cover regular and irregular English inflections", () => {
  const known = new Set(parseWordList("he like go child good"));
  const parts = captionParts("He likes her. He liked going with children, feeling better.", known);
  assert.deepEqual(
    parts.filter((part) => part.hidden).map((part) => part.text),
    ["He", "likes", "He", "liked", "going", "children,", "better."]
  );
  assert.equal(captionParts("likeness", known)[0].hidden, false);
});

test("the model uses caption context to distinguish verb and noun forms", () => {
  const known = new Set(parseWordList("see"));
  const parts = captionPartsForSegments(["I saw a", "saw."], known);
  assert.deepEqual(parts.map((segment) => segment.filter((part) => part.hidden).map((part) => part.text)), [["saw"], []]);
  assert.equal(parts[0].map((part) => part.text).join(""), "I saw a");
  assert.equal(parts[1].map((part) => part.text).join(""), "saw.");
});

test("visible inflected words offer their contextual base form for adding", () => {
  const parts = captionPartsForSegments(["He likes her", "I saw a saw."], new Set());
  assert.equal(parts[0][2].addWord, "like");
  assert.equal(parts[1][2].addWord, "see");
  assert.equal(parts[1][6].addWord, "saw");
  assert.equal(parts[0].map((part) => part.text).join(""), "He likes her");
});

test("hidden inflected words point to the saved word that can be removed", () => {
  const parts = captionParts("He likes her", new Set(["like"]));
  assert.equal(parts[2].hidden, true);
  assert.equal(parts[2].removeWord, "like");
});

test("a contraction is hidden only when all of its meaningful pieces are known", () => {
  assert.equal(captionParts("Don't stop.", new Set(["do"]))[0].hidden, false);
  assert.equal(captionParts("Don't stop.", new Set(["do", "not"]))[0].hidden, true);
});

const reportedSentence = "when you pulg in negative 2, it gives you 1 plus 4 plus 9 plus 16 on and on.";

function checkGivesMatching(api) {
  const known = new Set(["give"]);
  for (const sentence of [reportedSentence, reportedSentence.replace("pulg", "plug")]) {
    for (const suffix of ["", " ", "  \n\t\u00a0"]) {
      const text = sentence + suffix;
      // YouTube can split the same line into separate DOM segments at any point.
      for (const split of [0, sentence.indexOf("gives"), sentence.indexOf("gives") + 5, sentence.length]) {
        const segments = [text.slice(0, split), text.slice(split)];
        const parts = api.captionPartsForSegments(segments, known);
        assert.deepEqual(Array.from(parts, (segment) => segment.map((part) => part.text).join("")), segments);
        const gives = parts.flat().find((part) => part.text === "gives");
        assert.equal(gives.hidden, true, `gives should match give with suffix ${JSON.stringify(suffix)}`);
        assert.equal(gives.addWord, "give");
        assert.equal(gives.removeWord, "give");
        const visible = api.captionPartsForSegments(segments, new Set()).flat().find((part) => part.text === "gives");
        assert.equal(visible.hidden, false);
        assert.equal(visible.addWord, "give");
      }
    }
  }
}

test("the reported gives example matches give across trailing whitespace and caption segments", () => {
  checkGivesMatching({ captionPartsForSegments });
  const parts = captionPartsForSegments(["I saw a", "saw. \n"], new Set(["see"]));
  assert.deepEqual(parts.flat().filter((part) => part.hidden).map((part) => part.text), ["saw"]);
  assert.equal(captionParts("Don't stop. ", new Set(["do"]))[0].hidden, false);
});

test("a token text mismatch still avoids assigning unrelated lemmas", () => {
  const context = { CleverSubtitleNLP: {
    its: { value: "value", precedingSpaces: "spaces", lemma: "lemma" },
    readDoc: () => ({ tokens: () => ({ out: (key) => ({ value: ["takes"], spaces: [""], lemma: ["take"] })[key] }) })
  } };
  vm.runInNewContext(fs.readFileSync("word-utils.js", "utf8"), context);
  const [part] = context.CleverSubtitleWords.captionParts("gives ", new Set(["take"]));
  assert.equal(part.hidden, false);
  assert.equal(part.addWord, "gives");
});

function checkUnchangedLemmas(api) {
  const model = require("wink-nlp")(require("wink-eng-lite-web-model"));
  for (const text of [
    "his main focus was on understanding what happens when you plug in a complex value for s.",
    "My understanding is different.",
    "I am understanding this better."
  ]) {
    const tokens = model.readDoc(text).tokens();
    const index = tokens.out(model.its.value).indexOf("understanding");
    const lemma = normalizeWord(tokens.itemAt(index).out(model.its.lemma));
    const part = api.captionParts(text, new Set(["understand"]))
      .find((part) => part.text === "understanding");
    assert.equal(part.addWord, lemma, "The adapter must not override the upstream linguistic result");
    assert.equal(part.hidden, lemma === "understand");
  }
}

test("the understanding examples preserve the upstream model's lemmas", () => {
  checkUnchangedLemmas({ captionParts });
});

test("the packaged browser model matches likes and the reported gives example", () => {
  const context = { atob, Uint8Array, ArrayBuffer, DataView };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync("lemma-bundle.js", "utf8"), context);
  vm.runInNewContext(fs.readFileSync("word-utils.js", "utf8"), context);
  const parts = context.CleverSubtitleWords.captionParts("He likes her", new Set(["like"]));
  assert.equal(parts.map((part) => part.text).join(""), "He likes her");
  assert.equal(parts[0].hidden, false);
  assert.equal(parts[2].text, "likes");
  assert.equal(parts[2].hidden, true);
  assert.equal(parts[4].hidden, false);
  checkGivesMatching(context.CleverSubtitleWords);
  checkUnchangedLemmas(context.CleverSubtitleWords);
});
