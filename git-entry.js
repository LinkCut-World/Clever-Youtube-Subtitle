import {
  listServerRefs, clone, init, addRemote, resolveRef, readBlob, readTree,
  writeBlob, writeTree, commit, push, version
} from "isomorphic-git";
import LightningFS from "@isomorphic-git/lightning-fs";
import { Buffer } from "buffer";

globalThis.Buffer = Buffer;

// Only the background worker uses this disposable checkout. The durable word
// state stays in extension storage, including edits made while Git is offline.
const filesystem = new LightningFS();
globalThis.CleverSubtitleGitRuntime = {
  git: { listServerRefs, clone, init, addRemote, resolveRef, readBlob, readTree,
    writeBlob, writeTree, commit, push, version },
  async createWorkspace() {
    await filesystem.init("clever-subtitle-git-checkout", { wipe: true });
    await filesystem.promises.mkdir("/vocabulary");
    return { fs: filesystem, dir: "/vocabulary" };
  }
};
