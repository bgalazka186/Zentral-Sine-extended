// ==UserScript==
// @name Zentral modular entrypoint
// @include chrome://browser/content/browser.xhtml
// @version 2.1.18
// ==/UserScript==
/*
 * ZENTRAL FILE GUIDE - core/Zentral.uc.js
 *
 * Purpose: Canonical bootstrap. Resolves the install root from the executing script, creates the
 *   privileged source/resource loader, caches registrations and reads, and opens bootstrap diagnostics.
 * Interaction / execution: Loads core/ZentralRuntime.js immediately; all other installed scripts are loaded
 *   by that runtime or their feature controller. Never register every .uc.js file with Sine.
 * Ownership / failure: Loader owns per-window caches and bootstrap event handlers; runtime destruction
 *   delegates to loader.destroy(). No folder name is hard-coded.
 * Loaded/created by: theme.json (canonical Sine entry); JS/Zentral.uc.js forwards stale registrations
 * Direct local resource paths: core/ZentralRuntime.js
 * Literal DOM event subscriptions: click; keydown; unload
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  if (window.ZentralModuleLoader || window.ZentralRuntime) return;
  const Services = globalThis.Services || ChromeUtils.importESModule(
    "resource://gre/modules/Services.sys.mjs").Services;
  const rootURI = Services.io.newURI("../", null,
    Services.io.newURI(Components.stack.filename)).spec;
  const definitions = new Map(), files = new Map(), textCache = new Map(), sourceById = new Map();
  let loadingSource = null, destroyed = false, netUtil = null;
  const safePath = path => /^(?:JS|CSS|settings|core|features)\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*(?:\.uc|\.sys)?\.(?:js|mjs|css|json)$/.test(path);
  const loader = window.ZentralModuleLoader = {
    rootURI,
    define(id, factory) {
      if (definitions.has(id)) throw new Error("Duplicate component: " + id);
      definitions.set(id, factory);
      sourceById.set(id, loadingSource);
    },
    load(path, { optional = false, owner = "core" } = {}) {
      if (!safePath(path) || (!/^(?:JS|core|features)\//.test(path) || !/\.(?:js|mjs)$/.test(path))) throw new Error("Unsafe module path: " + path);
      const existing = files.get(path);
      if (existing?.state === "loaded") return true;
      if (existing?.state === "failed") {
        if (optional) return false;
        throw new Error("Required source unavailable: " + path + ": " + existing.error);
      }
      const row = { file: path, owner, phase: "load", state: "loading" };
      files.set(path, row);
      const previousSource = loadingSource;
      loadingSource = path;
      try {
        Services.scriptloader.loadSubScript(rootURI + path, window, "UTF-8");
        row.state = "loaded";
        return true;
      } catch (error) {
        row.state = "failed"; row.error = String(error) + (error?.stack ? "\n" + error.stack : "");
        console.error("[Zentral source]", path, error);
        window.dispatchEvent(new CustomEvent("zentral-runtime-change"));
        if (!optional) throw error;
        return false;
      } finally { loadingSource = previousSource; }
    },
    readText(path, owner = "core") {
      if (!safePath(path)) throw new Error("Unsafe resource path: " + path);
      if (textCache.has(path)) return textCache.get(path);
      const existing = files.get(path);
      if (existing?.state === "failed")
        throw new Error("Resource unavailable: " + path + ": " + existing.error);
      const row = { file: path, owner, phase: "resource", state: "loading" };
      files.set(path, row);
      try {
        // Read installed chrome resources with a privileged channel. Window XHR
        // can reject synchronous chrome:// requests even when loadSubScript works.
        netUtil ||= ChromeUtils.importESModule("resource://gre/modules/NetUtil.sys.mjs").NetUtil;
        const channel = netUtil.newChannel({
          uri: Services.io.newURI(rootURI + path),
          loadUsingSystemPrincipal: true,
        });
        let input = null, converter = null;
        const chunks = [];
        try {
          input = channel.open();
          converter = Components.classes["@mozilla.org/intl/converter-input-stream;1"]
            .createInstance(Components.interfaces.nsIConverterInputStream);
          converter.init(input, "UTF-8", 4096, 0);
          const chunk = {};
          while (converter.readString(4096, chunk)) chunks.push(chunk.value);
        } finally {
          try { converter?.close(); } catch (_) {}
          try { input?.close(); } catch (_) {}
        }
        const text = chunks.join("");
        if (!text) throw new Error("Empty resource: " + path);
        textCache.set(path, text); row.state = "loaded";
        return text;
      } catch (error) {
        row.state = "failed"; row.error = String(error) + (error?.stack ? "\n" + error.stack : "");
        console.error("[Zentral source]", path, error);
        throw error;
      }
    },
    fail(path, error, phase = "resource") {
      const row = files.get(path);
      if (row) Object.assign(row, { state: "failed", phase, error: String(error) + (error?.stack ? "\n" + error.stack : "") });
    },
    create(id, args, { optional = false } = {}) {
      const file = sourceById.get(id);
      try { return this.require(id)(args); }
      catch (error) {
        const row = file && files.get(file);
        if (row) { row.state = "failed"; row.phase = "factory"; row.component = id; row.error = String(error) + (error?.stack ? "\n" + error.stack : ""); }
        console.error("[Zentral component]", file || id, error);
        if (!optional) throw error;
        return null;
      }
    },
    require(id) {
      if (!definitions.has(id)) throw new Error("Component did not register: " + id);
      return definitions.get(id);
    },
    has: id => definitions.has(id) && files.get(sourceById.get(id))?.state !== "failed",
    sources: () => [...files.values()].map(row => ({ ...row })),
    report() {
      return { sources: this.sources(), runtime: window.ZentralRuntime?.snapshot?.() || null };
    },
    showDiagnostics() {
      let box = document.getElementById("zentral-bootstrap-diagnostics");
      if (box) { box.remove(); return; }
      box = document.createElement("pre"); box.id = "zentral-bootstrap-diagnostics";
      box.style.cssText = "position:fixed;inset:8%;overflow:auto;z-index:2147483647;padding:20px;background:#171923;color:#f3f4f6;white-space:pre-wrap;border:1px solid #64748b";
      box.textContent = "Zentral source diagnostics (click to close)\n\n" + JSON.stringify(this.report(), null, 2);
      box.addEventListener("click", () => box.remove(), { once: true });
      document.documentElement.append(box);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("unload", onUnload);
      document.getElementById("zentral-bootstrap-diagnostics")?.remove();
      definitions.clear(); files.clear(); textCache.clear(); sourceById.clear(); netUtil = null;
      if (window.ZentralModuleLoader === this) delete window.ZentralModuleLoader;
    }
  };
  const onKey = event => {
    if (event.ctrlKey && event.altKey && event.code === "Equal" && (!window.ZentralRuntime || loader.runtimeFailed || loader.diagnosticsOnly)) {
      event.preventDefault(); loader.showDiagnostics();
    }
  };
  window.addEventListener("keydown", onKey, true);
  const onUnload = () => loader.destroy();
  window.addEventListener("unload", onUnload, { once: true });
  try { loader.load("core/ZentralRuntime.js"); }
  catch (error) { loader.runtimeFailed = true; console.error("[Zentral] Runtime unavailable; Ctrl+Alt+= opens source diagnostics", error); }
})();
