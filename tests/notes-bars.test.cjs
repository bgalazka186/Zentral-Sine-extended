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
  window: win, document, Event: Ev, globalThis: { Services }, ChromeUtils: {}, console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, setTimeout, clearTimeout,
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

  await test("destroy removes buttons, sheets, observers and listeners", async () => {
    await stop();
    assert.ok(!toolbar.children.some(isNotesBtn));
    assert.equal(sheetsIn(slider).length, 0);
    assert.equal(document.documentElement.children.filter((c) => c._classes.has("zentral-notes-sheet")).length, 0, "floating card removed too");
    assert.equal(prefObservers.length, 0);
    assert.ok(!document.documentElement.hasAttribute("zentral-notes-wrap"), "view attributes removed");
    assert.equal(mutationCallbacks.length, 0);
    assert.ok(!windowListeners.some((l) => l.t === "keydown"));
  });
  console.log(`\n${passed} notes bar tests passed`);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
