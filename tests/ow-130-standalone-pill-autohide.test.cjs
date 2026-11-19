"use strict";
/* 3.4.1: the standalone Notes card pill uses the same click/hold contract as
 * the full-pack panel pill. A short pointer press or plain click hides once
 * without changing the saved autohide preference; a 550 ms hold toggles it. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const NOTES = read("additional/notes/ZentralNotes.uc.js");
const NOTES_CSS = read("additional/notes/ZentralNotes.css");
const HOVER = read("extension/panels/interaction/ZentralPanelHover.js");
const APPEARANCE_CSS = read("extension/appearance/ZentralAppearance.css");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

function notesCore() {
  const dom = require("./helpers/fake-dom.cjs")();
  const win = {
    document: dom.document,
    ZentralRuntime: { register() {} },
    __zentralNotesTestSeam: {},
    setTimeout,
    clearTimeout,
    addEventListener() {},
    removeEventListener() {},
  };
  win.window = win;
  vm.runInNewContext(NOTES, {
    window: win,
    document: dom.document,
    globalThis: { window: win, document: dom.document, Services: {} },
    ChromeUtils: {}, console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set,
    WeakMap, WeakSet, Symbol, Reflect, setTimeout, clearTimeout,
  });
  return win.__zentralNotesTestSeam.core;
}

function gesture(core) {
  let now = 1000;
  let nextTimer = 0;
  const timers = new Map();
  let holdActive = false;
  let hidden = 0;
  let toggled = 0;
  const api = core.createPillAutohideGesture({
    now: () => now,
    setTimer: (fn, ms) => {
      const id = ++nextTimer;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    setHoldActive: (active) => { holdActive = active; },
    onHideOnce: () => { hidden++; },
    onToggle: () => { toggled++; },
  });
  const ev = (extra = {}) => ({
    button: 0,
    isTrusted: true,
    pointerId: 7,
    clientX: 100,
    clientY: 100,
    detail: 1,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; },
    stopImmediatePropagation() { this.immediateStopped = true; },
    ...extra,
  });
  const advance = (ms) => {
    now += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.at <= now) {
        timers.delete(id);
        timer.fn();
      }
    }
  };
  return {
    api, ev, advance,
    state: () => ({ hidden, toggled, holdActive, press: !!api.press, suppress: api.suppressClick }),
  };
}

try {
  test("1. the Notes core exports pointer helpers and a parent-panel hidden check", () => {
    const core = notesCore();
    assert.equal(core.PILL_AUTOHIDE_HOLD_MS, 550);
    assert.equal(core.PILL_AUTOHIDE_MOVE_TOLERANCE_PX, 8);
    assert.equal(core.PANEL_HIDDEN_ONCE_ATTR, "bgalazka-hover-panel-hidden-once");
    assert.equal(typeof core.classifyPillAutohideGesture, "function");
    assert.equal(typeof core.pillPointerMovement, "function");
    assert.equal(typeof core.createPillAutohideGesture, "function");
    assert.equal(typeof core.zentralPanelHidden, "function");
    const root = (attrs) => ({ hasAttribute: (name) => attrs.includes(name) });
    assert.equal(core.zentralPanelHidden(root(["bgalazka-hover-panel-hidden"])), false,
      "the hidden attribute alone is not a one-shot parent-panel hide");
    assert.equal(core.zentralPanelHidden(root(["bgalazka-hover-panel-hidden", "bgalazka-hover-panel-enabled"])), true);
    assert.equal(core.zentralPanelHidden(root(["bgalazka-hover-panel-hidden", "bgalazka-hover-panel-hidden-once"])), true);
  });

  test("2. a short pointer press with jitter hides once and consumes its click", () => {
    const g = gesture(notesCore());
    g.api.down(g.ev());
    g.api.move(g.ev({ clientX: 105, clientY: 106 }));
    g.advance(200);
    g.api.up(g.ev({ clientX: 105, clientY: 106 }));
    const click = g.ev();
    assert.equal(g.api.click(click), false);
    assert.equal(click.defaultPrevented, true);
    assert.deepEqual(g.state(), { hidden: 1, toggled: 0, holdActive: false, press: false, suppress: false });
  });

  test("3. a completed hold toggles autohide and never hides twice", () => {
    const g = gesture(notesCore());
    g.api.down(g.ev());
    g.advance(550);
    assert.equal(g.state().holdActive, true, "the hold becomes visible");
    g.api.up(g.ev());
    const click = g.ev();
    assert.equal(g.api.click(click), false);
    assert.deepEqual(g.state(), { hidden: 0, toggled: 1, holdActive: false, press: false, suppress: false });
  });

  test("4. real movement, cancellation and plain clicks keep the one-shot contract", () => {
    const g = gesture(notesCore());
    g.api.down(g.ev());
    g.api.move(g.ev({ clientX: 130 }));
    assert.equal(g.state().press, false, "30 px is a drag, not jitter");
    assert.equal(g.state().suppress, true);
    g.api.up(g.ev());
    const canceledClick = g.ev();
    assert.equal(g.api.click(canceledClick), false);
    assert.equal(canceledClick.defaultPrevented, true);
    assert.equal(g.state().hidden, 0, "a canceled drag does not hide");
    const plainClick = g.ev({ detail: 0 });
    assert.equal(g.api.click(plainClick), false);
    assert.equal(g.state().hidden, 1, "keyboard/plain activation is a one-shot hide");
    assert.equal(g.state().toggled, 0);
    g.api.down(g.ev());
    g.api.cancel(g.ev({ key: "Escape" }));
    assert.equal(g.state().press, false);
    assert.equal(g.state().suppress, true);
    g.api.destroy();
    assert.equal(g.state().suppress, false, "destroy clears a stale cancel latch");
  });

  test("5. the standalone pill is wired to the pointer recognizer, not the old click-only toggle", () => {
    assert.match(NOTES, /const PILL_AUTOHIDE_HOLD_MS = 550;/);
    assert.match(NOTES, /const PILL_AUTOHIDE_MOVE_TOLERANCE_PX = 8;/);
    assert.match(NOTES, /const PANEL_HIDDEN_ONCE_ATTR = "bgalazka-hover-panel-hidden-once";/);
    assert.match(NOTES, /hiddenOnceCard \|\| !!getPref\(PREF\.CARD_AUTOHIDE, false\)/);
    assert.match(NOTES, /const hideCardOnce = \(\) => \{/);
    assert.match(NOTES, /const toggleCardAutohide = \(\) => \{/);
    const hideBlock = NOTES.slice(NOTES.indexOf("const hideCardOnce = () => {"), NOTES.indexOf("const toggleCardAutohide = () => {"));
    assert.doesNotMatch(hideBlock, /setPref\(PREF\.CARD_AUTOHIDE/, "a one-shot hide never writes the saved pref");
    assert.match(hideBlock, /hiddenOnceCard = true;/);
    assert.match(hideBlock, /collapse\(\);/);
    const toggleBlock = NOTES.slice(NOTES.indexOf("const toggleCardAutohide = () => {"), NOTES.indexOf("pillHideGesture = createPillAutohideGesture"));
    assert.match(toggleBlock, /hiddenOnceCard = false;/);
    assert.match(toggleBlock, /if \(collapsed\) expand\(false\);/);
    assert.match(toggleBlock, /setPref\(PREF\.CARD_AUTOHIDE, next\)/);
    assert.match(NOTES, /listen\(hide, "pointerdown", \(e\) => pillHideGesture\.down\(e\), true\)/);
    assert.match(NOTES, /listen\(window, "pointermove", \(e\) => pillHideGesture\.move\(e\), true\)/);
    assert.match(NOTES, /listen\(window, "pointerup", \(e\) => pillHideGesture\.up\(e\), true\)/);
    assert.match(NOTES, /listen\(window, "pointercancel", \(e\) => pillHideGesture\.cancel\(e\), true\)/);
    assert.match(NOTES, /listen\(hide, "click", \(e\) => pillHideGesture\.click\(e\), true\)/);
    assert.match(NOTES, /data-once-hidden/);
    assert.match(NOTES, /PANEL_HIDDEN_ONCE_ATTR,/);
    assert.doesNotMatch(NOTES, /listen\(hide, "click", \(\) => \{\s*if \(!dockedSide\(\)\) return flash/);
  });

  test("6. shared hover and both pill styles expose the one-shot and hold states", () => {
    assert.match(HOVER, /setHoverPanelHidden\(true, \{ once: true \}\)/);
    assert.match(HOVER, /PILL_AUTOHIDE_HIDDEN_ONCE_ATTR/);
    assert.match(HOVER, /PILL_AUTOHIDE_MOVE_TOLERANCE_PX = 8/);
    assert.match(HOVER, /document\.addEventListener\("pointerdown", onPillAutohideDown, true\)/);
    assert.match(APPEARANCE_CSS, /data-once-hidden="true"/);
    assert.match(APPEARANCE_CSS, /data-hold-active="true"/);
    assert.match(NOTES_CSS, /data-hold-active="true"/);
    assert.match(NOTES_CSS, /data-once-hidden="true"/);
    assert.match(NOTES_CSS, /data-hold-active; data-once-hidden|data-hold-active;[\s\S]{0,120}data-once-hidden/);
  });

  console.log(`OW-130 standalone pill autohide tests passed (${passed})`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
