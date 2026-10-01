const test = require("node:test");
const assert = require("node:assert/strict");
const { ensureServerAccess } = require("./sync-access.js");

test("Kiwi install-time permission skips its broken active-window dialog", async () => {
  let requests = 0;
  const permissions = {
    contains: async ({ origins }) => { assert.deepEqual(origins, ["https://git.internal.example/*"]); return true; },
    request: async () => { requests++; throw new Error("Could not find an active window."); }
  };
  assert.equal(await ensureServerAccess(permissions, "https://git.internal.example/*"), true);
  assert.equal(requests, 0);
});

test("desktop can still request a missing host permission", async () => {
  let requested;
  const permissions = {
    contains: async () => false,
    request: async (access) => { requested = access; return true; }
  };
  assert.equal(await ensureServerAccess(permissions, "https://git.example/*"), true);
  assert.deepEqual(requested, { origins: ["https://git.example/*"] });
});

test("an unavailable permission dialog explains the Kiwi package fix", async () => {
  const permissions = {
    contains: async () => false,
    request: async () => { throw new Error("Could not find an active window."); }
  };
  await assert.rejects(ensureServerAccess(permissions, "https://git.example/*"), /Install the Kiwi ZIP/);
});
