// ==UserScript==
// @name Zentral main bootstrap compatibility entry
// @include chrome://browser/content/browser.xhtml
// @version 2.1.18
// ==/UserScript==
/*
 * ZENTRAL FILE GUIDE - JS/Zentral.uc.js
 * Purpose: Stable public adapter for Sine installations that cached this historical script path.
 * Loaded by: Sine's stale scripts registration; theme.json registers core/Zentral.uc.js.
 * Interaction: Resolves the install root relative to this file and loads core/Zentral.uc.js.
 * Ownership: No feature state; the canonical implementation owns initialization and cleanup.
 * Duplicate guard: An already loaded runtime/loader skips forwarding.
 * Keep this path stable during future internal reorganizations. Do not register both entries manually.
 */
(function () {
  "use strict";
  if (window.ZentralModuleLoader || window.ZentralRuntime) return;
  const Services = globalThis.Services || ChromeUtils.importESModule(
    "resource://gre/modules/Services.sys.mjs").Services;
  const root = Services.io.newURI("../", null,
    Services.io.newURI(Components.stack.filename)).spec;
  Services.scriptloader.loadSubScript(root + "core/Zentral.uc.js", window, "UTF-8");
})();
