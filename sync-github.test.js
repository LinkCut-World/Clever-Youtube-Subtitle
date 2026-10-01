const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("./sync-model.js");
const github = require("./sync-github.js");

test("tokenized HTTPS address is parsed without putting the token in the repository name", () => {
  assert.deepEqual(github.parseRepositoryAddress("https://user:secret@github.com/Name/words.git"), {
    repository: "Name/words", token: "secret"
  });
  assert.deepEqual(github.parseRepositoryAddress("https://secret@github.com/Name/words"), {
    repository: "Name/words", token: "secret"
  });
  assert.throws(() => github.parseRepositoryAddress("https://evil.example/Name/words"));
});

test("concurrent GitHub writes are retried and merged without manual Git work", async () => {
  let remote = model.emptyState(["like"]);
  let sha = "initial";
  let conflictOnce = true;
  const fetcher = async (url, request) => {
    assert.equal(request.headers.Authorization, "Bearer secret");
    if (!url.includes("/contents/")) return { ok: true, json: async () => ({ private: true }) };
    if (request.method === "GET") {
      return { ok: true, json: async () => ({ sha, content: await github.encodeContent(remote) }) };
    }
    const payload = JSON.parse(request.body);
    if (conflictOnce) {
      conflictOnce = false;
      remote = model.applyMutation(remote, { remove: ["like"] }, "phone", 0, 200).state;
      sha = "from-phone";
      return { ok: false, status: 409 };
    }
    assert.equal(payload.sha, sha);
    remote = await github.decodeContent(payload.content);
    sha = "latest";
    return { ok: true, json: async () => ({}) };
  };
  const computer = model.applyMutation(model.emptyState(["like"]), { add: ["apple"] }, "computer", 0, 100).state;
  const result = await github.syncWithGithub(fetcher, { repository: "Name/words", token: "secret" }, computer);
  assert.deepEqual(model.effectiveWords(result), ["apple"]);
  assert.deepEqual(model.effectiveWords(remote), ["apple"]);
});

test("a damaged remote file is not overwritten", async () => {
  let writes = 0;
  const fetcher = async (url, request) => {
    if (!url.includes("/contents/")) return { ok: true, json: async () => ({ private: true }) };
    if (request.method === "GET") {
      return { ok: true, json: async () => ({ sha: "bad", content: btoa("not json") }) };
    }
    writes++;
    return { ok: true, json: async () => ({}) };
  };
  await assert.rejects(github.syncWithGithub(fetcher, { repository: "Name/words", token: "secret" }, model.emptyState(["like"])));
  assert.equal(writes, 0);
});

test("public repositories are rejected before any vocabulary is uploaded", async () => {
  let contentRequests = 0;
  const fetcher = async (url) => {
    if (url.includes("/contents/")) contentRequests++;
    return { ok: true, json: async () => ({ private: false }) };
  };
  await assert.rejects(github.syncWithGithub(fetcher, { repository: "Name/words", token: "secret" }, model.emptyState(["like"])), /public/);
  assert.equal(contentRequests, 0);
});

test("compressed repository file handles a large vocabulary", async () => {
  const words = Array.from({ length: 15000 }, (_, index) => `longerword${index}`);
  const state = model.applyMutation(model.emptyState(words), { replace: ["longerword1"] }, "device-a", 0, 100).state;
  const encoded = await github.encodeContent(state);
  assert.ok(encoded.length * 0.75 < 1_000_000);
  const decoded = await github.decodeContent(encoded);
  assert.equal(model.equalStates(decoded, state), true);
});
