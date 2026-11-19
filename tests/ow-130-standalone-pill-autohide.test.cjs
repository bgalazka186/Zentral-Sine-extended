"use strict";
/* 3.4.1: the standalone Notes card pill now uses the exact same hold-action
 * pattern as the pin / keep buttons. A short click is a tap, a completed hold
 * is a separate action, and the click that ends a hold is swallowed. */
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

function holdAction(core) {
  let now = 1000;
  let nextTimer = 0;
  const timers = new Map();
  let hidden = 0;
  let toggled = 0;
  const api = core.createHoldAction({
    ms: core.PILL_AUTOHIDE_HOLD_MS,
    setTimer: (fn, ms) => {
      const id = ++nextTimer;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    onTap: () => { hidden++; },
    onHold: () => { toggled++; },
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
    api, advance,
    state: () => ({ hidden, toggled, armed: api.armed }),
  };
}

try {
  test("1. the Notes core exposes the pin-style hold action and parent-panel hidden check", () => {
    const core = notesCore();
    assert.equal(core.PILL_AUTOHIDE_HOLD_MS, 550);
    assert.equal(core.PANEL_HIDDEN_ONCE_ATTR, "bgalazka-hover-panel-hidden-once");
    assert.equal(typeof core.createHoldAction, "function");
    assert.equal(typeof core.zentralPanelHidden, "function");
    assert.equal(typeof core.classifyPillAutohideGesture, "undefined", "the old custom classifier is gone");
    assert.equal(typeof core.pillPointerMovement, "undefined", "the old custom movement helper is gone");
    assert.equal(typeof core.createPillAutohideGesture, "undefined", "the old custom gesture is gone");
    const root = (attrs) => ({ hasAttribute: (name) => attrs.includes(name) });
    assert.equal(core.zentralPanelHidden(root(["bgalazka-hover-panel-hidden"])), false,
      "the hidden attribute alone is not a one-shot parent-panel hide");
    assert.equal(core.zentralPanelHidden(root(["bgalazka-hover-panel-hidden", "bgalazka-hover-panel-enabled"])), true);
    assert.equal(core.zentralPanelHidden(root(["bgalazka-hover-panel-hidden", "bgalazka-hover-panel-hidden-once"])), true);
  });

  test("2. a short press is a tap and hides once", () => {
    const h = holdAction(notesCore());
    assert.equal(h.state().armed, false, "no timer outside a press");
    h.api.press();
    assert.equal(h.state().armed, true, "the timer exists only while pressed");
    h.api.release();
    assert.equal(h.api.click(), true, "a short click reaches its own action");
    assert.deepEqual(h.state(), { hidden: 1, toggled: 0, armed: false });
  });

  test("3. a completed hold toggles autohide and swallows the hold-ending click", () => {
    const h = holdAction(notesCore());
    h.api.press();
    h.advance(550);
    h.api.release();
    assert.equal(h.api.click(), false, "the click that ends a hold is swallowed");
    assert.deepEqual(h.state(), { hidden: 0, toggled: 1, armed: false });
  });

  test("4. pointerleave / cancel leaves the next click as a tap, not a hold", () => {
    const h = holdAction(notesCore());
    h.api.press();
    h.api.cancel();
    assert.equal(h.state().armed, false, "cancel stops the timer");
    assert.equal(h.api.click(), true);
    assert.deepEqual(h.state(), { hidden: 1, toggled: 0, armed: false });
  });

  test("5. the standalone pill is wired exactly like the pin / keep hold buttons", () => {
    assert.match(NOTES, /const PILL_AUTOHIDE_HOLD_MS = 550;/);
    assert.match(NOTES, /const PANEL_HIDDEN_ONCE_ATTR = "bgalazka-hover-panel-hidden-once";/);
    assert.match(NOTES, /hiddenOnceCard \|\| !!getPref\(PREF\.CARD_AUTOHIDE, false\)/);
    assert.doesNotMatch(NOTES, /classifyPillAutohideGesture|pillPointerMovement|createPillAutohideGesture|PILL_AUTOHIDE_MOVE_TOLERANCE_PX/);
    assert.match(NOTES, /holdHide = createHoldAction\(\{[\s\S]{0,240}ms: PILL_AUTOHIDE_HOLD_MS/);
    assert.match(NOTES, /onTap: \(\) => \{[\s\S]{0,160}hideCardOnce\(\)/);
    assert.match(NOTES, /onHold: \(\) => \{[\s\S]{0,160}toggleCardAutohide\(\)/);
    assert.match(NOTES, /listen\(hide, "pointerdown", \(e\) => \{[\s\S]{0,120}holdHide\.press\(\)/);
    assert.match(NOTES, /listen\(hide, "pointerup", \(\) => holdHide\.release\(\)\)/);
    assert.match(NOTES, /listen\(hide, "pointerleave", \(\) => \{[\s\S]{0,160}holdHide\.cancel\(\)/);
    assert.match(NOTES, /listen\(hide, "click", \(\) => \{[\s\S]{0,120}holdHide\.click\(\)/);
    assert.match(NOTES, /cleanups\.push\(\(\) => holdHide\?\.cancel\(\)\)/, "sheet cleanup survives a dropped pill");
    assert.match(NOTES, /holdHide\?\.cancel\(\);/);
    const hideBlock = NOTES.slice(NOTES.indexOf("const hideCardOnce = () => {"), NOTES.indexOf("const toggleCardAutohide = () => {"));
    assert.doesNotMatch(hideBlock, /setPref\(PREF\.CARD_AUTOHIDE/, "a one-shot hide never writes the saved pref");
    assert.match(hideBlock, /hiddenOnceCard = true;/);
    assert.match(hideBlock, /collapse\(\);/);
    const toggleBlock = NOTES.slice(NOTES.indexOf("const toggleCardAutohide = () => {"), NOTES.indexOf("holdHide = createHoldAction"));
    assert.match(toggleBlock, /hiddenOnceCard = false;/);
    assert.match(toggleBlock, /if \(collapsed\) expand\(false\);/);
    assert.match(toggleBlock, /setPref\(PREF\.CARD_AUTOHIDE, next\)/);
    assert.match(NOTES, /data-once-hidden/);
    assert.match(NOTES, /PANEL_HIDDEN_ONCE_ATTR,/);
    assert.match(NOTES, /data-hold-active/);
  });

  test("6. shared hover uses the pin-button recognizer and both pill styles expose hold / one-shot states", () => {
    assert.match(HOVER, /\/\/ <<OW-130 PIN-STYLE GESTURE>>/);
    assert.match(HOVER, /window\.addEventListener\("pointerdown", onPillAutohideDown, true\)/);
    assert.match(HOVER, /window\.addEventListener\("pointerup", cancelPillAutohidePending, true\)/);
    assert.match(HOVER, /window\.addEventListener\("click", onPillAutohideClick, true\)/);
    assert.match(HOVER, /setHoverPanelHidden\(true, \{ once: true \}\)/);
    assert.match(HOVER, /PILL_AUTOHIDE_HIDDEN_ONCE_ATTR/);
    assert.doesNotMatch(HOVER, /classifyPillAutohideGesture|pillPointerMovement|pillAutohideConsumedClick|pillAutohideSuppressClick/);
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
