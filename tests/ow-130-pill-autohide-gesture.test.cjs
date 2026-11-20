"use strict";
/* OW-130 / 3.4.1: the autohide pill now copies the panel pin button's proven
 * click/hold recognizer. A short click always reaches its own action; only a
 * completed 550 ms hold is suppressed. Pointer jitter inside 8 px does not
 * cancel, while a real move cancels the pending hold. The Triple/Super-pin
 * long press is out of scope. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "extension/panels/interaction/ZentralPanelHover.js"), "utf8");
const SECONDARY = fs.readFileSync(path.join(ROOT, "extension/panels/secondary-views/ZentralSecondaryViews.uc.js"), "utf8");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

function gestureRuntime() {
  const start = SRC.indexOf("// <<OW-130 PIN-STYLE GESTURE>>");
  const end = SRC.indexOf("// <<OW-130 PIN-STYLE GESTURE END>>");
  assert.ok(start >= 0 && end > start, "the pin-style gesture block is bounded and extractable");
  const block = SRC.slice(start, end);

  let now = 1000;
  let nextTimer = 0;
  const timers = new Map();
  const fakeSetTimeout = (fn, ms) => {
    const id = ++nextTimer;
    timers.set(id, { fn, at: now + ms });
    return id;
  };
  const fakeClearTimeout = (id) => timers.delete(id);
  const advance = (ms) => {
    now += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.at <= now) {
        timers.delete(id);
        timer.fn();
      }
    }
  };

  let target;
  const makeEmitter = () => ({
    listeners: [],
    addEventListener(type, fn) { this.listeners.push({ type, fn }); },
    removeEventListener(type, fn) { this.listeners = this.listeners.filter((l) => !(l.type === type && l.fn === fn)); },
    fire(type, extra = {}) {
      const ev = {
        type,
        button: 0,
        isTrusted: true,
        target,
        clientX: 100,
        clientY: 100,
        detail: 1,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.stopped = true; },
        stopImmediatePropagation() { this.immediateStopped = true; },
        ...extra,
      };
      for (const l of [...this.listeners]) if (l.type === type) l.fn(ev);
      return ev;
    },
  });

  target = {
    attrs: new Map(),
    closest(selector) { return selector === "#zen-app-hover-reveal-btn" ? this : null; },
    setAttribute(k, v) { this.attrs.set(k, String(v)); },
    removeAttribute(k) { this.attrs.delete(k); },
    getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; },
  };
  const outside = { closest: () => null };
  const window = makeEmitter();
  let hiddenCalls = 0;
  let toggleCalls = 0;
  let pref = false;
  const hiddenOptions = [];

  // The extracted block is intentionally not copied into the test: it runs the
  // shipped pin-style gesture with fake DOM, clock and preference seams.
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    "window", "setTimeout", "clearTimeout", "BGALAZKA_EXT_PREFS", "getPref",
    "setPref", "syncHoverPanelAvailability", "clearHoverHide",
    "setHoverPanelHidden", "hoverPanelAvailable", "PILL_AUTOHIDE_HOLD_MS",
    "PILL_AUTOHIDE_MOVE_TOLERANCE_PX", "PILL_AUTOHIDE_SELECTOR",
    block + `
      return {
        onPillAutohideDown, onPillAutohideMove, onPillAutohideClick,
        cancelPillAutohidePending, removePillAutohideListeners,
        get pending() { return pillAutohidePending; },
        get suppress() { return pillAutohideSuppress; },
      };
    `,
  );
  const runtime = factory(
    window,
    fakeSetTimeout,
    fakeClearTimeout,
    { HOVER_REVEAL_PANEL: "zen.workspace.zentral.panels.autohide" },
    (_k, fallback) => (_k === "zen.workspace.zentral.panels.autohide" ? pref : fallback),
    (_k, v) => { pref = v; toggleCalls++; },
    () => {},
    () => {},
    (hidden, opts) => { if (hidden) { hiddenCalls++; hiddenOptions.push(opts || {}); } },
    () => true,
    550,
    8,
    "#zen-app-hover-reveal-btn",
  );
  return {
    runtime, window, target, outside, advance,
    state: () => ({ hiddenCalls, toggleCalls, pref, hiddenOptions: [...hiddenOptions] }),
  };
}

try {
  test("1. the pin button's exact hold constants and movement rule are copied", () => {
    assert.match(SECONDARY, /const HOLD_MS = 550;/);
    assert.match(SECONDARY, /Math\.hypot\(event\.clientX - pending\.x, event\.clientY - pending\.y\) > 8/);
    assert.match(SECONDARY, /window\.addEventListener\("pointerdown", onDown, true\)/);
    assert.match(SECONDARY, /window\.addEventListener\("pointerup", cancelPending, true\)/);
    assert.match(SECONDARY, /window\.addEventListener\("click", onClick, true\)/);
    assert.match(SRC, /const PILL_AUTOHIDE_HOLD_MS = 550;/);
    assert.match(SRC, /const PILL_AUTOHIDE_MOVE_TOLERANCE_PX = 8;/);
    assert.match(SRC, /Math\.hypot\(/);
    assert.match(SRC, /window\.addEventListener\("pointerdown", onPillAutohideDown, true\)/);
    assert.match(SRC, /window\.addEventListener\("pointermove", onPillAutohideMove, true\)/);
    assert.match(SRC, /window\.addEventListener\("pointerup", cancelPillAutohidePending, true\)/);
    assert.match(SRC, /window\.addEventListener\("pointercancel", cancelPillAutohidePending, true\)/);
    assert.match(SRC, /window\.addEventListener\("blur", cancelPillAutohidePending\)/);
    assert.match(SRC, /window\.addEventListener\("click", onPillAutohideClick, true\)/);
  });

  test("2. a short click reaches its own one-shot hide and is never swallowed", () => {
    const a = gestureRuntime();
    a.window.fire("pointerdown", { target: a.target });
    a.window.fire("pointerup", { target: a.target });
    const click = a.window.fire("click", { target: a.target });
    assert.equal(click.defaultPrevented, undefined, "the short click is not suppressed");
    assert.equal(a.state().hiddenCalls, 1, "short click hides once");
    assert.equal(a.state().hiddenOptions[0].once, true, "hide-once is independent of the saved preference");
    assert.equal(a.state().toggleCalls, 0, "short click does not toggle the pref");
    assert.equal(a.runtime.pending, null);
    assert.equal(a.runtime.suppress, null);
  });

  test("3. a completed hold toggles the preference and suppresses only the hold-ending click", () => {
    const a = gestureRuntime();
    a.window.fire("pointerdown", { target: a.target });
    a.advance(550);
    assert.equal(a.state().toggleCalls, 1, "the hold action fires from the timer, like pin");
    assert.equal(a.state().hiddenCalls, 0, "the hold does not also hide once");
    assert.equal(a.target.getAttribute("data-hold-active"), "true");
    assert.equal(a.runtime.pending, null);
    assert.equal(a.runtime.suppress, a.target);
    a.window.fire("pointerup", { target: a.target });
    const click = a.window.fire("click", { target: a.target });
    assert.equal(click.defaultPrevented, true, "the hold-ending click is swallowed");
    assert.equal(a.target.getAttribute("data-hold-active"), null);
    assert.equal(a.runtime.suppress, null);
    assert.equal(a.state().hiddenCalls, 0);
  });

  test("4. sub-threshold jitter keeps the hold armed; a real move cancels only the hold", () => {
    const jitter = gestureRuntime();
    jitter.window.fire("pointerdown", { target: jitter.target });
    jitter.window.fire("pointermove", { target: jitter.target, clientX: 105, clientY: 106 });
    assert.notEqual(jitter.runtime.pending, null, "7.81 px jitter does not cancel");
    jitter.advance(550);
    assert.equal(jitter.state().toggleCalls, 1, "the hold still completes");

    const drag = gestureRuntime();
    drag.window.fire("pointerdown", { target: drag.target });
    drag.window.fire("pointermove", { target: drag.target, clientX: 130 });
    assert.equal(drag.runtime.pending, null, "30 px movement cancels the pending hold");
    drag.advance(550);
    assert.equal(drag.state().toggleCalls, 0, "no hold action after a real move");
    drag.window.fire("pointerup", { target: drag.target });
    drag.window.fire("click", { target: drag.target });
    assert.equal(drag.state().hiddenCalls, 1, "the short click still reaches its own action");
  });

  test("5. one-shot hiding remains independent of saved autohide and keeps reveal ownership", () => {
    assert.match(SRC, /const PILL_AUTOHIDE_HIDDEN_ONCE_ATTR = "bgalazka-hover-panel-hidden-once";/);
    assert.match(SRC, /const hoverPanelHiddenOnce = \(\) =>/);
    assert.match(SRC, /setHoverPanelHidden\(true, \{ once: true \}\)/);
    assert.match(SRC, /const oneShot = once && !!hidden && available;/);
    assert.match(SRC, /const hideAllowed = autohideEnabled \|\| oneShot;/);
    assert.match(SRC, /autohideEnabled \|\| hiddenOnce/);
    assert.match(SRC, /\(getPref\(BGALAZKA_EXT_PREFS\.HOVER_REVEAL_PANEL, false\) \|\|\s*hoverPanelHiddenOnce\(\)\)/);
    assert.match(SRC, /lastAutohidePref && !enabled\) setHoverPanelHidden\(false\)/);
    assert.match(SRC, /data-once-hidden/);
    assert.match(SRC, /event\.stopImmediatePropagation\(\);/, "holding click is swallowed exactly like the pin button");
    assert.doesNotMatch(SRC, /clearPillAutohidePress/, "cleanup never calls the removed custom-gesture helper");
    assert.doesNotMatch(SRC, /classifyPillAutohideGesture|pillPointerMovement|pillAutohideConsumedClick|pillAutohideSuppressClick/);
  });

  test("6. cleanup removes every pin-style listener, pending hold and one-shot marker", () => {
    const a = gestureRuntime();
    a.window.fire("pointerdown", { target: a.target });
    assert.notEqual(a.runtime.pending, null);
    a.runtime.removePillAutohideListeners();
    assert.equal(a.runtime.pending, null);
    assert.equal(a.runtime.suppress, null);
    assert.equal(a.target.getAttribute("data-hold-active"), null);
    assert.equal(a.window.listeners.length, 0, "every window listener is removed");
    for (const term of [
      "onPillAutohideDown",
      "onPillAutohideMove",
      "cancelPillAutohidePending",
      "onPillAutohideClick",
    ]) {
      assert.ok((SRC.match(new RegExp("removeEventListener\\([\\s\\S]{0,120}" + term, "g")) || []).length > 0, term + " is removed");
    }
    assert.match(SRC, /removePillAutohideListeners\(\);/);
    assert.match(SRC, /PILL_AUTOHIDE_HIDDEN_ONCE_ATTR,\s*\);/);
  });

  console.log(`OW-130 pill autohide gesture tests passed (${passed})`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
