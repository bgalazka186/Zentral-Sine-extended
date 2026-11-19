"use strict";
/* OW-38 (part 6): Compact sidebar hover. The optional window-entry reveal is a hit-test plus four bounded tunables:
 * the pointer must come in at the window's own side edge, away from the corners, and level with the sidebar; leaving
 * through that same edge may open a short welcome-back window. Getting any of those wrong either reveals the sidebar
 * while the pointer is over a tab or never reveals it at all, which is why the rules live in plain functions now.
 *
 * The rules are reached through the module's seam (`window.__zentralCompactHoverTestSeam`), so this file proves the
 * shipped code. The native hooks (Zen's compact-mode manager) stay a live check. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(root, "additional/tabs/compact-hover/ZentralCompactHover.uc.js"), "utf8");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok -", name);
}

const noop = () => {};
const registrations = [];
const window = {
  __zentralCompactHoverTestSeam: {},
  ZentralRuntime: { register: (def) => registrations.push(def) },
  addEventListener: noop, removeEventListener: noop,
  setTimeout: noop, clearTimeout: noop,
  requestAnimationFrame: noop, cancelAnimationFrame: noop,
};
window.window = window;
const Services = {
  prefs: { getBoolPref: (k, f) => f, getIntPref: (k, f) => f, addObserver: noop, removeObserver: noop },
  obs: { addObserver: noop, removeObserver: noop },
};
const document = { documentElement: { addEventListener: noop, removeEventListener: noop, getAttribute: () => null } };
const sandbox = {
  window, document, Services, console,
  setTimeout: noop, clearTimeout: noop, requestAnimationFrame: noop, cancelAnimationFrame: noop,
  ChromeUtils: { importESModule: () => ({ Services }) },
  URL, Date, JSON, Math, Number, String, Boolean, Array, Object, Map, Set, Error,
};
sandbox.globalThis = sandbox;
vm.runInNewContext(SRC, sandbox, { filename: "ZentralCompactHover.uc.js" });
const seam = window.__zentralCompactHoverTestSeam;
const has = typeof seam.revealFromBoundary === "function";

// A 1400x900 window with a 220 px sidebar on the left, spanning the panel's vertical band.
const windowBox = { left: 0, top: 0, right: 1400, bottom: 900 };
const sidebarBox = { left: 0, top: 90, right: 220, bottom: 810 };
const at = (clientX, clientY) => ({ clientX, clientY });

test("the module publishes its hit-test rules", () => {
  assert.ok(has, "the seam is filled at load");
  assert.equal(seam.EDGE_REACH_PX, 10, "the boundary reach is 10 px and part of the contract");
  assert.deepEqual(Object.keys(seam.TUNE_BOUNDS).sort(), ["edge_margin_px", "exit_grace_ms", "keep_hover_ms"]);
});

test("a reveal needs the pointer on the window's own side edge, level with the sidebar", () => {
  const r = (point, extra = {}) => seam.revealFromBoundary({ point, windowBox, sidebarBox, side: "left", recentExit: false, ...extra });
  assert.equal(r(at(4, 400)), true, "4 px in on the left edge, level with the sidebar");
  assert.equal(r(at(0, 90)), true, "the very edge, at the sidebar's top");
  assert.equal(r(at(40, 400)), false, "40 px in is inside the page, not a boundary crossing");
  assert.equal(r(at(4, 60)), false, "above the sidebar's own span, a corner entry does nothing");
  assert.equal(r(at(4, 880)), false, "and neither does the bottom corner");
  assert.equal(r(at(-20, 400)), false, "a point outside the window is not an entry");
});

test("a fast return is forgiven only when it follows an exit on the same side", () => {
  const r = (point, recentExit) => seam.revealFromBoundary({ point, windowBox, sidebarBox, side: "left", recentExit });
  // The first sample of a quick re-entry can land well inside; without a recent exit it is just ordinary movement.
  assert.equal(r(at(300, 400), false), false);
  assert.equal(r(at(300, 400), true), true, "a recent left-edge exit explains a deeper return");
  // A right-half point on a left sidebar is not explained by a left exit.
  assert.equal(r(at(900, 400), true), false, "the side must match");
});

test("a right-anchored sidebar mirrors the whole test", () => {
  const right = { left: 1200, top: 90, right: 1400, bottom: 810 };
  const r = (x) => seam.revealFromBoundary({ point: at(x, 400), windowBox, sidebarBox: right, side: "right", recentExit: false });
  assert.equal(r(1396), true, "just inside the right edge");
  assert.equal(r(1360), false, "40 px in is ordinary movement");
  // The rule is told which side the sidebar is docked to; with a left sidebar the right edge is never an entry.
  assert.equal(seam.revealFromBoundary({ point: at(1396, 400), windowBox, sidebarBox, side: "left", recentExit: false }), false, "the right edge is not an entry for a left sidebar");
});

test("leaving through the side edge is what arms the welcome-back window", () => {
  const e = (point, extra = {}) => seam.exitThroughSide({ point, windowBox, sidebarBox, side: "left", ...extra });
  assert.equal(e(at(0, 400)), true, "the pointer left through the edge, level with the sidebar");
  assert.equal(e(at(60, 400)), false, "60 px in is not an exit");
  assert.equal(e(at(0, 20)), false, "a corner exit does not arm it");
  assert.equal(e(at(0, 400), { sidebarBox: null }), false, "no sidebar, no exit to remember");
});

test("every tunable is clamped to the module's own bounds", () => {
  assert.equal(seam.clampTune("edge_margin_px", 12), 12);
  assert.equal(seam.clampTune("edge_margin_px", -5), 0, "a negative margin is the same as none");
  assert.equal(seam.clampTune("edge_margin_px", 900), 64, "the margin cannot grow into a permanent reveal");
  assert.equal(seam.clampTune("exit_grace_ms", 250), 250);
  assert.equal(seam.clampTune("exit_grace_ms", 99999), 2000, "the grace never outlives two seconds");
  assert.equal(seam.clampTune("keep_hover_ms", -1), 0);
  assert.equal(seam.clampTune("keep_hover_ms", Number.NaN), 0, "a broken pref falls back to off, not to a magic number");
  assert.equal(seam.clampTune("edge_margin_px", 12.6), 13, "a fractional pixel is rounded");
  assert.equal(seam.clampTune("unknown", 5), 0, "an unknown tunable has no opinion");
});

test("the live handlers use the same rules, not a second copy", () => {
  // One implementation: the pointer path and the seam must call the same functions.
  const reveal = SRC.slice(SRC.indexOf("function onWindowEnter"), SRC.indexOf("function setEntryListener"));
  assert.match(reveal, /revealFromBoundary\(\{/, "the entry handler delegates its hit-test");
  assert.ok(!/Math\.abs\(event\.clientX - windowBox\[side\]\)/.test(reveal), "the old inline edge test is gone");
  const remember = SRC.slice(SRC.indexOf("function rememberEntryExit"), SRC.indexOf("function onWindowEnter"));
  assert.match(remember, /exitThroughSide\(\{/, "the exit handler delegates too");
  assert.match(SRC, /edgeMargin = clampTune\(TUNE_NAMES\.MARGIN_PREF/, "the margin is clamped through the shared rule");
  assert.match(SRC, /exitGrace = clampTune\(TUNE_NAMES\.GRACE_PREF/, "and so is the grace");
  assert.match(SRC, /keepHoverDelay = clampTune\(/, "and the native keep-hover delay that bounds the return timer");
});

console.log("\nPASS compact-hover (" + passed + " tests)");
