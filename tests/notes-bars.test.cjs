"use strict";
/* Runs the real start() of additional/notes/ZentralNotes.uc.js against a fake panel suite DOM:
 * button placement on the primary bar and Triple View bar, sheet placement inside the slider,
 * preferences, shortcut, and full cleanup. Does NOT prove real layout or Gecko behavior. */
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const dom = require("./helpers/fake-dom.cjs")();
const { El, Ev, document, raf } = dom;

const prefs = new Map();
const prefObservers = [];
const windowListeners = [];
const mutationCallbacks = [];
let registered = null;
const disk = new Map();
const Services = {
  prefs: {
    getBoolPref: (k, d) => (prefs.has(k) ? prefs.get(k) : d),
    getStringPref: (k, d) => (prefs.has(k) ? prefs.get(k) : d),
    getIntPref: (k, d) => (prefs.has(k) ? prefs.get(k) : d),
    addObserver: (_b, o) => prefObservers.push(o),
    removeObserver: (_b, o) => prefObservers.splice(prefObservers.indexOf(o), 1),
  },
  obs: { addObserver() {}, removeObserver() {}, notifyObservers() {} },
};
class FakeMO { constructor(cb) { this.cb = cb; mutationCallbacks.push(cb); } observe() {} disconnect() { const i = mutationCallbacks.indexOf(this.cb); if (i >= 0) mutationCallbacks.splice(i, 1); } }
class FakeRO { observe() {} disconnect() {} }
// Fake CustomizableUI: one shared widget table, like the real one.
const cui = {
  widgets: new Map(),
  getWidget: (id) => ({ provider: cui.widgets.has(id) ? "api" : null }),
  createWidget(def) { if (cui.widgets.has(def.id)) throw new Error("exists"); cui.widgets.set(def.id, def); },
  destroyWidget(id) { cui.widgets.delete(id); },
  placed: [],
  ensureWidgetPlacedInWindow(id, w) { cui.placed.push(id); },
};
// Popover support for the fake elements (the standalone card enters the top layer while focused).
El.prototype.showPopover = function () { if (this._pop) throw new Error("already open"); this._pop = true; this.shown = (this.shown || 0) + 1; };
El.prototype.hidePopover = function () { this._pop = false; };
El.prototype.matches = function (sel) { return sel === ":popover-open" && !!this._pop; };
const win = {
  document,
  ZentralRuntime: { register: (def) => (registered = def) },
  requestAnimationFrame: (fn) => raf.push(fn), cancelAnimationFrame() {},
  setTimeout, clearTimeout, innerWidth: 1200, innerHeight: 800,
  addEventListener: (t, fn, c) => windowListeners.push({ t, fn, c }),
  removeEventListener: (t, fn) => { const i = windowListeners.findIndex((l) => l.t === t && l.fn === fn); if (i >= 0) windowListeners.splice(i, 1); },
};
win.window = win;
vm.runInNewContext(source, {
  window: win, document, Event: Ev, globalThis: { Services, CustomizableUI: cui }, ChromeUtils: {}, console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, setTimeout, clearTimeout,
  MutationObserver: FakeMO, ResizeObserver: FakeRO, navigator: { platform: "Linux" },
  PathUtils: { profileDir: "/profile", join: (...p) => p.join("/"), filename: (p) => p.split("/").pop() },
  IOUtils: {
    makeDirectory: async () => {}, setPermissions: async () => {},
    readUTF8: async (p) => { if (!disk.has(p)) throw new Error("nf"); return disk.get(p); },
    writeUTF8: async (p, t) => disk.set(p, t), remove: async (p) => disk.delete(p), exists: async (p) => disk.has(p),
    getChildren: async (d) => [...disk.keys()].filter((k) => k.startsWith(d + "/")), stat: async () => ({ lastModified: 1 }),
  },
});
const flush = async () => { for (let i = 0; i < 4; i++) { raf.splice(0).forEach((f) => f()); await new Promise((r) => setImmediate(r)); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isNotesBtn = (e) => e && e._classes.has("zentral-notes-btn");
const sheetsIn = (host) => host.children.filter((c) => c._classes.has("zentral-notes-sheet"));
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("ok -", name); }

(async () => {
  // fake panel suite
  const root = new El("div"); root.id = "zen-app-panel-root"; root.setAttribute("open", "");
  const slider = new El("div"); slider.id = "zen-app-panel-slider";
  const toolbar = new El("div"); toolbar.id = "zen-app-panel-toolbar";
  const back = new El("button"), url = new El("input");
  toolbar.append(back, url);
  const page = new El("browser");
  slider.append(toolbar, page);
  root.append(slider);
  document.body.append(root);

  let stop;
  await test("registers as 'notes' and starts without touching the page", async () => {
    assert.equal(registered.id, "notes");
    stop = registered.init();
    assert.equal(typeof stop, "function");
    assert.ok(isNotesBtn(toolbar.firstElementChild), "button is the first (max left) child of the URL bar");
    assert.equal(toolbar.children[1], back);
    assert.equal(toolbar.firstElementChild.hidden, false);
    const html = document.documentElement;
    assert.equal(html.getAttribute("zentral-notes-wrap"), "on", "wrap defaults to on");
    prefs.set("zen.workspace.zentral.notes.wrap_lines", false);
    prefObservers.forEach((o) => o.observe(null, "nsPref:changed", "zen.workspace.zentral.notes.wrap_lines"));
    assert.equal(html.getAttribute("zentral-notes-wrap"), "off", "wrap preference applies live");
    prefs.set("zen.workspace.zentral.notes.wrap_lines", true);
    prefObservers.forEach((o) => o.observe(null, "nsPref:changed", "zen.workspace.zentral.notes.wrap_lines"));
  });

  await test("button opens a sheet inside the slider over the panel; the browser is untouched; second click closes", async () => {
    const btn = toolbar.firstElementChild;
    const before = JSON.stringify([page.parent === slider, page.hidden, page.children.length]);
    btn.click();
    await sleep(30); await flush();
    const sheets = sheetsIn(slider);
    assert.equal(sheets.length, 1);
    assert.equal(sheets[0].hidden, false);
    assert.equal(btn.dataset.active, "true");
    assert.equal(JSON.stringify([page.parent === slider, page.hidden, page.children.length]), before, "page element untouched");
    const ta = sheets[0].querySelector(".zn-editor");
    ta.value = "quick note"; ta.dispatchEvent(new Ev("input", { bubbles: true }));
    btn.click();
    await flush();
    assert.equal(sheets[0].hidden, true);
    assert.equal(btn.dataset.active, "false");
    await sleep(60);
    assert.ok([...disk.keys()].some((k) => k.startsWith("/profile/zentral-notes/") && k.endsWith(".md")), "note saved to the profile folder, not prefs");
  });

  await test("preferences: hide button, disable and re-enable", async () => {
    const btn = toolbar.firstElementChild;
    prefs.set("zen.workspace.zentral.notes.show_button", false);
    prefObservers.forEach((o) => o.observe(null, "nsPref:changed", "zen.workspace.zentral.notes.show_button"));
    assert.equal(btn.hidden, true);
    prefs.set("zen.workspace.zentral.notes.show_button", true);
    prefObservers.forEach((o) => o.observe(null, "nsPref:changed", "zen.workspace.zentral.notes.show_button"));
    assert.equal(btn.hidden, false);
    prefs.set("zen.workspace.zentral.notes.enabled", false);
    prefObservers.forEach((o) => o.observe(null, "nsPref:changed", "zen.workspace.zentral.notes.enabled"));
    assert.ok(!toolbar.children.some(isNotesBtn), "button removed while disabled");
    prefs.set("zen.workspace.zentral.notes.enabled", true);
    prefObservers.forEach((o) => o.observe(null, "nsPref:changed", "zen.workspace.zentral.notes.enabled"));
    assert.ok(isNotesBtn(toolbar.firstElementChild), "button back when enabled");
  });

  await test("a Triple View / Super Pin bar that appears later gets its own button; both share one note", async () => {
    const box = new El("div"), bar = new El("div");
    bar.className = "bgalazka-super-bar";
    bar.append(new El("button"));
    box.append(bar);
    slider.append(box);
    mutationCallbacks.slice().forEach((cb) => cb([{ addedNodes: [box], removedNodes: [] }]));
    await sleep(120);
    assert.ok(isNotesBtn(bar.firstElementChild));
    toolbar.firstElementChild.click(); await sleep(30); await flush();
    bar.firstElementChild.click(); await sleep(30); await flush();
    const sheets = sheetsIn(slider);
    assert.equal(sheets.length, 2, "one sheet per bar");
    assert.ok(sheets.every((s) => !s.hidden));
    const [a, b] = sheets.map((s) => s.querySelector(".zn-editor"));
    assert.equal(a.value, b.value, "same note in both");
    dom.state.activeElement = a; a.value = "typed in the first"; a.dispatchEvent(new Ev("input", { bubbles: true })); await flush();
    assert.equal(b.value, "typed in the first", "second sheet follows live");
    // shortcut closes everything that is open
    const key = windowListeners.find((l) => l.t === "keydown" && l.c === true);
    const press = new Ev("keydown", { key: "N", code: "KeyN", altKey: true, shiftKey: true, ctrlKey: false, metaKey: false });
    key.fn(press);
    assert.ok(press.defaultPrevented);
    await flush();
    assert.ok(sheets.every((s) => s.hidden), "shortcut toggled all sheets closed");
    key.fn(new Ev("keydown", { key: "N", code: "KeyN", altKey: true, shiftKey: true, ctrlKey: false, metaKey: false }));
    await sleep(30); await flush();
    assert.ok(sheetsIn(slider).some((s) => !s.hidden), "shortcut opens one sheet again");
    // bar removed -> its button and sheet are cleaned up
    box.remove();
    mutationCallbacks.slice().forEach((cb) => cb([{ addedNodes: [], removedNodes: [box] }]));
    await sleep(120);
    assert.equal(sheetsIn(slider).length, 1);
  });

  await test("shortcut while the panel is hidden (autohide) opens the standalone card, not a sheet on the hidden bar", async () => {
    const key = windowListeners.find((l) => l.t === "keydown" && l.c === true);
    const press = () => key.fn(new Ev("keydown", { key: "N", code: "KeyN", altKey: true, shiftKey: true, ctrlKey: false, metaKey: false }));
    const html = document.documentElement;
    const floatCard = () => html.children.find((c) => c._classes.has("zentral-notes-sheet") && c.dataset.host === "float");
    if (sheetsIn(slider).some((s) => !s.hidden)) { press(); await flush(); }
    assert.ok(sheetsIn(slider).every((s) => s.hidden), "start with every panel sheet closed");
    html.setAttribute("bgalazka-hover-panel-enabled", "true");
    html.setAttribute("bgalazka-hover-panel-hidden", "true");
    dom.state.activeElement = url; // focus is still inside the hidden panel
    press(); await sleep(30); await flush();
    assert.ok(sheetsIn(slider).every((s) => s.hidden), "no sheet opened on the hidden bar");
    assert.ok(floatCard() && !floatCard().hidden, "standalone card opened instead");
    press(); await flush();
    assert.equal(floatCard().hidden, true, "and closes with the same shortcut");
    html.removeAttribute("bgalazka-hover-panel-enabled");
    html.removeAttribute("bgalazka-hover-panel-hidden");
    dom.state.activeElement = null;
  });

  await test("dock to sidebar: button appears in the sidebar row, card opens beside the sidebar, toggle cleans up", async () => {
    const toolbox = new El("div"); toolbox.id = "navigator-toolbox";
    const bottom = new El("div"); bottom.id = "zen-sidebar-bottom-buttons";
    toolbox.append(bottom);
    document.body.append(toolbox);
    // fake geometry: sidebar 0..280 wide on the left, content to its right
    toolbox.getBoundingClientRect = () => ({ left: 0, top: 0, right: 280, bottom: 800, width: 280, height: 800 });
    const content = new El("div"); content.id = "appcontent";
    content.getBoundingClientRect = () => ({ left: 280, top: 30, right: 1200, bottom: 800, width: 920, height: 770 });
    document.body.append(content);
    // close anything open from earlier steps (shortcut toggles all)
    for (const s of sheetsIn(slider)) if (!s.hidden) windowListeners.find((l) => l.t === "keydown" && l.c === true).fn(new Ev("keydown", { key: "N", code: "KeyN", altKey: true, shiftKey: true, ctrlKey: false, metaKey: false }));
    await flush();
    const trigger = () => prefObservers.forEach((o) => o.observe(null, "nsPref:changed", "zen.workspace.zentral.notes.dock_sidebar"));
    assert.ok(!bottom.children.some(isNotesBtn), "off by default: no sidebar button");
    prefs.set("zen.workspace.zentral.notes.dock_sidebar", true); trigger();
    const sbtn = bottom.children.find(isNotesBtn);
    assert.ok(sbtn, "sidebar button added");
    sbtn.click(); await sleep(30); await flush();
    const card = document.documentElement.children.find((c) => c._classes.has("zentral-notes-sheet") && c.dataset.host === "dock");
    assert.ok(card, "dock card exists");
    assert.equal(card.hidden, false);
    assert.equal(sbtn.dataset.active, "true");
    assert.equal(card.style.left, "286px", "starts at the sidebar's content edge (280) plus the 6px margin");
    assert.equal(card.style.top, "36px", "aligned with the content area (30) plus margin");
    // sidebar on the right: the card sits to its left
    toolbox.getBoundingClientRect = () => ({ left: 920, top: 0, right: 1200, bottom: 800, width: 280, height: 800 });
    card.querySelector(".zn-btn"); // layout is rAF-driven; trigger via the pref refresh path
    prefObservers.forEach((o) => o.observe(null, "nsPref:changed", "zen.workspace.zentral.notes.dock_sidebar")); await flush();
    assert.equal(Number.parseInt(card.style.left) + Number.parseInt(card.style.width) + 6 <= 920, true, "right-hand sidebar: card ends at the sidebar's edge");
    sbtn.click(); await flush();
    assert.equal(card.hidden, true);
    assert.equal(sbtn.dataset.active, "false");
    prefs.set("zen.workspace.zentral.notes.dock_sidebar", false); trigger();
    assert.ok(!bottom.children.some(isNotesBtn), "toggle off removes the sidebar button");
  });


  const keyOf = (spec) => new Ev("keydown", { key: spec.key, code: spec.code, altKey: !!spec.alt, shiftKey: !!spec.shift, ctrlKey: !!spec.ctrl, metaKey: false });
  const press = (spec) => windowListeners.find((l) => l.t === "keydown" && l.c === true).fn(keyOf(spec));
  const outside = (target) => windowListeners.filter((l) => l.t === "mousedown" && l.c === true).forEach((l) => l.fn(new Ev("mousedown", { target, bubbles: true })));
  const floatCard = () => document.documentElement.children.find((c) => c._classes.has("zentral-notes-sheet") && c.dataset.host === "float");
  const readMeta = () => { const f = disk.get("/profile/zentral-notes/meta.json"); return f ? JSON.parse(f) : {}; };

  await test("Customize toolbar widget: created once, icon is the Notes drawing, click goes to the pressed window, follows the enable switch", async () => {
    const def = cui.widgets.get("zentral-notes-toolbar-button");
    assert.ok(def, "widget registered");
    assert.equal(def.label, "Notes");
    assert.equal(def.defaultArea, undefined, "only in the palette until the person places it");
    def.onCreated({ ownerDocument: document });
    const st = document.getElementById("zentral-notes-toolbar-style");
    assert.ok(st, "icon rule lives in a window style element, not an inline style on one node");
    const css = decodeURIComponent(st.textContent);
    assert.ok(css.includes("#zentral-notes-toolbar-button{list-style-image:url(\"data:image/svg+xml"), "rule targets the widget id");
    assert.ok(css.includes("M15.5 3H5a2 2 0 0 0-2 2v14"), "same drawing as every other Notes icon");
    assert.ok(css.includes("context-stroke") && css.includes("-moz-context-properties:fill,stroke"), "SVG may take the toolbar's text color");
    def.onCreated({ ownerDocument: document });
    assert.equal(document.documentElement.all().filter((e) => e.id === "zentral-notes-toolbar-style").length, 1, "style added once per window");
    let toggled = 0; const real = win.__zentralNotesToggle; win.__zentralNotesToggle = () => { toggled++; real(); };
    def.onCommand({ target: { ownerGlobal: win } });
    assert.equal(toggled, 1, "the command reaches the window the button was pressed in");
    def.onCommand({ target: { ownerGlobal: {} } }); // a window without Notes: nothing happens, no throw
    win.__zentralNotesToggle = real;
    await flush();
    for (const s of sheetsIn(slider)) if (!s.hidden) press({ key: "N", code: "KeyN", alt: true, shift: true });
    await flush();
    prefs.set("zen.workspace.zentral.notes.enabled", false);
    prefObservers.forEach((o) => o.observe(null, "nsPref:changed", "zen.workspace.zentral.notes.enabled"));
    assert.equal(cui.widgets.size, 0, "disabled: widget removed");
    prefs.set("zen.workspace.zentral.notes.enabled", true);
    prefObservers.forEach((o) => o.observe(null, "nsPref:changed", "zen.workspace.zentral.notes.enabled"));
    assert.equal(cui.widgets.size, 1, "enabled: widget back");
  });

  await test("global shortcuts from the shared table open the standalone card; it keeps clear of the native sidebar", async () => {
    const toolbox = document.getElementById("navigator-toolbox");
    assert.ok(toolbox, "left over from the dock test");
    toolbox.getBoundingClientRect = () => ({ left: 920, top: 0, right: 1200, bottom: 800, width: 280, height: 800 });
    prefs.set("zen.workspace.zentral.notes.shortcuts", JSON.stringify({ openFloating: "Alt+Shift+F", quickNew: "Alt+Shift+Q", span: "Ctrl+Alt+J" }));
    for (const s of document.documentElement.all().filter((c) => c._classes.has("zentral-notes-sheet") && !c.hidden)) press({ key: "N", code: "KeyN", alt: true, shift: true });
    await flush();
    press({ key: "F", code: "KeyF", alt: true, shift: true });
    await sleep(40); await flush();
    const card = floatCard();
    assert.ok(card && !card.hidden, "Alt+Shift+F opened the standalone card");
    assert.equal(card.style.left, "10px", "sidebar on the right: the card starts on the LEFT (4px margin + 6px)");
    assert.equal(card.style.width, "448px");
    assert.equal(card.dataset.geo, "on");
    prefs.set("zen.workspace.zentral.notes.avoid_sidebar", false);
    prefObservers.forEach((o) => o.observe(null, "nsPref:changed", "zen.workspace.zentral.notes.avoid_sidebar")); await flush();
    assert.equal(card.style.left, "742px", "option off: the old place at the right edge (1200 - 460 - 4 + 6)");
    prefs.set("zen.workspace.zentral.notes.avoid_sidebar", true);
    prefObservers.forEach((o) => o.observe(null, "nsPref:changed", "zen.workspace.zentral.notes.avoid_sidebar")); await flush();
    assert.equal(card.style.left, "10px");
    toolbox.getBoundingClientRect = () => ({ left: 0, top: 0, right: 280, bottom: 800, width: 280, height: 800 });
    prefObservers.forEach((o) => o.observe(null, "nsPref:changed", "zen.workspace.zentral.notes.avoid_sidebar")); await flush();
    assert.ok(Number.parseInt(card.style.left) >= 280, "sidebar on the left: the card sits right of it");
  });

  await test("top layer only while focused: raised on open and on a press inside, dropped (attribute removed, still visible) by a press outside", async () => {
    const card = floatCard();
    assert.equal(card.getAttribute("popover"), "manual", "raised when it opened");
    assert.equal(card._pop, true);
    outside(page);
    assert.equal(card.getAttribute("popover"), null, "attribute removed on drop, or the card would vanish (display:none)");
    assert.equal(card._pop, false);
    assert.equal(card.hidden, false, "still visible, now an ordinary layer below Big Preview");
    const before = card.shown;
    card.dispatchEvent(new Ev("pointerdown", { bubbles: true, button: 0 }));
    assert.equal(card._pop, true, "pressing inside raises it again");
    assert.equal(card.shown, before + 1);
    card.dispatchEvent(new Ev("pointerdown", { bubbles: true, button: 0 }));
    dom.state.activeElement = card.querySelector(".zn-editor");
    card.dispatchEvent(new Ev("pointerdown", { bubbles: true, button: 0 }));
    assert.equal(card.shown, before + 1, "no hide/show churn while it is already on top and focused (it would blur the editor)");
  });

  await test("window pin: kept open by default; unpinned closes on an outside press but not on the sidebar, the bar button or itself", async () => {
    const card = floatCard();
    const keep = card.querySelector(".zn-keep-btn");
    assert.equal(keep.classList.contains("is-on"), true, "pinned by default (the old behavior)");
    outside(page);
    assert.equal(card.hidden, false, "pinned: outside press does not close");
    keep.click();
    assert.equal(keep.classList.contains("is-on"), false);
    outside(document.getElementById("navigator-toolbox"));
    assert.equal(card.hidden, false, "native sidebar is exempt");
    const stray = new El("div"); stray.className = "zentral-notes-btn"; document.body.append(stray);
    outside(stray);
    assert.equal(card.hidden, false, "a Notes button is exempt (its own click toggles)");
    outside(card.querySelector(".zn-editor"));
    assert.equal(card.hidden, false, "a press inside is not outside");
    stray.remove();
    outside(page);
    await flush();
    assert.equal(card.hidden, true, "unpinned: pressing the page closes it");
    assert.ok(!windowListeners.some((l) => l.t === "mousedown"), "the outside listener exists only while open");
    await sleep(700);
    assert.equal(readMeta().pinned, false, "the pin state is remembered");
    press({ key: "F", code: "KeyF", alt: true, shift: true });
    await sleep(40); await flush();
    assert.equal(card.querySelector(".zn-keep-btn").classList.contains("is-on"), false, "and restored on the next open");
    card.querySelector(".zn-keep-btn").click();
    assert.equal(card.querySelector(".zn-keep-btn").classList.contains("is-on"), true);
  });

  await test("hover reveal: an outside press tucks the unpinned card away, the strip on its top edge brings it back, no timer idles", async () => {
    const card = floatCard();
    const keep = card.querySelector(".zn-keep-btn");
    const strips = () => document.documentElement.children.filter((c) => c._classes.has("zentral-notes-reveal"));
    prefs.set("zen.workspace.zentral.notes.hover_reveal", true);
    if (keep.classList.contains("is-on")) keep.click();
    outside(page);
    await flush();
    assert.equal(card.hidden, false, "tucked, not closed");
    assert.equal(card.dataset.tucked, "true");
    assert.equal(strips().length, 1, "one reveal strip");
    assert.equal(strips()[0].style.top, card.style.top, "the strip sits on the card's top edge");
    outside(page);
    assert.equal(strips().length, 1, "a second outside press changes nothing");
    strips()[0].dispatchEvent(new Ev("mouseenter", {}));
    await sleep(220);
    await flush();
    assert.equal(card.dataset.tucked, undefined, "hovering the strip brings the card back");
    assert.equal(strips().length, 0, "strip removed");
    outside(page);
    await flush();
    assert.equal(card.dataset.tucked, "true");
    press({ key: "F", code: "KeyF", alt: true, shift: true });
    await sleep(40); await flush();
    assert.equal(card.dataset.tucked, undefined, "the shortcut also brings a tucked card back instead of closing it");
    assert.equal(card.hidden, false);
    prefs.set("zen.workspace.zentral.notes.hover_reveal", false);
    keep.click();
    assert.equal(keep.classList.contains("is-on"), true);
  });

  await test("hold Larger: tap = larger / smaller, hold = fill the whole area, the click that ends a hold does nothing", async () => {
    const card = floatCard();
    const btn = card.querySelector(".zn-head").children.find((b) => b.title.startsWith("Larger"));
    assert.ok(btn);
    const tap = () => { btn.dispatchEvent(new Ev("pointerdown", { bubbles: true, button: 0 })); btn.dispatchEvent(new Ev("pointerup", { bubbles: true })); btn.click(); };
    tap(); await flush();
    assert.equal(card.dataset.size, "full");
    assert.equal(card.style.height, "780px", "full: the card area (window 800 - 2x4) minus the 6px margins, as before");
    tap(); await flush();
    assert.equal(card.dataset.size, "peek");
    btn.dispatchEvent(new Ev("pointerdown", { bubbles: true, button: 0 }));
    await sleep(520);
    btn.dispatchEvent(new Ev("pointerup", { bubbles: true })); btn.click(); await flush();
    assert.equal(card.dataset.size, "span", "held: fills all the free space");
    assert.ok(Number.parseInt(card.style.width) > 800, "wider than the usual card");
    tap(); await flush();
    assert.equal(card.dataset.size, "peek", "a tap on a spanned card goes back");
    // pointer leaves before the hold time: nothing fires
    btn.dispatchEvent(new Ev("pointerdown", { bubbles: true, button: 0 }));
    btn.dispatchEvent(new Ev("pointerleave", { bubbles: true }));
    await sleep(520);
    assert.equal(card.dataset.size, "peek");
  });

  await test("drag the title bar and resize a grip: frame-throttled, saved once on release, restored on reopen, reset by double click", async () => {
    const card = floatCard();
    const px = (v) => Number.parseInt(v);
    // a real element reports where it is; the fake one needs to be told
    card.getBoundingClientRect = () => ({ left: px(card.style.left), top: px(card.style.top), width: px(card.style.width), height: px(card.style.height), right: 0, bottom: 0 });
    document.getElementById("navigator-toolbox").getBoundingClientRect = () => ({ left: 920, top: 0, right: 1200, bottom: 800, width: 280, height: 800 });
    prefObservers.forEach((o) => o.observe(null, "nsPref:changed", "zen.workspace.zentral.notes.avoid_sidebar")); await flush();
    const s0 = { x: px(card.style.left), y: px(card.style.top), w: px(card.style.width), h: px(card.style.height) };
    assert.equal(s0.x, 10, "default place: left of the right-hand sidebar");
    const head = card.querySelector(".zn-head");
    head.dispatchEvent(new Ev("pointerdown", { bubbles: true, button: 0, clientX: 100, clientY: 100, pointerId: 1 }));
    const rafBefore = raf.length;
    for (let i = 1; i <= 30; i++) card.dispatchEvent(new Ev("pointermove", { bubbles: true, clientX: 100 + i * 2, clientY: 100 - i, pointerId: 1 }));
    assert.equal(raf.length - rafBefore, 1, "thirty pointer events schedule ONE frame of work");
    assert.equal(card.dataset.dragging, "true");
    raf.splice(0).forEach((f) => f());
    assert.equal(card.style.left, s0.x + 60 + "px", "moved by the pointer distance");
    assert.equal(card.style.top, s0.y - 30 + "px", "dragged up");
    card.dispatchEvent(new Ev("pointermove", { bubbles: true, clientX: 160, clientY: 99999, pointerId: 1 }));
    raf.splice(0).forEach((f) => f());
    assert.equal(px(card.style.top) + px(card.style.height), 800, "dragged far down: stops at the window's lower edge");
    card.dispatchEvent(new Ev("pointermove", { bubbles: true, clientX: 160, clientY: 70, pointerId: 1 }));
    raf.splice(0).forEach((f) => f());
    assert.equal(readMeta().geo?.float, undefined, "nothing is written while dragging");
    card.dispatchEvent(new Ev("pointerup", { bubbles: true, pointerId: 1 }));
    assert.equal(card.dataset.dragging, undefined);
    await sleep(700);
    assert.deepEqual(JSON.parse(JSON.stringify(readMeta().geo.float)), { x: s0.x + 60, y: s0.y - 30, w: s0.w, h: s0.h });
    assert.equal(readMeta().size, "peek");
    // the click that ends a title drag must not open the notes list
    const clickEv = new Ev("click", { bubbles: true }); head.dispatchEvent(clickEv);
    assert.equal(clickEv.stopped, true, "swallowed once");
    // resize from the south-east grip
    const se = card.querySelectorAll(".zn-rz").find((g) => g.getAttribute("data-h") === "se");
    se.dispatchEvent(new Ev("pointerdown", { bubbles: true, button: 0, clientX: 400, clientY: 400, pointerId: 2 }));
    card.dispatchEvent(new Ev("pointermove", { bubbles: true, clientX: 440, clientY: 420, pointerId: 2 }));
    raf.splice(0).forEach((f) => f());
    assert.equal(px(card.style.width), s0.w + 40);
    assert.equal(px(card.style.height), s0.h + 20);
    assert.equal(px(card.style.left), s0.x + 60, "a south-east drag leaves the origin where it is");
    card.dispatchEvent(new Ev("pointerup", { bubbles: true, pointerId: 2 }));
    const resized = card.style.width;
    // close and reopen: the place is remembered
    press({ key: "F", code: "KeyF", alt: true, shift: true }); await flush();
    assert.equal(card.hidden, true);
    press({ key: "F", code: "KeyF", alt: true, shift: true }); await sleep(40); await flush();
    assert.equal(card.style.width, resized, "size restored");
    assert.equal(card.style.left, s0.x + 60 + "px", "position restored");
    // a window that got smaller pulls the card back inside
    win.innerWidth = 500;
    windowListeners.filter((l) => l.t === "resize").forEach((l) => l.fn()); await flush();
    assert.ok(px(card.style.left) + px(card.style.width) <= 500, "kept inside the window");
    win.innerWidth = 1200;
    windowListeners.filter((l) => l.t === "resize").forEach((l) => l.fn()); await flush();
    // double click on the empty title bar resets
    head.dispatchEvent(new Ev("dblclick", { bubbles: true, target: head }));
    await flush();
    assert.equal(card.style.width, s0.w + "px", "back to the default size");
    assert.equal(card.style.left, s0.x + "px");
    await sleep(700);
    assert.equal(readMeta().geo.float, undefined, "stored position removed");
    // a press on a header button never starts a drag
    const closeBtn = head.children[head.children.length - 1];
    closeBtn.dispatchEvent(new Ev("pointerdown", { bubbles: true, button: 0, clientX: 5, clientY: 5, pointerId: 3 }));
    card.dispatchEvent(new Ev("pointermove", { bubbles: true, clientX: 300, clientY: 300, pointerId: 3 }));
    assert.equal(raf.length, 0, "no frame scheduled: buttons are not drag handles");
  });

  await test("Recent: opening notes builds the list (newest first); quick new note works from anywhere", async () => {
    const mds = () => [...disk.keys()].filter((k) => k.startsWith("/profile/zentral-notes/") && k.endsWith(".md"));
    const before = mds().length;
    press({ key: "F", code: "KeyF", alt: true, shift: true }); await flush(); // close the card
    for (const s of document.documentElement.all().filter((c) => c._classes.has("zentral-notes-sheet") && !c.hidden)) press({ key: "N", code: "KeyN", alt: true, shift: true });
    await flush();
    press({ key: "Q", code: "KeyQ", alt: true, shift: true });
    await sleep(60); await flush();
    const open = document.documentElement.all().concat(slider.all()).filter((c) => c._classes.has("zentral-notes-sheet") && !c.hidden);
    assert.ok(open.length, "quick new opened a sheet");
    const ta = open[0].querySelector(".zn-editor");
    assert.equal(ta.value, "", "and it is a fresh, empty note");
    dom.state.activeElement = ta; ta.value = "brand new from anywhere"; ta.dispatchEvent(new Ev("input", { bubbles: true }));
    await sleep(1000); await flush();
    assert.equal(mds().length, before + 1, "saved as an additional note");
    await sleep(700);
    const recent = readMeta().recent;
    assert.ok(Array.isArray(recent) && recent.length >= 1 && recent.length <= 8, "recent list persisted");
    assert.equal(new Set(recent).size, recent.length);
    const chip = open[0].querySelector(".zn-chips").children.find((c) => c.textContent === "Recent");
    assert.ok(chip, "Recent chip in the list view");
    open[0].querySelector(".zn-list-btn").click(); chip.click(); await flush();
    assert.ok(open[0].querySelectorAll(".zn-item").length >= 1, "recent notes are listed");
    press({ key: "N", code: "KeyN", alt: true, shift: true }); await flush();
  });

  await test("destroy removes buttons, sheets, observers and listeners", async () => {
    await stop();
    assert.ok(!toolbar.children.some(isNotesBtn));
    assert.equal(sheetsIn(slider).length, 0);
    assert.equal(document.documentElement.children.filter((c) => c._classes.has("zentral-notes-sheet")).length, 0, "floating card removed too");
    assert.equal(prefObservers.length, 0);
    assert.ok(!document.documentElement.hasAttribute("zentral-notes-wrap"), "view attributes removed");
    assert.equal(mutationCallbacks.length, 0);
    assert.ok(!windowListeners.some((l) => l.t === "keydown"));
    assert.ok(!windowListeners.some((l) => l.t === "mousedown"), "outside-press listener gone");
    assert.equal(cui.widgets.size, 0, "toolbar widget removed with its owner");
    assert.equal(win.__zentralNotesToggle, undefined);
  });
  console.log(`\n${passed} notes bar tests passed`);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
