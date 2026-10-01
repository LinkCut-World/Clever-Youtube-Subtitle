(function (root) {
  "use strict";

  const model = root.CleverSubtitleSyncModel ||
    (typeof module !== "undefined" && module.exports ? require("./sync-model.js") : null);
  const codec = root.CleverSubtitleSyncCodec ||
    (typeof module !== "undefined" && module.exports ? require("./sync-codec.js") : null);
  const FILE_PATH = "clever-subtitle-vocabulary.json.gz";

  function parseRepositoryAddress(value) {
    let url;
    try { url = new URL(String(value || "").trim()); }
    catch { throw new Error("Enter the repository's HTTPS clone URL."); }
    if (!["https:", "http:"].includes(url.protocol) || !url.hostname ||
        url.pathname === "/" || url.search || url.hash) {
      throw new Error("Enter an HTTP or HTTPS Git clone URL.");
    }
    const username = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    url.username = "";
    url.password = "";
    url.pathname = url.pathname.replace(/\/+$/g, "");
    return { url: url.href, origin: `${url.origin}/*`, username, password };
  }

  function validateBranch(value) {
    const branch = String(value || "").trim();
    if (branch && (/\s|[~^:?*\[\\]|\.\.|@\{|\/\/|[\x00-\x1f\x7f]/u.test(branch) ||
        branch.startsWith("-") || branch.startsWith("/") || branch.endsWith("/") ||
        branch.endsWith(".") || branch === "@" ||
        branch.split("/").some((part) => part.startsWith(".") || part.endsWith(".lock")))) {
      throw new Error("Enter a valid Git branch name, or leave it empty.");
    }
    return branch;
  }

  function basicAuth(username, password) {
    const bytes = new TextEncoder().encode(`${username || ""}:${password || ""}`);
    return `Basic ${btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))}`;
  }

  function createHttpClient(fetcher, config) {
    const origin = new URL(config.url).origin;
    return {
      async request({ url, method = "GET", headers = {}, body }) {
        if (new URL(url).origin !== origin) throw new Error("The Git server redirected to a different site.");
        let data;
        if (body && ArrayBuffer.isView(body)) {
          data = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
        } else if (body) {
          const chunks = [];
          for await (const chunk of body) chunks.push(new Uint8Array(chunk));
          data = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
          let offset = 0;
          for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
        }
        const requestHeaders = { ...headers };
        if (config.username || config.password) {
          requestHeaders.Authorization = basicAuth(config.username, config.password);
        }
        const response = await fetcher(url, {
          method, headers: requestHeaders, body: data,
          redirect: "error", credentials: "omit", cache: "no-store"
        });
        const responseHeaders = Object.fromEntries(response.headers.entries());
        const bytes = new Uint8Array(await response.arrayBuffer());
        return {
          url: response.url || url, method, headers: responseHeaders,
          statusCode: response.status, statusMessage: response.statusText,
          body: [bytes]
        };
      }
    };
  }

  function safeError(error) {
    if (error?.code === "HttpError") {
      const status = error.data?.statusCode;
      return new Error(status === 401 || status === 403
        ? "The Git server rejected the credentials or write permission."
        : `Could not reach the Git repository${status ? ` (HTTP ${status})` : ""}.`);
    }
    return new Error("Could not sync with the Git server. Check the clone URL, credentials, and network.");
  }

  async function syncWithGit(fetcher, config, localState, runtime = root.CleverSubtitleGitRuntime) {
    if (!runtime) throw new Error("The Git client could not start. Reload the extension.");
    const { git } = runtime;
    const http = createHttpClient(fetcher, config);
    const network = { http, url: config.url,
      onAuth: () => ({ username: config.username || "", password: config.password || "" }) };

    for (let attempt = 0; attempt < 6; attempt++) {
      const workspace = await runtime.createWorkspace();
      const { fs, dir } = workspace;
      try {
        const refs = await git.listServerRefs({ ...network, protocolVersion: 1, symrefs: true });
        const head = refs.find((ref) => ref.ref === "HEAD");
        const branch = validateBranch(config.branch) || head?.target?.replace(/^refs\/heads\//, "") ||
          refs.find((ref) => ref.ref.startsWith("refs/heads/"))?.ref.slice(11) || "main";
        const exists = refs.some((ref) => ref.ref === `refs/heads/${branch}`);
        if (refs.some((ref) => ref.ref.startsWith("refs/heads/")) && !exists) {
          throw new Error("The selected branch does not exist. Check its name or leave it empty.");
        }
        if (exists) {
          await git.clone({ ...network, fs, dir, ref: branch, singleBranch: true, depth: 1, noTags: true, noCheckout: true });
        } else {
          await git.init({ fs, dir, defaultBranch: branch });
          await git.addRemote({ fs, dir, remote: "origin", url: config.url });
        }

        let remote = model.emptyState();
        let present = false;
        let parent;
        let remoteTree = [];
        if (exists) {
          const oid = await git.resolveRef({ fs, dir, ref: "HEAD" });
          parent = oid;
          remoteTree = (await git.readTree({ fs, dir, oid })).tree;
          let blob;
          try { blob = await git.readBlob({ fs, dir, oid, filepath: FILE_PATH }); }
          catch (error) { if (error.code !== "NotFoundError") throw error; }
          if (blob) {
            try { remote = await codec.decodeState(blob.blob); present = true; }
            catch { throw new Error("The remote vocabulary file is invalid. Your local words were kept."); }
          }
        }
        const merged = model.mergeStates(localState, remote);
        if (present && model.equalStates(merged, remote)) return merged;

        // Replace one blob in the remote tree. Other files stay in the commit,
        // without checking out or following symlinks from the repository.
        const blobOid = await git.writeBlob({ fs, dir, blob: await codec.encodeState(merged) });
        const tree = await git.writeTree({ fs, dir, tree: [
          ...remoteTree.filter((entry) => entry.path !== FILE_PATH),
          { mode: "100644", path: FILE_PATH, oid: blobOid, type: "blob" }
        ] });
        await git.commit({ fs, dir, tree, parent: parent ? [parent] : [], message: "Sync My Vocabulary",
          author: { name: "Clever Youtube Subtitle", email: "sync@clever-subtitle.invalid" } });
        try {
          const result = await git.push({ ...network, fs, dir, ref: branch, remoteRef: branch, force: false });
          if (!result.ok) {
            const rejection = new Error("Push rejected");
            rejection.code = "PushRejectedError";
            throw rejection;
          }
          return merged;
        } catch (error) {
          if (!["PushRejectedError", "NotFastForwardError"].includes(error.code)) throw error;
          // Re-fetch the new head, merge by word, and create a fresh child commit.
          // A protected branch or server hook may keep rejecting; retries are bounded.
        }
      } catch (error) {
        if (error.message?.startsWith("The selected branch") || error.message?.startsWith("The remote vocabulary")) throw error;
        throw safeError(error);
      } finally {
        await workspace.cleanup?.();
      }
    }
    throw new Error("The Git server kept rejecting the update. Your local words were kept; sync will retry.");
  }

  const api = { FILE_PATH, parseRepositoryAddress, validateBranch, createHttpClient, syncWithGit };
  root.CleverSubtitleGitSync = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
