"use strict";
/* B1 regression (TODO_notes_roadmap.md S6): the MMB unload must never pick a Zentral Notes entry tab as the successor
 * of the tab it unloads (Notes hands the selection straight back, which reloaded the tab). Fake objects only. */
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/tabs/unloading/ZentralTabUnload.uc.js"), "utf8");

function makeTab(name, attrs = {}, url = "https://example.test/") {
  const t = {
    name, isConnected: true, closing: false, hidden: false, pinned: false, linkedPanel: "panel-" + name,
    attrs: { ...attrs },
    hasAttribute(k) { return k in this.attrs; },
    getAttribute(k) { return this.attrs[k] ?? null; },
    removeAttribute(k) { delete this.attrs[k]; },
    matches() { return false; },
    closest(sel) { return sel === ".tabbrowser-tab" ? this : null; },
    linkedBrowser: { isRemoteBrowser: true, currentURI: { spec: url } },
  };
  return t;
}
async function run(tabsFor, targetAttrs = {}, targetUrl = "https://target.test/", targetSessionState = null) {
  const listeners = {};
  const unloaded = [];
  const events = [];
  const win = {
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener() {},
    setTimeout: () => 0,
    clearTimeout() {},
    SessionStore: { getTabState(tab) { return JSON.stringify(tab.sessionState || {}); } },
  };
  win.window = win;
  const target = makeTab("target", targetAttrs, targetUrl);
  if (targetSessionState) target.sessionState = targetSessionState;
  const tabs = tabsFor(target);
  win.gBrowser = {
    tabs, selectedTab: target,
    addTrustedTab(url) { const t = makeTab("new", {}, url); tabs.push(t); return t; },
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
  const ev = (type) => {
    const event = { type, button: 1, target, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() {}, stopImmediatePropagation() {} };
    events.push(event); return event;
  };
  for (const type of ["mousedown", "mouseup", "auxclick"]) for (const fn of listeners[type] || []) fn(ev(type));
  await new Promise((r) => setImmediate(r));
  return { win, target, unloaded, events };
}
(async () => {
  const note = makeTab("note", { "bgalazka-notes-item": "n:abc" }, "about:blank#zn-note:abc");
  const web = makeTab("web");
  const a = await run((target) => [target, note, web]);
  assert.equal(a.win.gBrowser.selectedTab, web, "successor is the ordinary tab, not the Notes entry");
  assert.deepEqual(a.unloaded, [a.target], "the middle-clicked tab is unloaded");

  // Only Notes entries are left: no ordinary successor, a new tab is made instead of selecting a Notes entry.
  const created = [];
  const b = await run((target) => [target, makeTab("note2", { "bgalazka-notes-item": "n:x" }, "about:blank#zn-note:x")]);
  assert.notEqual(b.win.gBrowser.selectedTab.attrs?.["bgalazka-notes-item"], "n:x");
  void created;

  // Agenda entries are pinned placeholders too. They bounce TabSelect to the
  // previous ordinary tab, so the unload successor search must never choose one.
  const agenda = makeTab("agenda", { "bgalazka-notes-agenda-item": "item:abc" }, "about:blank#zn-agenda-item%3Aabc");
  agenda.pinned = true;
  const ordinary = makeTab("ordinary");
  const c = await run((target) => [target, agenda, ordinary]);
  assert.equal(c.win.gBrowser.selectedTab, ordinary, "an Agenda pseudo-tab is skipped in favor of a real ordinary successor");
  assert.deepEqual(c.unloaded, [c.target], "ordinary tabs remain unloadable while Agenda is enabled");

  // Restored Agenda placeholders can temporarily lack their marker; the exact
  // current pseudo URL is still excluded from successor selection.
  const markerless = makeTab("agenda-restored", {}, "about:blank#zn-agenda-item%3Arestored");
  const ordinary2 = makeTab("ordinary-2");
  const d = await run((target) => [target, markerless, ordinary2]);
  assert.equal(d.win.gBrowser.selectedTab, ordinary2, "markerless Agenda pseudo-URLs are not valid unload successors");
  assert.deepEqual(d.unloaded, [d.target]);

  // Explicit Agenda markers are also not eligible as the tab the user asks us
  // to unload, even if a restored tab is not pinned yet.
  const e = await run((target) => [target], { "bgalazka-notes-agenda-item": "item:abc" }, "about:blank");
  assert.deepEqual(e.unloaded, [], "Agenda pseudo-tabs are never treated as normal unload targets");
  assert.ok(e.events.every(event => !event.defaultPrevented), "the unload handler leaves Agenda pseudo-tab gestures to their owner");

  // A normal live URL wins over stale Notes/Agenda flags and remembered pseudo URLs.
  const f = await run((target) => [target], { "bgalazka-notes-agenda-item": "item:stale" }, "https://normal-agenda.test/");
  assert.deepEqual(f.unloaded, [f.target], "a reused normal tab with a stale Agenda marker remains unloadable");
  assert.equal(f.target.hasAttribute("bgalazka-notes-agenda-item"), false, "stale Agenda marker is cleared");
  const g = await run((target) => [target], { "bgalazka-notes-item": "n:stale" }, "https://normal-notes.test/");
  assert.deepEqual(g.unloaded, [g.target], "a reused normal tab with a stale Notes marker remains unloadable");
  assert.equal(g.target.hasAttribute("bgalazka-notes-item"), false, "stale Notes marker is cleared");

  // A normal successor that inherited an old Agenda marker is valid once its live URL is ordinary.
  const markedNormal = makeTab("marked-normal", { "bgalazka-notes-agenda-item": "item:old" }, "https://normal-successor.test/");
  const real = makeTab("real");
  const h = await run((target) => [target, markedNormal, real]);
  assert.equal(h.win.gBrowser.selectedTab, markedNormal, "stale markers do not disqualify a normal successor");
  assert.deepEqual(h.unloaded, [h.target]);
  assert.equal(markedNormal.hasAttribute("bgalazka-notes-agenda-item"), false);

  // A discarded normal tab has about:blank as its live URI, but the current
  // SessionStore entry is a normal URL. Stale pseudo markers must not protect it.
  const i = await run((target) => [target], { "bgalazka-notes-agenda-item": "item:stale" }, "about:blank",
    { index: 2, entries: [{ url: "about:blank#zn-agenda-item%3Aold" }, { url: "https://discarded-normal.test/" }] });
  assert.deepEqual(i.unloaded, [i.target], "the current SessionStore URL makes a discarded normal tab unloadable");
  assert.equal(i.target.hasAttribute("bgalazka-notes-agenda-item"), false, "discarded normal tab loses stale Agenda marker");

  // A genuine current pseudo URL in SessionStore remains protected even when
  // the live browser object currently reports about:blank.
  const j = await run((target) => [target], { "bgalazka-notes-agenda-item": "item:real" }, "about:blank",
    { index: 1, entries: [{ url: "about:blank#zn-agenda-item%3Areal" }] });
  assert.deepEqual(j.unloaded, [], "a discarded Agenda placeholder is not unloaded as an ordinary tab");
  console.log("tab-unload-successor: ok");
})().catch((e) => { console.error(e); process.exit(1); });
