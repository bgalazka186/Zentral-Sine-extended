"use strict";
/* OW-38 (part 5): Panels geometry. The panel's horizontal offset, its saved vertical extras and the notes reserve
 * are the numbers a person edits by dragging; they decide where the fixed-position panel actually sits. The tests
 * below run the real `geometry` part from `extension/panels/geometry/ZentralPanelGeometry.uc.js` against a fake
 * window: the offsets are measured from the panel's own box, the note sheet's reserve is subtracted from the bottom
 * margin, the saved pref wins over the fresh-install default, and a locked geometry refuses gestures instead of
 * writing hidden values. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const createDom = require("./helpers/fake-dom.cjs");

const REPO = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(REPO, "extension/panels/geometry/ZentralPanelGeometry.uc.js"), "utf8");
const PREF = "zen.workspace.bgalazka.panel_horizontal_offset_px";
const TOP_PREF = "zen.workspace.bgalazka.panel_top_extra_px";
const BOTTOM_PREF = "zen.workspace.bgalazka.panel_bottom_extra_px";
const POS_PREF = "zen.workspace.bgalazka.panel_position_offset_px";

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok -", name);
}

/* A real part: the file registers a generator; the harness resumes it once and then drives the published functions.
 * The panel root is a plain fixed-position box whose offsetLeft/offsetWidth the test controls. */
function boot({ prefs = {}, box = { left: 300, width: 420 } } = {}) {
  const { El, Ev, document } = createDom();
  const store = new Map(Object.entries(prefs));
  const observers = [];
  const cleanups = [];
  const timers = [];
  const Services = {
    prefs: {
      getBoolPref: (k, f = false) => (store.has(k) ? Boolean(store.get(k)) : f),
      getIntPref: (k, f = 0) => (store.has(k) ? Number(store.get(k)) : f),
      setIntPref: (k, v) => store.set(k, Number(v)),
      prefHasUserValue: (k) => store.has(k),
      addObserver: (k, fn) => observers.push({ k, fn }),
      removeObserver: () => {},
    },
    obs: { addObserver: () => {}, removeObserver: () => {} },
  };
  const root = document.createElement("div");
  root.id = "zen-app-panel-root";
  Object.defineProperty(root, "offsetLeft", { get: () => box.left, configurable: true });
  Object.defineProperty(root, "offsetWidth", { get: () => box.width, configurable: true });
  root.style.top = "12px";
  root.style.bottom = "12px";
  document.documentElement.appendChild(root);

  const listeners = [];
  const win = {
    document,
    innerWidth: 1400,
    innerHeight: 900,
    Services,
    setTimeout: (fn) => timers.push(fn),
    clearTimeout: () => {},
    requestAnimationFrame: (fn) => { timers.push(fn); return timers.length; },
    cancelAnimationFrame: () => {},
    addEventListener: (type, fn) => listeners.push({ type, fn }),
    removeEventListener: () => {},
    getComputedStyle: () => ({ display: "none", visibility: "visible", opacity: "1" }),
  };
  win.window = win;
  win.ZentralRuntime = { sidebarSafeBounds: () => ({ left: 0, right: 1400 }) };

  const parts = new Map();
  win.ZentralRuntime.registerPart = (id, def) => parts.set(id, def);

  const ctx = {
    registerCleanup: (fn) => cleanups.push(fn),
    getPref: (k, f) => (store.has(k) ? Number(store.get(k)) : f),
    setPref: (k, v) => store.set(k, Number(v)),
    safeCall: (fn) => fn(),
    setTimeout: (fn) => timers.push(fn),
    extendHoverResizeHold: () => {},
    computeOppositeDockingSafeMaxWidth: () => 900,
    EXT_PREFS: { ALL_SIDES_RESIZE: "zen.workspace.bgalazka.all_sides_resize", OPPOSITE_DOCKING: "zen.workspace.bgalazka.opposite_docking" },
  };

  const sandbox = {
    window: win,
    document,
    Services,
    console,
    URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, WeakMap, Array, Object, String, Boolean, Error, TypeError,
    setTimeout: win.setTimeout,
    clearTimeout: () => {},
    ChromeUtils: { importESModule: () => ({ Services }) },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: "ZentralPanelGeometry.uc.js" });
  const part = parts.get("geometry");
  assert.ok(part, "the geometry part registers itself");
  const gen = part(ctx);
  // The part is a generator: the first step installs the lazy getters, the rest declares the closure's state.
  // Resuming fully is what the real coordinator does before it calls any published function.
  let step = gen.next();
  while (!step.done) step = gen.next();
  return { ctx, root, document, Services, store, observers, cleanups, timers, listeners, win, box, run: () => gen.next() };
}

test("a fresh panel sits on the panel-side gap, a saved offset wins over it", () => {
  const env = boot();
  assert.equal(env.ctx.getAppliedHorizontalOffset(env.root), 0);
  env.ctx.applyHorizontalPanelOffset(env.root);
  // No saved pref: the default pulls the panel across Zentral's own 12 px side gap.
  assert.equal(env.root.style.marginLeft, "-12px", "the default offset is applied as a margin, not a position");
  assert.equal(env.ctx.getAppliedHorizontalOffset(env.root), -12);

  const saved = boot({ prefs: { [PREF]: 40 } });
  saved.ctx.applyHorizontalPanelOffset(saved.root);
  assert.equal(saved.root.style.marginLeft, "40px", "a saved offset is used as-is");
  assert.equal(saved.ctx.getAppliedHorizontalOffset(saved.root), 40);
});

test("a right-anchored panel mirrors the offset so +X always means the same visual direction", () => {
  const env = boot({ prefs: { [PREF]: 40 } });
  env.root.setAttribute("data-panel-side", "right");
  env.ctx.applyHorizontalPanelOffset(env.root);
  assert.equal(env.root.style.marginLeft, "0px", "the anchored side has no margin");
  assert.equal(env.root.style.marginRight, "-40px", "the offset goes to the other margin with the opposite sign");
  // The limits are relative to the offset already on screen: -260 puts the panel's left edge on the safe left edge.
  const limits = env.ctx.getHorizontalOffsetBounds(env.root);
  assert.equal(limits.min, -260, "how far the panel may move left");
  assert.equal(limits.max, 40 + (1400 - (env.box.left + env.box.width)), "how far it may move right");
});

test("an offset is clamped to the sidebar-safe area, and an off-screen panel clamps to itself", () => {
  const env = boot({ prefs: { [PREF]: 5000 } });
  const bounds = env.ctx.getHorizontalOffsetBounds(env.root);
  assert.equal(bounds.max, 1400 - (env.box.left + env.box.width), "the limit is the distance to the safe right edge");
  env.ctx.applyHorizontalPanelOffset(env.root);
  assert.equal(env.ctx.getAppliedHorizontalOffset(env.root), bounds.max, "a wild saved value is clamped, not applied");

  // The bounds are measured from offsetLeft/offsetWidth, never from getBoundingClientRect: a hover reveal translate
  // does not change either.
  const moved = boot({ prefs: { [PREF]: 0 } });
  const normal = moved.ctx.getHorizontalOffsetBounds(moved.root);
  moved.root.getBoundingClientRect = () => ({ left: 900, right: 1320, top: 0, bottom: 0, width: 420, height: 600 });
  assert.deepEqual(moved.ctx.getHorizontalOffsetBounds(moved.root), normal, "a visual transform changes nothing");
});

test("the vertical extras are the saved numbers, and the position offset moves the panel up without resizing it", () => {
  const env = boot({ prefs: { [TOP_PREF]: 10, [BOTTOM_PREF]: 46, [POS_PREF]: 30 } });
  env.ctx.applyVerticalResizeExtras(env.root);
  // A positive position offset shifts the whole panel up: the top margin loses 30, the bottom gains 30, so the height
  // the person saved (10 + 46 of extras) is untouched.
  assert.equal(env.root.style.marginTop, "-20px", "10 - 30");
  assert.equal(env.root.style.marginBottom, "76px", "46 + 30 keeps the height");

  const down = boot({ prefs: { [TOP_PREF]: 10, [BOTTOM_PREF]: 46, [POS_PREF]: -100 } });
  down.ctx.applyVerticalResizeExtras(down.root);
  // Downward it stops at the native 12 px top, so the panel never slides under a navbar that is not there.
  assert.equal(down.root.style.marginTop, "12px", "the downward shift is clamped at the native top");
  assert.equal(down.root.style.marginBottom, "-54px", "the bottom still absorbs the same amount, so nothing resizes");
});

test("a docked/edge-attached panel gives up exactly the height the Notes sheet reserves", () => {
  const env = boot({ prefs: { [TOP_PREF]: 10, [BOTTOM_PREF]: 46 } });
  env.document.documentElement.setAttribute("bgalazka-edge-attached-panels", "true");
  env.ctx.applyVerticalResizeExtras(env.root);
  assert.equal(env.root.style.marginBottom, "0px", "nothing reserved yet");

  env.document.documentElement.style.setProperty("--zentral-notes-panel-reserve", "220");
  env.ctx.applyVerticalResizeExtras(env.root);
  assert.equal(env.root.style.marginBottom, "220px", "the sheet's height is subtracted from the panel");

  // Quad view allocates a slot in CSS; the margin must not also apply.
  env.document.documentElement.setAttribute("bgalazka-quad-view", "true");
  env.ctx.applyVerticalResizeExtras(env.root);
  assert.equal(env.root.style.marginBottom, "0px", "a quad-view slot needs no margin");
});

test("a prefs change is applied from the cache, and cleanup restores the untouched panel", () => {
  const env = boot({ prefs: { [PREF]: 0 } });
  env.ctx.applyHorizontalPanelOffset(env.root);
  const observer = env.observers.find((o) => o.k === PREF);
  assert.ok(observer, "the panel watches its own offset pref");
  env.store.set(PREF, 25);
  observer.fn();
  assert.equal(env.root.style.marginLeft, "25px", "an outside write moves the panel");

  env.ctx.applyVerticalResizeExtras(env.root);
  for (const cleanup of env.cleanups) cleanup();
  assert.equal(env.root.style.marginLeft, "", "cleanup clears every margin it wrote");
  assert.equal(env.root.style.marginTop, "");
  assert.equal(env.root.style.marginBottom, "");
});

test("a locked geometry refuses the drag instead of editing hidden saved values", () => {
  const env = boot({ prefs: { [PREF]: 30 } });
  env.document.documentElement.setAttribute("bgalazka-push-page", "true");
  env.ctx.applyHorizontalPanelOffset(env.root);
  // Dual view closes the side gap and leaves the saved offset alone for later.
  assert.equal(env.root.style.marginLeft, "-12px");
  assert.equal(env.ctx.hPosDragState, null, "no drag state is created");
  const ev = { button: 0, clientX: 100, preventDefault() { this.prevented = true; }, stopPropagation() {} };
  env.ctx.startPanelHorizontalPositionDrag(ev);
  assert.equal(env.ctx.hPosDragState, null, "the gesture is refused while the geometry is locked");
  assert.notEqual(ev.prevented, true, "a refused gesture does not swallow the event");
});

console.log("\nPASS panels-geometry (" + passed + " tests)");
