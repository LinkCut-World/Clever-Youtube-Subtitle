const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { IDBFactory, IDBKeyRange } = require("fake-indexeddb");
const { spawn, execFileSync } = require("node:child_process");
const git = require("isomorphic-git");
const model = require("./sync-model.js");
const codec = require("./sync-codec.js");
const sync = require("./sync-git.js");

test("arbitrary clone hosts, ports, subpaths, and URL credentials are supported", () => {
  assert.deepEqual(sync.parseRepositoryAddress("https://user:secret@git.internal.example:8443/git/group/words.git"), {
    url: "https://git.internal.example:8443/git/group/words.git",
    origin: "https://git.internal.example:8443/*", username: "user", password: "secret"
  });
  assert.equal(sync.parseRepositoryAddress("https://secret@git.example/words.git").username, "secret");
  assert.throws(() => sync.parseRepositoryAddress("git@git.example:words.git"));
  assert.throws(() => sync.parseRepositoryAddress("https://git.example/words.git?token=secret"));
  assert.equal(sync.validateBranch("sync/words"), "sync/words");
  assert.throws(() => sync.validateBranch("../main"));
});

async function createServer(t) {
  const tmp = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(tmp, "clever-subtitle-git-test-"));
  const repo = path.join(root, "words.git");
  execFileSync("git", ["init", "--bare", "--initial-branch=main", repo], { stdio: "ignore" });
  execFileSync("git", ["--git-dir", repo, "config", "http.receivepack", "true"]);
  const authorization = `Basic ${Buffer.from("user:secret").toString("base64")}`;
  const server = http.createServer((request, response) => {
    if (request.headers.authorization !== authorization) {
      response.writeHead(401, { "WWW-Authenticate": 'Basic realm="Git"' });
      response.end();
      return;
    }
    const url = new URL(request.url, "http://localhost");
    if (!url.pathname.startsWith("/words.git/")) { response.writeHead(404); response.end(); return; }
    const process = spawn("git", ["http-backend"], {
      env: { ...global.process.env,
        GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: "1",
        REQUEST_METHOD: request.method, PATH_INFO: url.pathname, QUERY_STRING: url.search.slice(1),
        CONTENT_TYPE: request.headers["content-type"] || "",
        CONTENT_LENGTH: request.headers["content-length"] || "0", REMOTE_USER: "user"
      }, stdio: ["pipe", "pipe", "pipe"]
    });
    const output = [];
    process.stdout.on("data", (chunk) => output.push(chunk));
    process.stderr.resume();
    request.pipe(process.stdin);
    process.on("close", (code) => {
      const data = Buffer.concat(output);
      const separator = data.indexOf("\r\n\r\n");
      if (code !== 0 || separator < 0) { response.writeHead(500); response.end(); return; }
      let status = 200;
      const headers = {};
      for (const line of data.subarray(0, separator).toString().split("\r\n")) {
        const colon = line.indexOf(":");
        const name = line.slice(0, colon);
        const value = line.slice(colon + 1).trim();
        if (name.toLowerCase() === "status") status = Number(value.split(" ")[0]);
        else headers[name] = value;
      }
      response.writeHead(status, headers);
      response.end(data.subarray(separator + 4));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const config = { url: `http://127.0.0.1:${server.address().port}/words.git`, username: "user", password: "secret", branch: "" };
  const runtime = {
    git,
    async createWorkspace() {
      const dir = fs.mkdtempSync(path.join(root, "checkout-"));
      return { fs, dir };
    }
  };
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    const resolved = fs.realpathSync(root);
    assert.equal(path.dirname(resolved), tmp);
    assert.ok(path.basename(resolved).startsWith("clever-subtitle-git-test-"));
    fs.rmSync(resolved, { recursive: true });
  });
  async function remoteState() {
    const oid = await git.resolveRef({ fs, gitdir: repo, ref: "HEAD" });
    const { blob } = await git.readBlob({ fs, gitdir: repo, oid, filepath: sync.FILE_PATH });
    return codec.decodeState(blob);
  }
  return { config, runtime, repo, remoteState };
}

test("real Git Smart HTTP initializes an empty remote and merges a concurrent push", async (t) => {
  const { config, runtime, repo, remoteState } = await createServer(t);
  const seed = model.emptyState(["like"]);
  await sync.syncWithGit(fetch, config, seed, runtime);
  assert.deepEqual(model.effectiveWords(await remoteState()), ["like"]);

  // Add a second file using ordinary Git objects. Sync must keep it in later commits.
  const old = await git.resolveRef({ fs, gitdir: repo, ref: "HEAD" });
  const existingTree = (await git.readTree({ fs, gitdir: repo, oid: old })).tree;
  const readme = await git.writeBlob({ fs, gitdir: repo, blob: new TextEncoder().encode("Keep this file") });
  const tree = await git.writeTree({ fs, gitdir: repo, tree: [...existingTree,
    { mode: "100644", path: "README.md", oid: readme, type: "blob" }] });
  await git.commit({ fs, gitdir: repo, tree, parent: [old], message: "Add README",
    author: { name: "Test", email: "test@example.invalid" } });

  const computer = model.applyMutation(seed, { add: ["apple"] }, "computer", 0, 100).state;
  const phone = model.applyMutation(seed, { remove: ["like"], add: ["listen"] }, "phone", 0, 200).state;
  let pushes = 0;
  const racingRuntime = { ...runtime, git: { ...git,
    async push(options) {
      if (++pushes === 1) await sync.syncWithGit(fetch, config, phone, runtime);
      return git.push(options);
    }
  } };
  const merged = await sync.syncWithGit(fetch, config, computer, racingRuntime);
  assert.ok(pushes >= 2, "The losing push should fetch and retry automatically");
  assert.deepEqual(model.effectiveWords(merged), ["apple", "listen"]);
  assert.deepEqual(model.effectiveWords(await remoteState()), ["apple", "listen"]);
  const head = await git.resolveRef({ fs, gitdir: repo, ref: "HEAD" });
  const { blob } = await git.readBlob({ fs, gitdir: repo, oid: head, filepath: "README.md" });
  assert.equal(new TextDecoder().decode(blob), "Keep this file");
  await sync.syncWithGit(fetch, config, merged, runtime);
  assert.equal(await git.resolveRef({ fs, gitdir: repo, ref: "HEAD" }), head, "Unchanged sync should not add a commit");
});

test("real Git rejects invalid credentials and never overwrites a damaged vocabulary", async (t) => {
  const { config, runtime, repo } = await createServer(t);
  await assert.rejects(sync.syncWithGit(fetch, { ...config, password: "wrong" }, model.emptyState(), runtime), /credentials/);
  const blobOid = await git.writeBlob({ fs, gitdir: repo, blob: new TextEncoder().encode("not a vocabulary") });
  const tree = await git.writeTree({ fs, gitdir: repo, tree: [
    { mode: "100644", path: sync.FILE_PATH, oid: blobOid, type: "blob" }
  ] });
  const head = await git.commit({ fs, gitdir: repo, tree, parent: [], message: "Invalid file",
    author: { name: "Test", email: "test@example.invalid" } });
  await assert.rejects(sync.syncWithGit(fetch, config, model.emptyState(["like"]), runtime), /invalid/);
  assert.equal(await git.resolveRef({ fs, gitdir: repo, ref: "HEAD" }), head);
});

test("packaged browser Git client works in a worker with IndexedDB and no window", async (t) => {
  const { config, remoteState } = await createServer(t);
  const context = {
    TextEncoder, TextDecoder, URL, Uint8Array, ArrayBuffer, Buffer: undefined,
    setTimeout, clearTimeout, console, crypto: webcrypto,
    indexedDB: new IDBFactory(), IDBKeyRange, navigator: {}
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("git-bundle.js", "utf8"), context, { filename: "git-bundle.js" });
  const runtime = context.CleverSubtitleGitRuntime;
  assert.equal(runtime.git.version(), "1.42.6");
  let runtimeError = "";
  runtime.git = Object.fromEntries(Object.entries(runtime.git).map(([name, operation]) => [name, async (...args) => {
    try { return await operation(...args); }
    catch (error) { runtimeError = `${name}: ${error.message}`; throw error; }
  }]));
  const initial = model.emptyState(["like"]);
  try { await sync.syncWithGit(fetch, config, initial, runtime); }
  catch (error) { assert.fail(runtimeError || error.message); }
  const changed = model.applyMutation(initial, { remove: ["like"], add: ["listen"] }, "phone", 0, 100).state;
  await sync.syncWithGit(fetch, config, changed, runtime);
  assert.deepEqual(model.effectiveWords(await remoteState()), ["listen"]);
});
