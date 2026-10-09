(function (root) {
  "use strict";

  async function ensureServerAccess(permissions, origin) {
    const access = { origins: Array.isArray(origin) ? origin : [origin] };
    // Kiwi cannot display the optional-permission dialog. Its package grants
    // server access at installation, so do not invoke that dialog again.
    if (await permissions.contains(access)) return true;
    try {
      return await permissions.request(access);
    } catch (error) {
      if (/could not find an active window/i.test(error?.message || "")) {
        throw new Error("This browser could not show the server access prompt. Install the Kiwi ZIP, then try again.");
      }
      throw error;
    }
  }

  const api = { ensureServerAccess };
  root.CleverSubtitleSyncAccess = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
