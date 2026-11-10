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
  const mutationObservers = [];
  class FakeMutationObserver {
    constructor(callback) { this.callback = callback; this.target = null; this.options = null; this.disconnected = false; mutationObservers.push(this); }
    observe(target, options) { this.target = target; this.options = options; }
    disconnect() { this.disconnected = true; }
    trigger() { this.callback([], this); }
  }
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
    getComputedStyle: () => ({ direction: rtl ? "rtl" : "ltr", color: "rgb(255, 255, 255)" }),
    ZentralRuntime: { register(def) { registration = def; } },
  };
  win.window = win; win.globalThis = { Services: { prefs } };
  win.MutationObserver = FakeMutationObserver;
  vm.runInNewContext(source, { ...win, window: win, globalThis: win.globalThis, ChromeUtils: {}, TextEncoder, Uint8Array, Uint32Array, DataView, Object, Array, String, Number, Math, JSON, Date, Set, Map, RegExp, Error, TypeError, WeakMap, Promise, Symbol, MutationObserver: FakeMutationObserver, console });
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
  return { dom, store, prefs, fire, lifecycle, timers, outer, inner, tabbar, document, win, observers, mutationObservers, started };
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

test("classic Firefox mouse events also activate and clear the exact accent hit target", () => {
  const ctx = boot();
  ctx.prefs.setStringPref(KEY("default_base"), "#3366cc");
  flush(ctx);
  send(ctx, "mousemove", ctx.inner.c.children[2], 60);
  assert.equal(ctx.inner.f.getAttribute(HOT), "true");
  send(ctx, "mousemove", ctx.inner.c.children[2], 100);
  assert.equal(ctx.inner.f.hasAttribute(HOT), false);
  send(ctx, "mouseover", ctx.inner.line, 100);
  assert.equal(ctx.inner.f.getAttribute(HOT), "true");
});

test("hover changes only the native connector color and preserves its curved geometry", () => {
  const hotRule = source.match(/:root:not\(\[bgalazka-fc-no-accent\]\) zen-folder\[\$\{LAYERS_ATTR\}~="accent"\]\[\$\{LINE_HOT_ATTR\}\] > \.tab-group-container \{([\s\S]*?)\}/);
  assert.ok(hotRule, "a dedicated per-folder hot-state rule targets the active accent container");
  assert.match(hotRule[1], /inset 2px 0 0 0 var\(--bgalazka-fc-accent-hover, var\(--bgalazka-fc-accent\)\)/, "the original 2px spine only changes color");
  assert.doesNotMatch(hotRule[1], /inset 4px|inset 8px|background:/, "hover adds no widened stripe, glow or rectangular fill");
  assert.match(hotRule[1], /cursor:\s*pointer\s*!important/, "the clickable stripe advertises its action");
  assert.match(source, /\[\$\{LINE_HOT_ATTR\}\] \.tab-group-line \{\s*background-color: var\(--bgalazka-fc-accent-hover, var\(--bgalazka-fc-accent\)\) !important;/, "the native curved line changes to the derived hover color");
  assert.doesNotMatch(source, /filter:\s*brightness\(1\.7\)|drop-shadow\(0 0 3px var\(--bgalazka-fc-accent\)\)/, "no harsh brightness filter or glow remains");
  assert.doesNotMatch(source, /\[\$\{LINE_HOT_ATTR\}\] > \.tab-group-container::before \{[\s\S]*?background:/, "the transparent hit area never becomes a rectangle on hover");
});

test("hover accent is derived in the opposite brightness direction and preserves accent opacity", () => {
  const ctx = boot();
  ctx.prefs.setStringPref(KEY("default_base"), "#3366cc");
  flush(ctx);
  const darkAccentHover = ctx.outer.f.style.getPropertyValue("--bgalazka-fc-accent-hover");
  assert.equal(darkAccentHover, "#81a0df", "dark blue gets a lighter blue hover color");
  ctx.prefs.setStringPref(KEY("default_base"), "#f4e04d");
  flush(ctx);
  const brightAccentHover = ctx.outer.f.style.getPropertyValue("--bgalazka-fc-accent-hover");
  assert.equal(brightAccentHover, "#b0a137", "bright yellow gets a darker yellow hover color");
  ctx.prefs.setStringPref(KEY("default_base"), "#3366cc");
  ctx.prefs.setIntPref(KEY("default_accent_opacity"), 45);
  flush(ctx);
  assert.equal(ctx.outer.f.style.getPropertyValue("--bgalazka-fc-accent-hover"), "color-mix(in srgb, #81a0df 45%, transparent)", "the hover shade preserves the user's accent opacity");
});

test("hover and click delegation is attached to the document root, not a replaceable tab-tree wrapper", () => {
  const ctx = boot();
  ctx.prefs.setStringPref(KEY("default_base"), "#3366cc");
  flush(ctx);
  const delegated = ctx.lifecycle.listeners.filter((item) => ["click", "mouseover", "mousemove", "pointerover", "pointermove"].includes(item.type));
  assert.ok(delegated.length >= 5);
  assert.ok(delegated.every((item) => item.target === ctx.document.documentElement), "events survive Zen moving pinned folders between workspace containers");
  send(ctx, "pointermove", ctx.inner.c.children[2], 60);
  assert.equal(ctx.inner.f.getAttribute(HOT), "true");
});

test("a native group line works when Zen places it beside, rather than inside, the content container", () => {
  const ctx = boot();
  ctx.prefs.setStringPref(KEY("default_base"), "#3366cc");
  flush(ctx);
  const nativeLine = new ctx.dom.El("div");
  nativeLine.classList.add("tab-group-line");
  ctx.inner.f.append(nativeLine);
  send(ctx, "pointermove", nativeLine, 180);
  assert.equal(ctx.inner.f.getAttribute(HOT), "true", "the native sibling line highlights its owning folder");
  send(ctx, "click", nativeLine, 180);
  assert.equal(ctx.inner.f.collapsed, true, "the native sibling line toggles only its owning folder");
});

test("native :hover fallback recolors the curved connector even when delegated XUL hover events are missed", () => {
  assert.match(source, /:root\[bgalazka-fc-line-hover\]:not\(\[bgalazka-fc-no-accent\]\) zen-folder\[\$\{LAYERS_ATTR\}~="accent"\] \.tab-group-line:hover\s*\{[^}]*background-color: var\(--bgalazka-fc-accent-hover/);
  assert.match(source, /:root\[bgalazka-fc-line-hover\]:not\(\[bgalazka-fc-no-accent\]\) zen-folder\[\$\{LAYERS_ATTR\}~="accent"\] > \.tab-group-container::before:hover\s*\{[^}]*background:\s*transparent[^}]*box-shadow:\s*inset 2px 0 0 0 var\(--bgalazka-fc-accent-hover/);
});

test("the native accent hit strip stays transparent while hover feedback changes connector color only", () => {
  assert.match(source, /\.tab-group-container::before\s*\{[\s\S]*?pointer-events:\s*none/);
  assert.match(source, /inset-inline-start:\s*0/);
  assert.match(source, /\[\$\{LINE_HOT_ATTR\}\] \.tab-group-line[\s\S]*?background-color:\s*var\(--bgalazka-fc-accent-hover/);
  assert.doesNotMatch(source, /\[\$\{LINE_HOT_ATTR\}\] > \.tab-group-container::before\s*\{[\s\S]*?background:/);
  assert.match(source, /\[\$\{LINE_HOT_ATTR\}\] \.tab-group-line/);
});

test("the transparent gutter remains a pointer target when hover is enabled without click", () => {
  assert.match(source, /\[bgalazka-fc-line-hover\][\s\S]{0,220}pointer-events:\s*auto/);
  assert.match(source, /\[bgalazka-fc-line-click\][\s\S]{0,220}pointer-events:\s*auto/);
  assert.match(source, /:root:not\(\[bgalazka-fc-no-accent\]\) zen-folder\[\$\{LAYERS_ATTR\}~="accent"\]\[\$\{LINE_HOT_ATTR\}\]/);
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

test("the two tint settings gate their own drawing and restore independent custom properties", () => {
  assert.match(source, /if \(!toggles\.tintHeader\) off\.push\(\.\.\.TOGGLE_PROPERTIES\.tintHeader\)/);
  assert.match(source, /if \(!toggles\.tintTabs\) off\.push\(\.\.\.TOGGLE_PROPERTIES\.tintTabs\)/);
  assert.match(source, /tintHeader:\s*\[\"--bgalazka-fc-tint\"\]/);
  assert.match(source, /tintTabs:\s*\[\"--tab-group-color-pale\"\]/);
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
  assert.ok(has("--bgalazka-fc-tint") && has("--tab-group-color-pale"));
  ctx.prefs.setBoolPref(key("style_tint_header"), false); flush(ctx);
  assert.ok(!has("--bgalazka-fc-tint"), "turning off the header tint removes only its dedicated background token");
  assert.ok(has("--tab-group-color-pale"), "tab tint remains independent");
  ctx.prefs.setBoolPref(key("style_tint_tabs"), false); flush(ctx);
  assert.ok(!has("--tab-group-color-pale"), "turning off tab tint restores Zen's own inline token");
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

test("copy-to-subfolders is enabled when the parent gets its look from folder-color defaults", async () => {
  const ctx = boot();
  flush(ctx);
  ctx.outer.f.setAttribute("id", "folder-outer"); ctx.inner.f.setAttribute("id", "folder-inner");
  ctx.prefs.setStringPref(KEY("default_base"), "#3366cc");
  flush(ctx);
  const menu = openMenu(ctx, ctx.outer.f);
  const copy = menu.find("Copy this folder's colors to all subfolders");
  assert.ok(copy, "the copy action is present");
  assert.notEqual(copy.getAttribute("disabled"), "true", "a visible default look is a valid source to copy");
  assert.notEqual(copy.disabled, true, "fresh XUL actions start enabled");
  copy.listeners.filter((l) => l.type === "command").forEach((l) => l.fn({}));
  await settle(ctx);
  assert.equal(recordCount(ctx), 1, "the effective default look is saved on the child folder");
  assert.equal(ctx.inner.f.style.getPropertyValue("--bgalazka-fc-accent"), "#3366cc");
});

test("right-click palette category menus stay enabled and use the same text color as enabled actions", () => {
  const ctx = boot();
  flush(ctx);
  ctx.outer.f.setAttribute("id", "folder-outer");
  const menu = openMenu(ctx, ctx.outer.f);
  const mint = menu.find("Mint");
  const classic = menu.find("Classic yellow folders");
  assert.ok(mint, "a built-in palette option is present");
  assert.ok(classic, "a built-in category menu is present");
  assert.equal(mint.getAttribute("disabled"), null, "palette options do not inherit stale disabled attributes");
  assert.notEqual(mint.disabled, true, "palette command remains enabled");
  const generated = menu.popup.all().filter((node) => node.hasAttribute("bgalazka-fc-menu"));
  assert.ok(generated.length > 5, "generated folder-color menus and actions are present");
  assert.ok(generated.some((node) => node.tag === "menupopup"), "every native submenu wrapper is tracked too");
  assert.ok(generated.filter((node) => !node.hasAttribute("data-zcf-disabled-by-design")).every((node) => node.getAttribute("disabled") !== "true" && node.disabled !== true), "all palette and submenu options remain enabled after insertion");
  const observer = ctx.mutationObservers.find((item) => item.target === menu.popup);
  assert.ok(observer, "the full popup tree is watched for native disabled-state changes");

  // Simulate native popup initialization reapplying disabled to both a category
  // and its submenu after popupshowing; the observer must re-normalize both.
  classic.setAttribute("disabled", "true");
  classic.disabled = true;
  const submenu = classic.children[0];
  submenu.setAttribute("disabled", "true");
  submenu.disabled = true;
  observer.trigger();
  ctx.lifecycle.listeners.filter((listener) => listener.type === "popupshown").forEach((listener) => listener.fn({ target: submenu }));
  flush(ctx);
  assert.equal(classic.getAttribute("disabled"), null, "the displayed category is re-enabled after native initialization");
  assert.notEqual(classic.disabled, true, "the displayed category can open its submenu");
  assert.equal(submenu.getAttribute("disabled"), null, "the submenu wrapper cannot gray or disable its children");
  assert.notEqual(submenu.disabled, true);
  assert.equal(classic.style.getPropertyValue("color"), "rgb(255, 255, 255)", "category text uses the same computed color as the enabled action");
  assert.equal(classic.style.getPropertyValue("opacity"), "1", "category text is not dimmed");
  assert.equal(submenu.style.getPropertyValue("color"), "rgb(255, 255, 255)", "the popup wrapper inherits the enabled menu color");
  assert.equal(mint.style.getPropertyValue("color"), "rgb(255, 255, 255)", "actual selectable palette items are not muted either");
  assert.ok(generated.filter((node) => !node.hasAttribute("data-zcf-disabled-by-design")).every((node) => node.style.getPropertyValue("color") === "rgb(255, 255, 255)" && node.style.getPropertyValue("opacity") === "1"), "every enabled category, submenu wrapper and choice uses the enabled action's readable text color");
  ctx.lifecycle.listeners.filter((listener) => listener.type === "popuphidden").forEach((listener) => listener.fn({ target: menu.popup }));
  assert.equal(observer.disconnected, true, "popup observer is released when the menu closes");
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

test("the Folder Color selector mirrors all eight global folder behavior switches", () => {
  const seam = (() => {
    const dom = makeFakeDom();
    const store = new Map();
    const prefs = { getStringPref: (k, d = "") => store.has(k) ? store.get(k) : d, getBoolPref: (_k, d = false) => d, getIntPref: (_k, d = 0) => d, getPrefType: () => 0 };
    const win = { document: dom.document, console, Event: class { constructor(type) { this.type = type; } }, dispatchEvent() {}, addEventListener() {}, removeEventListener() {}, innerWidth: 1200, innerHeight: 800, crypto: require("node:crypto").webcrypto, getComputedStyle: () => ({ direction: "ltr" }), ZentralRuntime: { register() {} } };
    win.window = win; win.globalThis = { Services: { prefs } };
    vm.runInNewContext(source, { ...win, window: win, globalThis: win.globalThis, ChromeUtils: {}, TextEncoder, Uint8Array, Uint32Array, DataView, Object, Array, String, Number, Math, JSON, Date, Set, Map, RegExp, Error, TypeError, WeakMap, Promise, Symbol, MutationObserver: undefined, console });
    return win.__zentralColorfulFoldersTestSeam.EDITOR_BEHAVIOR;
  })();
  const values = Array.from(seam, ([pref, label, fallback]) => ({ pref, label, fallback }));
  assert.deepEqual(values.map((x) => x.label), [
    "Ignore my folder label color (let the Zen theme decide the name color)",
    "Color the folder icons (back, front, outline)",
    "Folder/tab accent colors and native accent-line visibility",
    "Soft background tint behind the folder name row",
    "Soft background tint behind the tabs inside a folder",
    "Hover background on the folder name row",
    "Click the folder accent line to collapse or expand its folder",
    "Highlight the folder accent line on hover",
  ]);
  assert.equal(values[0].fallback, false);
  assert.ok(values.slice(1).every((x) => x.fallback === true));
  assert.match(source, /behaviorBox\.appendChild\(createElement\("summary", \{ text: \"Folder appearance behavior\" \}\)\)/);
  assert.match(source, /syncRootFlags\(\);\s*schedulePaint\(\);\s*announceDefaultsChanged\(\);/);
});

(async () => {
for (const [name, fn] of tests) {
  try { await fn(); passed++; console.log("ok - " + name); }
  catch (error) { console.log("FAIL - " + name); console.log(error && error.stack || error); process.exitCode = 1; }
}
console.log(`\n${passed}/${tests.length} Colorful Folders tree tests passed`);
})();
