(function (root) {
  "use strict";

  const model = root.CleverSubtitleSyncModel ||
    (typeof module !== "undefined" && module.exports ? require("./sync-model.js") : null);
  const FILE_PATH = "clever-subtitle-vocabulary.json.gz";

  function parseRepositoryAddress(value) {
    const input = String(value || "").trim();
    let repository;
    let token = "";
    if (/^https:\/\//i.test(input)) {
      let url;
      try { url = new URL(input); } catch { throw new Error("Enter a GitHub repository URL."); }
      if (url.hostname.toLowerCase() !== "github.com" || url.port || url.search || url.hash) {
        throw new Error("Enter a github.com repository URL.");
      }
      repository = url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
      token = decodeURIComponent(url.password || url.username);
    } else if (/^git@github\.com:/i.test(input)) {
      repository = input.replace(/^git@github\.com:/i, "").replace(/\.git$/i, "");
    } else {
      repository = input.replace(/\.git$/i, "");
    }
    if (!/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(repository) ||
        repository.endsWith(".") || repository.includes("..")) {
      throw new Error("Enter a GitHub repository URL like https://github.com/name/words.");
    }
    return { repository, token };
  }

  function toBase64(bytes) {
    let binary = "";
    for (let index = 0; index < bytes.length; index += 16384) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 16384));
    }
    return btoa(binary);
  }

  function fromBase64(value) {
    const binary = atob(String(value).replace(/\s/g, ""));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  async function encodeContent(value) {
    const compressed = new Blob([JSON.stringify(value)]).stream()
      .pipeThrough(new CompressionStream("gzip"));
    return toBase64(new Uint8Array(await new Response(compressed).arrayBuffer()));
  }

  async function decodeContent(value) {
    const decompressed = new Blob([fromBase64(value)]).stream()
      .pipeThrough(new DecompressionStream("gzip"));
    const text = await new Response(decompressed).text();
    return model.cleanState(JSON.parse(text));
  }

  async function request(fetcher, config, method, body) {
    const url = `https://api.github.com/repos/${config.repository}/contents/${FILE_PATH}`;
    const response = await fetcher(url, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      cache: "no-store",
      body: body && JSON.stringify(body)
    });
    if (response.status === 404 && method === "GET") return null;
    if (!response.ok) {
      // Do not include GitHub's response body or the URL: either may reveal credentials.
      const error = new Error(response.status === 401 ? "GitHub rejected the access token." :
        response.status === 403 ? "GitHub denied access or limited requests. Check the token and try later." :
        response.status === 404 ? "Repository not found, or the token cannot write to it." :
        `GitHub sync failed (HTTP ${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  async function ensurePrivateRepository(fetcher, config) {
    const response = await fetcher(`https://api.github.com/repos/${config.repository}`, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${config.token}`,
        "X-GitHub-Api-Version": "2022-11-28"
      },
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error(response.status === 404
        ? "Repository not found, or the token cannot access it."
        : `Could not check the private repository (HTTP ${response.status}).`);
    }
    const details = await response.json();
    if (details.private !== true) {
      throw new Error("This repository is public. Use a private repository for My Vocabulary.");
    }
  }

  async function syncWithGithub(fetcher, config, localState) {
    await ensurePrivateRepository(fetcher, config);
    for (let attempt = 0; attempt < 6; attempt++) {
      const current = await request(fetcher, config, "GET");
      let remote;
      try {
        remote = current ? await decodeContent(current.content) : model.emptyState();
      } catch {
        throw new Error("The GitHub vocabulary file is invalid. Your local words were kept.");
      }
      const merged = model.mergeStates(localState, remote);
      if (current && model.equalStates(merged, remote)) return merged;
      try {
        await request(fetcher, config, "PUT", {
          message: "Sync My Vocabulary",
          content: await encodeContent(merged),
          ...(current ? { sha: current.sha } : {})
        });
        return merged;
      } catch (error) {
        if (error.status !== 409 && error.status !== 422) throw error;
        if (error.status === 422) {
          const latest = await request(fetcher, config, "GET");
          if (latest?.sha === current?.sha) throw error;
        }
        // Another device wrote first. Read its version and merge again.
      }
    }
    throw new Error("GitHub was busy. Your local words were kept; sync will retry.");
  }

  const api = { FILE_PATH, parseRepositoryAddress, encodeContent, decodeContent, syncWithGithub };
  root.CleverSubtitleGithubSync = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
