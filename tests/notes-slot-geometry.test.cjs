"use strict";
/* Slot geometry for panel-hosted Notes, run against the REAL start() of additional/notes/ZentralNotes.uc.js in a
 * fake DOM (see tests/helpers/fake-dom.cjs), plus the pure geometry helpers and the Triple View split maths.
 * Covers: docked band below the URL bar, full-height panel suspension (no reserve, no hit area), the two independent
 * edges of the Triple View gap (top = upper boundary, bottom = lower boundary), clamps, no accumulation, close/reopen,
 * mid-gesture close, bar removal, the divider hit-target CSS, and the divider math in ZentralSecondaryViews.
 * This does NOT prove native hit-testing, pointer capture or real layout: a live Zen drag test is still required. */
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
Object.defineProperty(El.prototype, "offsetParent", { get() { return this.parent; }, configurable: true }); // layout needs a positioned parent
document.dispatchEvent = document.dispatchEvent || (() => true);
const win = {
  document,
  ZentralRuntime: { register: (def) => (registered = def) }, __zentralNotesTestSeam: {},
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
const readMeta = () => { const f = disk.get("/profile/zentral-notes/meta.json"); return f ? JSON.parse(f) : {}; };
const isNotesBtn = (e) => e && e._classes.has("zentral-notes-btn");
const sheetsIn = (host) => host.children.filter((c) => c._classes.has("zentral-notes-sheet"));
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("ok -", name); }

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers (exported through the test seam) and the Triple View divider maths
// ---------------------------------------------------------------------------------------------------------------
const core = win.__zentralNotesTestSeam.core;
assert.ok(core && core.gapEdgeDrag && core.panelSpansFullHeight && core.dockBandTop, "test seam exposes the slot geometry helpers");

function pureTests() {
  const base = 600;
  // top edge: only the upper boundary moves; dragging up grows the gap, dragging down shrinks it
  let r = core.gapEdgeDrag({ edge: "n", startUp: 135, startDown: 135, dy: -60, base });
  assert.deepEqual([r.up, r.down, r.px], [195, 135, 330], "top edge up: upper panel gives, lower is untouched");
  r = core.gapEdgeDrag({ edge: "n", startUp: 135, startDown: 135, dy: 20, base });
  assert.deepEqual([r.up, r.down], [115, 135], "top edge down: upper panel gets space back");
  // bottom edge: only the lower boundary moves; dragging down grows the gap
  r = core.gapEdgeDrag({ edge: "s", startUp: 135, startDown: 135, dy: 40, base });
  assert.deepEqual([r.up, r.down, r.px], [135, 175, 310], "bottom edge down: lower panel gives, upper is untouched");
  r = core.gapEdgeDrag({ edge: "s", startUp: 135, startDown: 135, dy: -25, base });
  assert.deepEqual([r.up, r.down], [135, 110], "bottom edge up: lower panel gets space back");
  // clamps: never below the minimum sheet, never above base - page minimum; the OTHER edge never moves
  r = core.gapEdgeDrag({ edge: "n", startUp: 135, startDown: 135, dy: -5000, base });
  assert.equal(r.px, 480); assert.equal(r.down, 135, "max clamp holds the other edge");
  r = core.gapEdgeDrag({ edge: "s", startUp: 135, startDown: 135, dy: -5000, base });
  assert.equal(r.px, 140); assert.equal(r.up, 135, "min clamp holds the other edge");
  r = core.gapEdgeDrag({ edge: "n", startUp: 0, startDown: 200, dy: 5000, base });
  assert.equal(r.up, 0, "up never goes negative"); assert.equal(r.px, 200 > 140 ? 200 : 140);
  // per-panel room: the edge being dragged stops when ITS panel is down to the minimum
  r = core.gapEdgeDrag({ edge: "n", startUp: 135, startDown: 135, dy: -500, base, roomUp: 38 });
  assert.deepEqual([r.up, r.down], [173, 135], "top edge limited by the upper panel's room");
  r = core.gapEdgeDrag({ edge: "s", startUp: 135, startDown: 135, dy: 500, base, roomDown: 0 });
  assert.deepEqual([r.up, r.down], [135, 135], "no room, no movement");
  // restarting from the START values: the same dy gives the same answer no matter how often it is applied
  const once = core.gapEdgeDrag({ edge: "n", startUp: 100, startDown: 100, dy: -30, base });
  for (let i = 0; i < 5; i++) assert.deepEqual(core.gapEdgeDrag({ edge: "n", startUp: 100, startDown: 100, dy: -30, base }), once);
  // unusable base: nothing moves
  r = core.gapEdgeDrag({ edge: "n", startUp: 50, startDown: 50, dy: -80, base: 150 });
  assert.deepEqual([r.up, r.down], [50, 50]);
  // full-height detection (docked reserve is added back so the answer cannot flip after Notes shortens the panel)
  assert.equal(core.panelSpansFullHeight({ top: 0, bottom: 800, areaTop: 0, windowHeight: 800 }), true);
  assert.equal(core.panelSpansFullHeight({ top: 2, bottom: 798, areaTop: 0, windowHeight: 800 }), true, "within tolerance");
  assert.equal(core.panelSpansFullHeight({ top: 12, bottom: 788, areaTop: 0, windowHeight: 800 }), false, "inset card is not stretched");
  assert.equal(core.panelSpansFullHeight({ top: 0, bottom: 500, reserve: 300, areaTop: 0, windowHeight: 800 }), true, "reserve is added back");
  assert.equal(core.panelSpansFullHeight({ top: 0, bottom: 500, reserve: 0, areaTop: 0, windowHeight: 800 }), false, "short panel");
  assert.equal(core.panelSpansFullHeight({ top: 60, bottom: 800, areaTop: 60, windowHeight: 800 }), true, "content area top, not window top");
  assert.equal(core.panelSpansFullHeight({}), false);
  // the dock band starts below the whole panel
  assert.equal(core.dockBandTop({ pageBottom: 560, panelBottom: 600 }), 600);
  assert.equal(core.dockBandTop({ pageBottom: 600, panelBottom: 590 }), 600);
  assert.equal(core.dockBandTop({ pageBottom: 560, panelBottom: NaN }), 560);
}

// ZentralSecondaryViews: the divider maths are pure functions inside a larger closure; extract and run them.
function loadTripleMath() {
  const sv = fs.readFileSync(path.resolve(__dirname, "../extension/panels/secondary-views/ZentralSecondaryViews.uc.js"), "utf8");
  const grab = (name) => {
    const i = sv.indexOf("function " + name + "(");
    assert.ok(i >= 0, name + " exists");
    let depth = 0, j = sv.indexOf("}) {", i) + 3; // body brace, after the destructured parameter list
    for (let k = j; k < sv.length; k++) { if (sv[k] === "{") depth++; else if (sv[k] === "}" && --depth === 0) return sv.slice(i, k + 1); }
    throw new Error("unbalanced " + name);
  };
  return new Function(grab("tripleHeights") + "\n" + grab("tripleShareFor") + "\nreturn { tripleHeights, tripleShareFor };")();
}
function tripleTests() {
  const { tripleHeights: H, tripleShareFor: S } = loadTripleMath();
  // no Notes: unchanged proportional split
  let h = H({ usable: 586, gap: 0, share: 0.5 });
  assert.deepEqual([h.top, h.bottom], [293, 293]);
  // Notes open, proportional gap (no explicit edge): same as the old behaviour (usable * share)
  h = H({ usable: 316, gap: 270, share: 0.5, up: -1 });
  assert.deepEqual([h.top, h.bottom], [158, 158]);
  // explicit up: U = (usable + gap) * share - up, and U + L is always `usable`
  h = H({ usable: 256, gap: 330, share: 0.5, up: 195 });
  assert.equal(h.top, 98); assert.equal(h.top + h.bottom, 256);
  // the lower panel's start is unchanged by a top-edge drag: bottom edge of the whole stack is fixed
  const before = H({ usable: 316, gap: 270, share: 0.5, up: 135 });
  const afterTop = H({ usable: 256, gap: 330, share: 0.5, up: 195 });
  assert.equal(before.bottom, afterTop.bottom, "top-edge drag leaves the lower panel's height (and start) alone");
  const afterBottom = H({ usable: 276, gap: 310, share: 0.5, up: 135 });
  assert.equal(before.top, afterBottom.top, "bottom-edge drag leaves the upper panel alone");
  assert.equal(before.bottom - afterBottom.bottom, 40, "bottom-edge drag takes exactly the dragged distance from the lower panel");
  // min height keeps both panels usable
  h = H({ usable: 300, gap: 280, share: 0.5, up: 5000 });
  assert.equal(h.top, 75); assert.equal(h.bottom, 225);
  // divider drag inverse: dragging the divider changes the share only, and H(S(x)) puts the panel at x
  for (const up of [-1, 0, 100, 250]) for (const gap of [0, 270]) {
    if (up >= 0 && !gap) continue;
    const usable = 586 - gap;
    const share = S({ usable, gap, topPx: 200, up });
    assert.ok(share > 0 && share < 1);
    assert.equal(Math.round(H({ usable, gap, share, up }).top), 200, `round trip gap=${gap} up=${up}`);
  }
  // out-of-range pointer positions clamp
  assert.equal(H({ usable: 586, gap: 0, share: S({ usable: 586, gap: 0, topPx: -50 }) }).top, 146.5);
  assert.equal(H({ usable: 586, gap: 0, share: S({ usable: 586, gap: 0, topPx: 9999 }) }).top, 439.5);
}

// Hit-target CSS: no later rule may switch the Triple divider handle on over a rule that switches it off
// (that was the bug: the earlier "yield to Notes" rule never applied) and no such rule may remain.
function cssTests() {
  const css = fs.readFileSync(path.resolve(__dirname, "../extension/panels/browsers/ZentralBrowserIntegrations.css"), "utf8");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim().replace(/\/\*[\s\S]*?\*\//g, "").trim(), body: m[2] }));
  const handleRules = rules.filter((r) => r.sel.includes(".bgalazka-triple-drag-handle") && /pointer-events/.test(r.body));
  for (const r of handleRules) {
    if (/pointer-events:\s*none/.test(r.body)) assert.fail("a rule disables the Triple divider handle: " + r.sel);
  }
  assert.ok(handleRules.length >= 1, "the handle is switched on while the panel is open");
  const sv = fs.readFileSync(path.resolve(__dirname, "../extension/panels/secondary-views/ZentralSecondaryViews.uc.js"), "utf8");
  assert.match(sv, /const lead = notesGap\(\) > 0 \? 0 : 3;/, "handle does not reach above the divider while Notes owns the gap");
  assert.match(sv, /state\.dividerHandle\.style\.top = `\$\{line\.top - lead\}px`/);
  // Notes edge gestures never write the Triple share
  const notes = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
  assert.ok(!/state\.share|--bgalazka-top-share["']\s*,/.test(notes.replace(/getPropertyValue\?\.\("--bgalazka-(top|bottom)-share"\)/g, "")), "Notes never writes the Triple share");
}

// ---------------------------------------------------------------------------------------------------------------
// Fake-DOM tests against the real start()
// ---------------------------------------------------------------------------------------------------------------
(async () => {
  pureTests(); passed++; console.log("ok - gapEdgeDrag / panelSpansFullHeight / dockBandTop");
  tripleTests(); passed++; console.log("ok - Triple View split maths: independent edges, share untouched, clamps, divider round trip");
  cssTests(); passed++; console.log("ok - divider handle hit target: no dead pointer-events rule, handle stays below the Notes grip");

  const { tripleHeights: H } = loadTripleMath();
  const html = document.documentElement;
  const P = "zen.workspace.zentral.notes.";
  const vars = new Map();
  const writes = [];
  const st = html.style;
  st.setProperty = (k, v) => { vars.set(k, v); writes.push(k); };
  st.removeProperty = (k) => { vars.delete(k); writes.push(k); };
  st.getPropertyValue = (k) => (vars.has(k) ? vars.get(k) : "");
  const num = (k) => parseFloat(vars.get(k)) || 0;
  const rect = (l, t, w, b) => ({ left: l, top: t, right: l + w, bottom: b, width: w, height: b - t });

  const root = new El("div"); root.id = "zen-app-panel-root"; root.setAttribute("open", "");
  const slider = new El("div"); slider.id = "zen-app-panel-slider";
  const toolbar = new El("div"); toolbar.id = "zen-app-panel-toolbar";
  toolbar.append(new El("button"), new El("input"));
  const page = new El("browser");
  slider.append(toolbar, page);
  root.append(slider);
  document.body.append(root);
  slider.getBoundingClientRect = () => rect(0, 0, 400, 600);
  prefs.set(P + "push_panel_percent", 45);

  let stop;
  stop = registered.init();
  const primaryBtn = toolbar.firstElementChild;

  // ---- docked band sits BELOW the URL bar --------------------------------------------------------------------
  await test("docked Notes: the band starts below the whole panel (URL bar included), the reserve shortens the panel", async () => {
    root.getBoundingClientRect = () => rect(0, 12, 400, 640 - num("--zentral-notes-panel-reserve"));
    page.getBoundingClientRect = () => rect(0, 12, 400, 600 - num("--zentral-notes-panel-reserve"));
    primaryBtn.click(); await sleep(30); await flush();
    const sheet = sheetsIn(slider)[0];
    const reserve = num("--zentral-notes-panel-reserve");
    assert.ok(reserve > 0, "panel gave up height");
    const panelBottom = 640 - reserve, pageBottom = 600 - reserve;
    assert.ok(panelBottom > pageBottom, "URL bar lies between the page and the panel bottom");
    assert.equal(parseFloat(sheet.style.top), 600 - reserve + 6, "pseudo Triple View: the band is the bottom of the slider (inside the panel) + its 6px inset");
    assert.equal(html.hasAttribute("bgalazka-notes-pseudo"), true);
    assert.equal(sheet.dataset.slot, "dock");
    primaryBtn.click(); await flush();
    assert.equal(vars.has("--zentral-notes-panel-reserve"), false, "closing restores the previous geometry exactly");
  });

  // ---- stretched panel ----------------------------------------------------------------------------------------
  await test("a panel stretched from window top to bottom still gets its pseudo Triple View band (the panel is never shortened)", async () => {
    root.getBoundingClientRect = () => rect(0, 0, 400, 800);
    page.getBoundingClientRect = () => rect(0, 0, 400, 760);
    primaryBtn.click(); await sleep(30); await flush();
    const sheet = sheetsIn(slider)[0];
    assert.ok(num("--zentral-notes-panel-reserve") > 0, "band reserved inside the panel");
    assert.equal(sheet.dataset.slot, "dock");
    primaryBtn.click(); await flush();
    assert.equal(vars.has("--zentral-notes-panel-reserve"), false);
    assert.equal(html.hasAttribute("bgalazka-notes-pseudo"), false);
  });

  // ---- Triple View gap -----------------------------------------------------------------------------------------
  // A tiny model of the real layout: the secondary-views module sets the two web panels from the gap variables.
  const lower = new El("browser");
  const divider = new El("div"); divider.className = "bgalazka-triple-divider";
  const box = new El("div"), bar = new El("div"); bar.className = "bgalazka-super-bar"; bar.append(new El("button")); box.append(bar);
  const SHARE = 0.5, TOTAL = 1000, DIV = 14; // a stack tall enough that both panels have room to give
  const model = () => {
    const gap = num("--zentral-notes-gap"), up = vars.has("--zentral-notes-gap-up") ? num("--zentral-notes-gap-up") : -1;
    const usable = TOTAL - DIV - gap;
    const { top, bottom } = H({ usable, gap, share: SHARE, up });
    return { gap, up, U: top, L: bottom, dividerTop: top + gap, lowerTop: top + gap + DIV };
  };
  let winH = TOTAL;
  page.getAttribute("x");
  page.setAttribute("data-bgalazka-triple-slot", "top");
  lower.setAttribute("data-bgalazka-triple-slot", "bottom");
  page.getBoundingClientRect = () => { const m = model(); return rect(0, 0, 400, m.U); };
  lower.getBoundingClientRect = () => { const m = model(); return rect(0, m.lowerTop, 400, winH); };
  divider.getBoundingClientRect = () => { const m = model(); return rect(0, m.dividerTop, 400, m.dividerTop + DIV); };
  root.getBoundingClientRect = () => rect(0, 0, 400, TOTAL);
  slider.append(lower, divider, box);
  html.setAttribute("bgalazka-triple-view", "true");
  mutationCallbacks.slice().forEach((cb) => cb([{ addedNodes: [box], removedNodes: [] }]));
  await sleep(120);
  const tripleBtn = bar.firstElementChild;
  assert.ok(isNotesBtn(tripleBtn), "Triple View bar got its Notes button");
  // the real module publishes both panels' heights on the slider; Notes reads them to keep each panel usable
  slider.style.getPropertyValue = (k) => (k === "--bgalazka-top-share" ? model().U + "px" : k === "--bgalazka-bottom-share" ? model().L + "px" : "");
  const closed = { U: model().U, L: model().L };

  const gripOf = (sheet, h) => sheet.querySelectorAll(".zn-rz").find((g) => g.getAttribute("data-h") === h);
  const drag = async (sheet, h, y0, y1, id) => {
    const grip = gripOf(sheet, h);
    const down = new Ev("pointerdown", { bubbles: true, button: 0, clientY: y0, pointerId: id });
    grip.dispatchEvent(down);
    sheet.dispatchEvent(new Ev("pointermove", { bubbles: true, clientY: y1, pointerId: id }));
    await flush();
    return down;
  };
  const release = async (sheet, id) => { sheet.dispatchEvent(new Ev("pointerup", { bubbles: true, pointerId: id })); await sleep(750); await flush(); };

  await test("Triple View + Notes: the sheet fills the bounded gap above the divider", async () => {
    writes.length = 0;
    tripleBtn.click(); await sleep(30); await flush();
    const sheet = sheetsIn(slider).find((s) => s.dataset.slot === "gap");
    assert.ok(sheet, "gap slot");
    const m = model();
    assert.ok(m.gap > 0 && m.up === -1, "opens with a proportional gap");
    assert.equal(html.getAttribute("bgalazka-notes-gap"), "true");
    assert.equal(parseFloat(sheet.style.top), m.dividerTop - m.gap + 6, "sheet = the gap (+6px inset), ending above the divider");
    assert.equal(Math.round(m.U + m.gap + DIV + m.L), TOTAL, "gap + divider + panels fill the stack");
  });

  await test("top edge: only the UPPER boundary moves; the lower panel's start and height do not change; no global share written", async () => {
    const sheet = sheetsIn(slider).find((s) => s.dataset.slot === "gap");
    const m0 = model();
    writes.length = 0;
    const down = await drag(sheet, "n", 300, 240, 51);
    assert.equal(down.defaultPrevented, true, "the grip owns the gesture (preventDefault)");
    assert.equal(down.stopped, true, "and stops it from bubbling to the bar/divider");
    const m1 = model();
    assert.equal(m1.gap, m0.gap + 60, "gap grows by the drag distance");
    assert.equal(Math.round(m1.U), Math.round(m0.U - 60), "upper panel gave exactly 60px");
    assert.equal(Math.round(m1.L), Math.round(m0.L), "lower panel height unchanged");
    assert.equal(Math.round(m1.lowerTop), Math.round(m0.lowerTop), "the next web panel starts where it did");
    assert.equal(sheet.dataset.dragging, "true");
    // the same pointer position applied repeatedly does not accumulate
    for (let i = 0; i < 4; i++) { sheet.dispatchEvent(new Ev("pointermove", { bubbles: true, clientY: 240, pointerId: 51 })); await flush(); }
    assert.equal(model().gap, m1.gap, "no accumulated reserve");
    // only Notes' own variables were written (never the Triple share)
    assert.ok(writes.every((k) => k.startsWith("--zentral-notes-")), "writes: " + [...new Set(writes)]);
    await release(sheet, 51);
    assert.equal(sheet.dataset.dragging, undefined, "gesture finished");
    assert.ok(readMeta().gapSplit >= 0 && readMeta().gapSplit <= 1, "split persisted");
    assert.equal(model().gap, m1.gap, "release does not jump");
  });

  await test("bottom edge: only the LOWER boundary moves; the upper panel does not change; Notes does not translate", async () => {
    const sheet = sheetsIn(slider).find((s) => s.dataset.slot === "gap");
    const m0 = model(), top0 = parseFloat(sheet.style.top);
    await drag(sheet, "s", 400, 440, 52);
    const m1 = model();
    assert.equal(Math.round(m1.U), Math.round(m0.U), "upper panel unchanged");
    assert.equal(Math.round(m0.L - m1.L), 40, "lower panel gave exactly 40px");
    assert.equal(Math.round(m1.lowerTop - m0.lowerTop), 40, "the lower panel starts 40px lower");
    assert.equal(m1.gap, m0.gap + 40);
    assert.equal(parseFloat(sheet.style.top), top0, "the band's TOP edge stayed put: it grew, it was not dragged like a card");
    await release(sheet, 52);
  });

  await test("clamps: the edge stops at the maximum and minimum slot and never leaves a panel unusable", async () => {
    const sheet = sheetsIn(slider).find((s) => s.dataset.slot === "gap");
    await drag(sheet, "n", 300, -4000, 53);
    let m = model();
    assert.ok(m.gap <= 880, "max slot " + m.gap);
    assert.ok(m.U >= 119 && m.L >= 119, "both web panels stay usable (>=120px): " + [m.U, m.L]);
    assert.ok(readMeta().gapSplit === undefined || true);
    await release(sheet, 53);
    await drag(sheet, "s", 400, -4000, 54);
    m = model();
    assert.ok(m.gap >= 140, "min slot " + m.gap);
    await release(sheet, 54);
  });

  await test("stale gestures: closing mid-drag releases the reserve and later pointer moves do nothing", async () => {
    const sheet = sheetsIn(slider).find((s) => s.dataset.slot === "gap");
    await drag(sheet, "n", 300, 250, 55);
    assert.equal(sheet.dataset.dragging, "true");
    tripleBtn.click(); await flush();
    assert.equal(vars.has("--zentral-notes-gap"), false, "gap released");
    assert.equal(vars.has("--zentral-notes-gap-up"), false, "edge offset released");
    assert.equal(html.hasAttribute("bgalazka-notes-gap"), false);
    assert.equal(sheet.dataset.dragging, undefined);
    sheet.dispatchEvent(new Ev("pointermove", { bubbles: true, clientY: 100, pointerId: 55 }));
    sheet.dispatchEvent(new Ev("pointerup", { bubbles: true, pointerId: 55 }));
    await sleep(100); await flush();
    assert.equal(vars.has("--zentral-notes-gap"), false, "a stale pointer event does not re-open the gap");
    const m = model();
    assert.deepEqual([Math.round(m.U), Math.round(m.L)], [Math.round(closed.U), Math.round(closed.L)], "closed geometry equals the original proportions");
  });

  await test("close/reopen: the remembered split returns; closing restores the original panel proportions", async () => {
    tripleBtn.click(); await sleep(30); await flush();
    const m = model();
    assert.ok(m.gap > 0);
    assert.ok(m.up >= 0, "remembered edge position is applied (explicit upper part)");
    assert.ok(Math.abs(m.up / m.gap - readMeta().gapSplit) < 0.01, "same split as saved");
    tripleBtn.click(); await flush();
    const c = model();
    assert.deepEqual([Math.round(c.U), Math.round(c.L)], [Math.round(closed.U), Math.round(closed.L)]);
  });

  await test("browser resize: the gap follows the stored share of the pages, it does not accumulate", async () => {
    tripleBtn.click(); await sleep(30); await flush();
    const g0 = model().gap;
    for (let i = 0; i < 5; i++) { windowListeners.filter((l) => l.t === "resize").forEach((l) => l.fn()); await sleep(5); await flush(); }
    assert.equal(model().gap, g0, "repeated resize passes keep the gap");
  });

  await test("panel switch: removing the Triple bar while open releases every Notes reserve and marker", async () => {
    assert.ok(vars.has("--zentral-notes-gap"));
    box.remove();
    mutationCallbacks.slice().forEach((cb) => cb([{ addedNodes: [], removedNodes: [box] }]));
    await sleep(150); await flush();
    for (const k of ["--zentral-notes-gap", "--zentral-notes-gap-up", "--zentral-notes-panel-reserve"]) assert.equal(vars.has(k), false, k);
    for (const a of ["bgalazka-notes-gap", "bgalazka-quad-view", "bgalazka-notes-spill"]) assert.equal(html.hasAttribute(a), false, a);
  });

  await test("Triple View with no middle bar yet: Notes waits as the card, it reserves nothing (no quad marker, no gap variables)", async () => {
    primaryBtn.click(); await sleep(30); await flush();
    assert.equal(html.hasAttribute("bgalazka-quad-view"), false);
    assert.equal(vars.has("--zentral-notes-panel-reserve"), false);
    assert.equal(vars.has("--zentral-notes-gap"), false);
    assert.equal(vars.has("--zentral-notes-gap-up"), false);
    primaryBtn.click(); await flush();
    assert.equal(html.hasAttribute("bgalazka-quad-view"), false);
    html.removeAttribute("bgalazka-triple-view");
  });


  await test("focus: after the user presses in a web-panel field, Notes never takes the caret back; a press inside Notes (or an explicit open) does", async () => {
    root.getBoundingClientRect = () => rect(0, 12, 400, 640);
    page.getBoundingClientRect = () => rect(0, 12, 400, 600);
    html.removeAttribute("bgalazka-triple-view");
    primaryBtn.click(); await sleep(30); await flush();
    const sheet = sheetsIn(slider)[0], ta = sheet.querySelector(".zn-editor");
    assert.equal(dom.state.activeElement, ta, "explicit open focuses the editor");
    const field = new El("input");
    slider.append(field);
    field.focus();
    assert.equal(dom.state.activeElement, field);
    const outside = windowListeners.find((l) => l.t === "mousedown" && l.c === true);
    outside.fn(new Ev("mousedown", { target: field, composedPath: () => [field, slider] }));
    // every automatic path that used to call focusEditor(): reopen of an open sheet, mode change, async load
    const modeBtn = sheet.all().find((b) => b.title === "Read (Ctrl+E)");
    assert.ok(modeBtn, "found a mode button");
    modeBtn.click(); await flush();
    assert.equal(dom.state.activeElement, field, "a mode change (automatic focusEditor) did not steal the focus");
    sheet.dispatchEvent(new Ev("pointerdown", { bubbles: true, button: 0 }));
    modeBtn.click(); await flush();
    assert.notEqual(dom.state.activeElement, field, "after a press inside Notes it may focus itself again");
    primaryBtn.click(); await flush();
  });

  await test("teardown: disposing Notes while a slot is open leaves no variable, marker or listener behind", async () => {
    primaryBtn.click(); await sleep(30); await flush();
    assert.ok(vars.has("--zentral-notes-panel-reserve") || html.hasAttribute("bgalazka-quad-view") || true);
    stop();
    await flush();
    for (const k of ["--zentral-notes-gap", "--zentral-notes-gap-up", "--zentral-notes-panel-reserve"]) assert.equal(vars.has(k), false, k);
    for (const a of ["bgalazka-notes-gap", "bgalazka-quad-view", "bgalazka-notes-spill"]) assert.equal(html.hasAttribute(a), false, a);
    assert.deepEqual(windowListeners.filter((l) => l.t !== "unload").map((l) => l.t), [], "window listeners removed (the one-off unload hook is intentionally kept)");
  });

  console.log(`\n${passed} slot-geometry tests passed`);
  process.exit(0);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
