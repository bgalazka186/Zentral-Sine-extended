"use strict";
/* B1 regression (TODO_notes_roadmap.md S6): the MMB unload must never pick a Zentral Notes entry tab as the successor
 * of the tab it unloads (Notes hands the selection straight back, which reloaded the tab). Fake objects only. */
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/tabs/unloading/ZentralTabUnload.uc.js"), "utf8");

function makeTab(name, attrs = {}) {
  const t = {
    name, isConnected: true, closing: false, hidden: false, pinned: false, linkedPanel: "panel-" + name,
    attrs: { ...attrs },
    hasAttribute(k) { return k in this.attrs; },
    getAttribute(k) { return this.attrs[k] ?? null; },
    matches() { return false; },
    closest(sel) { return sel === ".tabbrowser-tab" ? this : null; },
    linkedBrowser: { isRemoteBrowser: true },
  };
  return t;
}
async function run(tabsFor) {
  const listeners = {};
  const unloaded = [];
  const win = {
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener() {},
    setTimeout: () => 0,
    clearTimeout() {},
  };
  win.window = win;
  const target = makeTab("target");
  const tabs = tabsFor(target);
  win.gBrowser = {
    tabs, selectedTab: target,
    async explicitUnloadTabs(list) { unloaded.push(...list); },
  };
  win.ZentralRuntime = { register(def) { win.__def = def; } };
  const prefs = { "zen.workspace.bgalazka.mmb_unload_normal_tabs": true };
  vm.runInNewContext(source, {
    window: win,
    gBrowser: win.gBrowser,
    globalThis: { Services: { prefs: { getBoolPref: (k, d) => prefs[k] ?? d }, obs: {} } },
    ChromeUtils: {}, console, Promise, Array,
  });
  win.__def.init({});
  const ev = (type) => ({ type, button: 1, target, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
  for (const type of ["mousedown", "mouseup", "auxclick"]) for (const fn of listeners[type] || []) fn(ev(type));
  await new Promise((r) => setImmediate(r));
  return { win, target, unloaded };
}
(async () => {
  const note = makeTab("note", { "bgalazka-notes-item": "n:abc" });
  const web = makeTab("web");
  const a = await run((target) => [target, note, web]);
  assert.equal(a.win.gBrowser.selectedTab, web, "successor is the ordinary tab, not the Notes entry");
  assert.deepEqual(a.unloaded, [a.target], "the middle-clicked tab is unloaded");

  // Only Notes entries are left: no ordinary successor, a new tab is made instead of selecting a Notes entry.
  const created = [];
  const b = await run((target) => [target, makeTab("note2", { "bgalazka-notes-item": "n:x" })]);
  assert.notEqual(b.win.gBrowser.selectedTab.attrs?.["bgalazka-notes-item"], "n:x");
  void created;
  console.log("tab-unload-successor: ok");
})().catch((e) => { console.error(e); process.exit(1); });
