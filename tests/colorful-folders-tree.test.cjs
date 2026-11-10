"use strict";
/* Native folder accent-line interactions, style switches and whole-tree coloring. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const makeFakeDom = require("./helpers/fake-dom.cjs");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "additional/folders/ZentralColorfulFolders.uc.js"), "utf8");
let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function boot({ rtl = false } = {}) {
  const dom = makeFakeDom();
  const { El, document } = dom;
  const store = new Map();
  const observers = [];
  const prefs = {
    getStringPref: (k, d = "") => (store.has(k) ? String(store.get(k)) : d),
    getBoolPref: (k, d = false) => (store.has(k) ? !!store.get(k) : d),
    getIntPref: (k, d = 0) => (store.has(k) ? store.get(k) : d),
    setStringPref: (k, v) => { store.set(k, String(v)); fire(k); },
    setBoolPref: (k, v) => { store.set(k, !!v); fire(k); },
    setIntPref: (k, v) => { store.set(k, v); fire(k); },
    getPrefType: (k) => (store.has(k) ? 32 : 0),
  };
  const fire = (name) => { for (const o of observers) if (name.startsWith(o.prefix)) o.fn(null, "nsPref:changed", name); };
  let registration;
  const timers = [];
  const win = {
    document, console, Event: class { constructor(type) { this.type = type; } },
    dispatchEvent() {}, addEventListener() {}, removeEventListener() {},
    innerWidth: 1200, innerHeight: 800, crypto: require("node:crypto").webcrypto,
    getComputedStyle: () => ({ direction: rtl ? "rtl" : "ltr" }),
    ZentralRuntime: { register(def) { registration = def; } },
  };
  win.window = win; win.globalThis = { Services: { prefs } };
  vm.runInNewContext(source, { ...win, window: win, globalThis: win.globalThis, ChromeUtils: {}, TextEncoder, Uint8Array, Uint32Array, DataView, Object, Array, String, Number, Math, JSON, Date, Set, Map, RegExp, Error, TypeError, WeakMap, Promise, Symbol, MutationObserver: undefined, console });
  const lifecycle = {
    active: true, owned: [],
    own(fn) { this.owned.push(fn); },
    listen(target, type, fn, options) {
      (this.listeners ||= []).push({ target, type, fn, options });
      target?.addEventListener?.(type, fn, options);
      this.own(() => target?.removeEventListener?.(type, fn, options));
    },
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {},
    preference(prefix, fn) { observers.push({ prefix, fn }); },
  };
  document.createXULElement = (t) => new El(t);
  document.documentElement.setAttribute("zen-sidebar-expanded", "true");
  // sidebar: pinned section > outer folder > (label, container > [tab, inner folder > (label, container > [tab, tab])])
  const mk = (tag, cls = "", attrs = {}) => { const e = new El(tag); if (cls) e.className = cls; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const tabbar = mk("vbox", "", { id: "tabbrowser-tabs" });
  document.body.append(tabbar);
  let y = 0;
  const place = (el, left, height) => { const top = y; y += height; el.getBoundingClientRect = () => ({ left, top, right: left + 180, bottom: top + height, width: 180, height }); };
  const tab = (left) => { const t = mk("tab"); const stack = mk("stack", "tab-stack"); t.append(stack); place(stack, left, 30); return t; };
  const folder = (id, label) => { const f = mk("zen-folder", "", { id, label }); f.style.getPropertyPriority = (k) => (f.style.getPropertyValue(k) ? "important" : ""); /* the shared fake style lacks priorities */ const l = mk("hbox", "tab-group-label-container"); const c = mk("div", "tab-group-container"); const line = mk("div", "tab-group-line"); c.append(line); f.append(l, c); return { f, l, c, line }; };
  const outer = folder("outer", "Outer"), inner = folder("inner", "Inner");
  tabbar.append(outer.f);
  place(outer.l, 10, 30);
  const t1 = tab(50); outer.c.append(t1);
  outer.c.append(inner.f);
  place(inner.l, 50, 30);
  const t2 = tab(72), t3 = tab(72); inner.c.append(t2, t3);
  outer.c.getBoundingClientRect = () => ({ left: 22, top: 30, right: 220, bottom: 150, width: 198, height: 120 });
  inner.c.getBoundingClientRect = () => ({ left: 58, top: 90, right: 220, bottom: 150, width: 162, height: 60 });
  if (rtl) {
    const rect = (left, top, width = 180, height = 30) => ({ left, top, right: left + width, bottom: top + height, width, height });
    // In RTL the colored label is aligned to the group's right edge, and child rows
    // extend back toward the left. Keep the fixture mirrored rather than reusing LTR x's.
    outer.l.getBoundingClientRect = () => rect(20, 0);
    inner.l.getBoundingClientRect = () => rect(40, 60);
    outer.c.children[1].querySelector(".tab-stack").getBoundingClientRect = () => rect(12, 30);
    inner.c.children[1].querySelector(".tab-stack").getBoundingClientRect = () => rect(6, 90);
    inner.c.children[2].querySelector(".tab-stack").getBoundingClientRect = () => rect(6, 120);
  }
  const started = registration.init({ lifecycle, runtime: undefined });
  return { dom, store, prefs, fire, lifecycle, timers, outer, inner, tabbar, document, win, observers, started };
}
const flush = (ctx) => { for (let i = 0; i < 8 && ctx.timers.length; i++) { const batch = ctx.timers.splice(0); for (const fn of batch) fn(); } };

const KEY = (n) => "zen.workspace.zentral.folder_colors." + n;
const HOT = "bgalazka-fc-line-hot";
const send = (ctx, type, target, clientX, clientY = 100, button = 0) => {
  const event = new ctx.dom.Ev(type, { target, clientX, clientY, button, bubbles: true });
  target.dispatchEvent(event);
  return event;
};

test("the accent line reuses the native 2px inset and group-line styling without synthetic tree nodes", () => {
  const ctx = boot();
  flush(ctx);
  const beforeOuter = ctx.outer.c.children.length;
  const beforeInner = ctx.inner.c.children.length;
  ctx.prefs.setStringPref(KEY("default_base"), "#3366cc");
  flush(ctx);
  assert.equal(ctx.outer.c.children.length, beforeOuter, "painting does not inject anything into the native folder container");
  assert.equal(ctx.inner.c.children.length, beforeInner, "nested folders keep their native child structure");
  assert.equal(ctx.outer.c.children.some((node) => node.classList.contains("zcf-tree-connector")), false);
  assert.equal(ctx.outer.f.hasAttribute("bgalazka-fc-connector"), false);
  assert.match(source, /box-shadow:\s*inset 2px 0 0 0 var\(--bgalazka-fc-accent\)/);
  assert.match(source, /\.tab-group-line[\s\S]{0,180}background-color: var\(--bgalazka-fc-accent\)/);
  assert.doesNotMatch(source, /zcf-tree-connector|zcf-connector-visible|zcf-connector-hit|CONNECTOR_BRANCH_RADIUS|createElementNS\(["']http:\/\/www\.w3\.org\/2000\/svg/);
});

test("clicking the inset accent hit strip collapses only the folder that owns that container", () => {
  const ctx = boot();
  ctx.prefs.setStringPref(KEY("default_base"), "#3366cc");
  flush(ctx);
  const event = send(ctx, "click", ctx.inner.c.children[2], 60);
  assert.equal(ctx.inner.f.collapsed, true, "the nested folder uses its native collapsed setter");
  assert.equal(ctx.outer.f.collapsed, undefined, "the parent folder is untouched");
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.stopped, true);
  send(ctx, "click", ctx.inner.c.children[2], 60);
  assert.equal(ctx.inner.f.collapsed, false, "a second click expands it again");
});

test("the hit strip does not swallow nearby content clicks or right clicks", () => {
  const ctx = boot();
  ctx.prefs.setStringPref(KEY("default_base"), "#3366cc");
  flush(ctx);
  const outside = send(ctx, "click", ctx.inner.c.children[2], 90);
  assert.equal(ctx.inner.f.collapsed, undefined, "a click outside the narrow accent gutter is ordinary content interaction");
  assert.equal(outside.defaultPrevented, false);
  send(ctx, "click", ctx.inner.c.children[2], 60, 100, 2);
  assert.equal(ctx.inner.f.collapsed, undefined, "context-menu/right-click remains native");
});

test("the native tab-group-line itself is also clickable and resolves to its closest folder", () => {
  const ctx = boot();
  ctx.prefs.setStringPref(KEY("default_base"), "#3366cc");
  flush(ctx);
  send(ctx, "click", ctx.inner.line, 100);
  assert.equal(ctx.inner.f.collapsed, true);
  assert.equal(ctx.outer.f.collapsed, undefined);
});

test("line click respects the Behavior and Accent switches", () => {
  const ctx = boot();
  ctx.prefs.setStringPref(KEY("default_base"), "#3366cc");
  flush(ctx);
  ctx.prefs.setBoolPref(KEY("line_click"), false);
  const line = send(ctx, "click", ctx.inner.c.children[2], 60);
  assert.equal(ctx.inner.f.collapsed, undefined);
  assert.equal(line.defaultPrevented, false);
  ctx.prefs.setBoolPref(KEY("line_click"), true);
  ctx.prefs.setBoolPref(KEY("style_accent"), false);
  send(ctx, "click", ctx.inner.c.children[2], 60);
  assert.equal(ctx.inner.f.collapsed, undefined, "the interaction cannot remain when its accent layer is off");
});

test("hover highlights only the hovered folder's native line and clears as the pointer leaves", () => {
  const ctx = boot();
  ctx.prefs.setStringPref(KEY("default_base"), "#3366cc");
  flush(ctx);
  send(ctx, "pointermove", ctx.inner.c.children[2], 60);
  assert.equal(ctx.inner.f.getAttribute(HOT), "true");
  assert.equal(ctx.outer.f.hasAttribute(HOT), false, "the nested folder gets its own highlight");
  send(ctx, "pointermove", ctx.inner.c.children[2], 90);
  assert.equal(ctx.inner.f.hasAttribute(HOT), false, "moving off the stripe removes the highlight");
  send(ctx, "pointermove", ctx.inner.line, 100);
  assert.equal(ctx.inner.f.getAttribute(HOT), "true", "the native group-line is highlighted too");
  ctx.prefs.setBoolPref(KEY("line_hover"), false);
  send(ctx, "pointermove", ctx.inner.line, 100);
  assert.equal(ctx.inner.f.hasAttribute(HOT), false, "the hover switch clears and disables the highlight");
});

test("the hover treatment overrides the important base accent and is visually distinct", () => {
  const hotRule = source.match(/:root\[bgalazka-fc-line-hover\] zen-folder\[\$\{LAYERS_ATTR\}~="accent"\]\[\$\{LINE_HOT_ATTR\}\] > \.tab-group-container \{([\s\S]*?)\}/);
  assert.ok(hotRule, "a dedicated hot-state rule targets only the active folder's accent container");
  assert.match(hotRule[1], /inset 4px 0 0 0 var\(--bgalazka-fc-accent\)/, "hover widens the stripe from 2px to 4px");
  assert.match(hotRule[1], /inset 8px 0 8px -5px var\(--bgalazka-fc-accent\)/, "hover adds a visible inner glow");
  assert.match(hotRule[1], /box-shadow:[\s\S]*!important/, "hover wins over the important base box-shadow");
  assert.match(hotRule[1], /cursor:\s*pointer\s*!important/, "the clickable stripe advertises its action");
  assert.match(source, /filter:\s*brightness\(1\.55\) saturate\(1\.35\) drop-shadow\(0 0 2px var\(--bgalazka-fc-accent\)\)\s*!important/);
});

test("accent hit testing mirrors to the right edge in RTL sidebars", () => {
  const ctx = boot({ rtl: true });
  ctx.prefs.setStringPref(KEY("default_base"), "#3366cc");
  flush(ctx);
  send(ctx, "click", ctx.inner.c.children[2], 218);
  assert.equal(ctx.inner.f.collapsed, true, "RTL hit testing uses the container's inline-start edge");
});

test("style switches become root flags and unload removes everything", () => {
  const ctx = boot();
  const root = ctx.document.documentElement;
  flush(ctx);
  for (const flag of ["bgalazka-fc-no-accent", "bgalazka-fc-no-tint-header", "bgalazka-fc-no-tint-tabs", "bgalazka-fc-no-hover"]) assert.equal(root.hasAttribute(flag), false, flag + " is off by default");
  assert.equal(root.hasAttribute("bgalazka-fc-line-click"), true);
  assert.equal(root.hasAttribute("bgalazka-fc-line-hover"), true);
  ctx.prefs.setBoolPref(KEY("style_tint_header"), false);
  ctx.prefs.setBoolPref(KEY("style_hover"), false);
  ctx.prefs.setBoolPref(KEY("line_hover"), false);
  assert.equal(root.hasAttribute("bgalazka-fc-no-tint-header"), true);
  assert.equal(root.hasAttribute("bgalazka-fc-no-hover"), true);
  assert.equal(root.hasAttribute("bgalazka-fc-line-hover"), false);
  assert.equal(root.hasAttribute("bgalazka-fc-no-accent"), false);
  for (const fn of ctx.lifecycle.owned.slice().reverse()) fn();
  assert.equal(root.hasAttribute("bgalazka-fc-no-hover"), false);
  assert.equal(root.hasAttribute("bgalazka-fc-line-click"), false);
});

test("style switches remove only their own Zen properties from a painted folder", () => {
  const ctx = boot();
  const key = (n) => "zen.workspace.zentral.folder_colors." + n;
  ctx.prefs.setStringPref(key("default_base"), "#3366cc");
  flush(ctx);
  const has = (p) => ctx.outer.f.style.getPropertyValue(p) !== "";
  assert.ok(has("--zen-folder-behind-bgcolor") && has("--tab-group-color-pale") && has("--tab-group-background-color-hover"));
  ctx.prefs.setBoolPref(key("style_icon"), false); flush(ctx);
  assert.ok(!has("--zen-folder-behind-bgcolor") && !has("--zen-folder-stroke"));
  assert.ok(has("--tab-group-color-pale") && has("--bgalazka-fc-accent"), "tint and our own accent value stay");
  ctx.prefs.setBoolPref(key("style_hover"), false); flush(ctx);
  assert.ok(!has("--tab-group-background-color-hover"));
  ctx.prefs.setBoolPref(key("style_tint_header"), false); flush(ctx);
  assert.ok(has("--tab-group-color-pale"), "one tint switch alone keeps Zen's tint variable");
  ctx.prefs.setBoolPref(key("style_tint_tabs"), false); flush(ctx);
  assert.ok(!has("--tab-group-color-pale"));
  ctx.prefs.setBoolPref(key("style_accent"), false); flush(ctx);
  assert.ok(!has("--tab-group-color") && !has("--tab-group-text-color"));
  ctx.prefs.setBoolPref(key("style_icon"), true); flush(ctx);
  assert.ok(has("--zen-folder-behind-bgcolor"), "switching back on restores it");
});

const key = (n) => "zen.workspace.zentral.folder_colors." + n;
function openMenu(ctx, folder) {
  const popup = new ctx.dom.El("menupopup"); popup.setAttribute("id", "zenFolderActions"); popup.triggerNode = folder;
  ctx.lifecycle.listeners.filter((l) => l.type === "popupshowing").forEach((l) => l.fn({ target: popup, originalTarget: folder }));
  const find = (label) => popup.all().find((e) => e.getAttribute("label") === label);
  return { popup, find, command: (label) => { const item = find(label); assert.ok(item, "menu item " + label); item.listeners.filter((l) => l.type === "command").forEach((l) => l.fn({})); } };
}
const settle = async (ctx) => { for (let i = 0; i < 6; i++) { await new Promise((r) => setImmediate(r)); flush(ctx); } };
const recordCount = (ctx) => JSON.parse(ctx.store.get(key("data")) || '{"r":[]}').r.length;

test("a palette can be applied to a folder and all of its subfolders from the right-click menu", async () => {
  const ctx = boot();
  flush(ctx);
  ctx.outer.f.setAttribute("id", "folder-outer"); ctx.inner.f.setAttribute("id", "folder-inner");
  const menu = openMenu(ctx, ctx.outer.f);
  assert.ok(menu.find("Whole tree (this folder + subfolders)"), "folders with subfolders get the whole-tree submenu");
  const lone = openMenu(ctx, ctx.inner.f);
  assert.equal(lone.find("Whole tree (this folder + subfolders)"), undefined, "a folder without subfolders does not");
  const palette = menu.popup.all().find((e) => e.getAttribute("label") === "Apply a palette to folder and subfolders");
  const swatch = palette.all().find((e) => e.getAttribute("label") === "Mint");
  swatch.listeners.filter((l) => l.type === "command").forEach((l) => l.fn({}));
  await settle(ctx);
  assert.equal(recordCount(ctx), 2, "outer and inner each got their own record");
  assert.ok(ctx.outer.f.style.getPropertyValue("--bgalazka-fc-accent"));
  assert.equal(ctx.outer.f.style.getPropertyValue("--bgalazka-fc-accent"), ctx.inner.f.style.getPropertyValue("--bgalazka-fc-accent"), "same base color all through the tree");
});

test("a collection is spread by depth inside the tree: folder = first look, subfolder = second", async () => {
  const ctx = boot();
  flush(ctx);
  ctx.outer.f.setAttribute("id", "folder-outer"); ctx.inner.f.setAttribute("id", "folder-inner");
  const menu = openMenu(ctx, ctx.outer.f);
  const spread = menu.popup.all().find((e) => e.getAttribute("label") === "Spread a collection over this tree");
  spread.all().find((e) => e.getAttribute("label") === "Colorful").listeners.filter((l) => l.type === "command").forEach((l) => l.fn({}));
  await settle(ctx);
  const outerColor = ctx.outer.f.style.getPropertyValue("--bgalazka-fc-accent");
  const innerColor = ctx.inner.f.style.getPropertyValue("--bgalazka-fc-accent");
  assert.ok(outerColor && innerColor && outerColor !== innerColor, "different looks per depth");
});

test("copying a folder's own colors to its subfolders leaves the folder itself untouched", async () => {
  const ctx = boot();
  flush(ctx);
  ctx.outer.f.setAttribute("id", "folder-outer"); ctx.inner.f.setAttribute("id", "folder-inner");
  let menu = openMenu(ctx, ctx.outer.f);
  const copyLabel = "Copy this folder's colors to all subfolders";
  assert.equal(menu.find(copyLabel).getAttribute("disabled"), "true", "nothing to copy while the folder has no colors of its own");
  const palette = menu.popup.all().find((e) => e.getAttribute("label") === "Apply a palette to folder and subfolders");
  palette.all().find((e) => e.getAttribute("label") === "Lavender").listeners.filter((l) => l.type === "command").forEach((l) => l.fn({}));
  await settle(ctx);
  // restyle only the outer folder, then copy that to the subfolders
  ctx.inner.f.setAttribute("bgalazka-test-marker", "x");
  menu = openMenu(ctx, ctx.outer.f);
  assert.equal(menu.find(copyLabel).hasAttribute("disabled"), false);
  const before = recordCount(ctx);
  menu.command(copyLabel);
  await settle(ctx);
  assert.equal(recordCount(ctx), before, "the same two records, no folder lost or duplicated");
});

test("the detailed folder style has seven color layers and no duplicate connector layer", () => {
  const seam = (() => {
    const dom = makeFakeDom();
    const store = new Map();
    const prefs = { getStringPref: (k, d = "") => store.has(k) ? store.get(k) : d, getBoolPref: (_k, d = false) => d, getIntPref: (_k, d = 0) => d, getPrefType: () => 0 };
    const win = { document: dom.document, console, Event: class { constructor(type) { this.type = type; } }, dispatchEvent() {}, addEventListener() {}, removeEventListener() {}, innerWidth: 1200, innerHeight: 800, crypto: require("node:crypto").webcrypto, getComputedStyle: () => ({ direction: "ltr" }), ZentralRuntime: { register() {} } };
    win.window = win; win.globalThis = { Services: { prefs } };
    vm.runInNewContext(source, { ...win, window: win, globalThis: win.globalThis, ChromeUtils: {}, TextEncoder, Uint8Array, Uint32Array, DataView, Object, Array, String, Number, Math, JSON, Date, Set, Map, RegExp, Error, TypeError, WeakMap, Promise, Symbol, MutationObserver: undefined, console });
    return win.__zentralColorfulFoldersTestSeam.PARTS;
  })();
  assert.deepEqual(Array.from(seam), ["back", "front", "stroke", "label", "accent", "tint", "hover"]);
  assert.doesNotMatch(source, /default_connector|--bgalazka-fc-connector|PART_LABELS[^;]*connector/);
});

test("the editor is twice as wide and its opacity slider has room", () => {
  assert.match(source, /\.zcf-panel \{[^}]*width: 760px/);
  assert.match(source, /placePanel\(rect, Math\.min\(760, width - 16\)/);
  assert.match(source, /\.zcf-opacity \{[^}]*min-width:240px/);
});

(async () => {
for (const [name, fn] of tests) {
  try { await fn(); passed++; console.log("ok - " + name); }
  catch (error) { console.log("FAIL - " + name); console.log(error && error.stack || error); process.exitCode = 1; }
}
console.log(`\n${passed}/${tests.length} Colorful Folders tree tests passed`);
})();
