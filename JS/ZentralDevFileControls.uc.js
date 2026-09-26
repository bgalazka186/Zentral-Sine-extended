"use strict";
// Developer-only file experiments. Sine reads mods.json on startup; CSS
// fragments are imported by CSS/chrome.css. Neither change hot-unloads code.
(function () {
  const sources = (window.ZentralFeatureSources ||= Object.create(null));
  const WINDOW_URL = "chrome://browser/content/browser.xhtml";
  const SCRIPT_FILES = Object.freeze([
    "zentral_logger.uc.js", "ZentralApps.uc.js", "ZentralTabGroups.uc.js",
    "ZentralSettings.uc.js", "Zentral.uc.js", "ZentralPanelGeometry.uc.js",
    "ZentralTileIsolation.uc.js", "ZentralCornerPanels.uc.js",
    "ZentralRssDisplay.uc.js", "ZentralSecondaryViews.uc.js",
    "ZentralWebToolbar.uc.js", "ZentralExtensionSettings.uc.js",
    "ZentralDevFileControls.uc.js", "ZentralBrowserIntegrations.uc.js",
    "ZentralPanelStyleBridge.uc.js", "BgalazkaExtension.uc.js",
    "ZentralVideoPreview.uc.js",
  ]);
  const CSS_FILES = Object.freeze([
    "ZentralBase.css", "ZentralPanelLayout.css", "ZentralCornerPanels.css",
    "ZentralControls.css", "ZentralWebToolbar.css", "ZentralPanelResize.css",
    "ZentralSettings.css", "ZentralIntegration.css",
    "ZentralVideoPreview.css", "ZentralLook.css",
    "ZentralRssDisplay.css", "ZentralTabDensity.css",
    "ZentralPanelBlack.css",
  ]);
  // These source modules are still eager dependencies of the extension's
  // bootstrap. Excluding one prevents the settings controller from starting.
  // Keep the Developer page reachable so experiments can be undone in-app.
  const LOCKED_SCRIPTS = new Set([
    "ZentralApps.uc.js", "ZentralTabGroups.uc.js", "ZentralSettings.uc.js",
    "Zentral.uc.js", "ZentralPanelGeometry.uc.js",
    "ZentralCornerPanels.uc.js", "ZentralWebToolbar.uc.js",
    "ZentralExtensionSettings.uc.js", "ZentralDevFileControls.uc.js",
    "ZentralBrowserIntegrations.uc.js", "ZentralPanelStyleBridge.uc.js",
    "BgalazkaExtension.uc.js",
  ]);
  let writeQueue = Promise.resolve();
  function queueWrite(operation) {
    const next = writeQueue.then(operation);
    writeQueue = next.catch(() => {});
    return next;
  }
  function sineUtils() {
    return ChromeUtils.importESModule(
      "chrome://userscripts/content/core/utils.sys.mjs",
    ).default;
  }
  function activeMod(mods) {
    const candidates = ["zentral", "zentral-sine-extended"].filter(
      (id) => mods[id]?.enabled && mods[id].scripts?.["JS/ZentralExtensionSettings.uc.js"],
    );
    if (candidates.length !== 1)
      throw new Error("Exactly one Zentral installation must be enabled to edit files here.");
    return candidates[0];
  }
  function cssPath(utils, id) {
    return PathUtils.join(utils.getModFolder(id), "CSS", "chrome.css");
  }
  function importLine(file) {
    return `@import url("${file}");`;
  }
  function disabledLine(file) {
    return `/* Zentral disabled: ${importLine(file)} */`;
  }
  sources.devFileControls = function createDevFileControls() {
    async function getState() {
      const utils = sineUtils();
      const mods = await utils.getMods();
      const id = activeMod(mods);
      const scripts = mods[id].scripts || {};
      const css = await IOUtils.readUTF8(cssPath(utils, id));
      return {
        id,
        scriptEnabled: Object.fromEntries(SCRIPT_FILES.map((file) => {
          const entry = scripts[`JS/${file}`];
          return [file, !!entry && !entry.exclude?.includes(WINDOW_URL)];
        })),
        cssEnabled: Object.fromEntries(CSS_FILES.map((file) => [
          file, css.split(/\r?\n/).some((line) => line.trim() === importLine(file)),
        ])),
      };
    }
    async function setScript(file, enabled) {
      if (!SCRIPT_FILES.includes(file) || LOCKED_SCRIPTS.has(file))
        throw new Error("This script is required for the Developer controls or extension startup.");
      return queueWrite(async () => {
        const utils = sineUtils();
        const mods = await utils.getMods();
        const id = activeMod(mods);
        const entry = mods[id].scripts?.[`JS/${file}`];
        if (!entry) throw new Error(`JS/${file} is absent from Sine metadata.`);
        const exclude = new Set(entry.exclude || []);
        if (enabled) exclude.delete(WINDOW_URL);
        else exclude.add(WINDOW_URL);
        entry.exclude = [...exclude];
        await IOUtils.writeJSON(utils.modsDataFile, mods);
      });
    }
    async function setCss(file, enabled) {
      if (!CSS_FILES.includes(file)) throw new Error("Unknown CSS fragment.");
      return queueWrite(async () => {
        const utils = sineUtils();
        const mods = await utils.getMods();
        const path = cssPath(utils, activeMod(mods));
        const contents = await IOUtils.readUTF8(path);
        const lines = contents.split(/\r?\n/);
        const active = importLine(file);
        const disabled = disabledLine(file);
        const index = lines.findIndex((line) =>
          line.trim() === active || line.trim() === disabled);
        if (index < 0) throw new Error(`${file} has no managed import in CSS/chrome.css.`);
        lines[index] = enabled ? active : disabled;
        await IOUtils.writeUTF8(path, lines.join("\n"));
      });
    }
    return { getState, setScript, setCss, lockedScripts: LOCKED_SCRIPTS,
      cssFiles: CSS_FILES };
  };
})();
