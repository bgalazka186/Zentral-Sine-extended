"use strict";
/* OW-130 / 3.4.1: a short pointer press or plain click hides the panel once,
 * even when saved autohide is off; a completed hold toggles the preference.
 * Pointer jitter within 8 px does not cancel the gesture. The Triple/Super-pin
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

function extractGestureHelpers() {
  const start = SRC.indexOf("function classifyPillAutohideGesture");
  const end = SRC.indexOf("// <<OW-130 GESTURE END>>");
  assert.ok(start >= 0 && end > start, "the pure helpers are present and marker-bounded");
  const body = SRC.slice(start, end);
  // eslint-disable-next-line no-new-func
  return new Function(body + "\nreturn { classifyPillAutohideGesture, pillPointerMovement };")();
}

try {
  test("1. a pure classifier separates short press, completed hold and cancellations", () => {
    const { classifyPillAutohideGesture: classify } = extractGestureHelpers();
    const short = classify({ downAt: 1000, upAt: 1200, moved: false, cancelled: false, holdMs: 550 });
    assert.deepEqual(JSON.parse(JSON.stringify(short)), { action: "hide-once", held: false, pressedMs: 200 });
    const hold = classify({ downAt: 1000, upAt: 1600, moved: false, cancelled: false, holdMs: 550 });
    assert.deepEqual(JSON.parse(JSON.stringify(hold)), { action: "toggle", held: true, pressedMs: 600 });
    for (const opts of [
      { downAt: 1000, upAt: 1200, moved: true, cancelled: false, holdMs: 550 },
      { downAt: 1000, upAt: 1200, moved: false, cancelled: true, holdMs: 550 },
      { downAt: null, upAt: 1200, moved: false, cancelled: false, holdMs: 550 },
      { downAt: 1000, upAt: 900, moved: false, cancelled: false, holdMs: 550 },
    ]) {
      assert.equal(classify(opts).action, "none", "no gesture fires on a cancelled/invalid press");
    }
  });

  test("2. pointer movement is measured from the press, not inferred from an event existing", () => {
    const { pillPointerMovement } = extractGestureHelpers();
    const jitter = pillPointerMovement({ startX: 100, startY: 100, x: 105, y: 106, tolerancePx: 8 });
    assert.deepEqual(jitter, { moved: false, distancePx: 7.81 });
    const edge = pillPointerMovement({ startX: 100, startY: 100, x: 108, y: 100, tolerancePx: 8 });
    assert.equal(edge.moved, false, "exactly 8 px is still allowed");
    const drag = pillPointerMovement({ startX: 100, startY: 100, x: 110, y: 100, tolerancePx: 8 });
    assert.deepEqual(drag, { moved: true, distancePx: 10 });
    assert.equal(pillPointerMovement({ startX: 100, startY: 100, x: NaN, y: 100 }).moved, false,
      "a pointer event without usable coordinates is not a drag");
  });

  test("3. the hold threshold matches the existing long-press gesture, without stealing its buttons", () => {
    assert.match(SRC, /const PILL_AUTOHIDE_HOLD_MS = 550;/);
    assert.match(SRC, /const PILL_AUTOHIDE_MOVE_TOLERANCE_PX = 8;/);
    assert.match(SRC, /const PILL_AUTOHIDE_SELECTOR = "#zen-app-hover-reveal-btn";/);
    assert.match(SECONDARY, /const HOLD_MS = 550;/);
    assert.match(SECONDARY, /"#zen-app-dual-view-btn, #zen-app-panel-pill \.zen-app-btn\[data-pinned\]"/);
    assert.doesNotMatch(SRC, /PILL_AUTOHIDE_SELECTOR[\s\S]{0,200}zen-app-dual-view-btn/);
  });

  test("4. one-shot hiding is independent of the saved preference and keeps the reveal edge active", () => {
    assert.match(SRC, /const PILL_AUTOHIDE_HIDDEN_ONCE_ATTR = "bgalazka-hover-panel-hidden-once";/);
    assert.match(SRC, /const hoverPanelHiddenOnce = \(\) =>/);
    assert.match(SRC, /setHoverPanelHidden\(true, \{ once: true \}\)/);
    assert.match(SRC, /const oneShot = once && !!hidden && available;/);
    assert.match(SRC, /const hideAllowed = autohideEnabled \|\| oneShot;/);
    assert.match(SRC, /autohideEnabled \|\| hiddenOnce/);
    assert.match(SRC, /\(getPref\(BGALAZKA_EXT_PREFS\.HOVER_REVEAL_PANEL, false\) \|\|\s*hoverPanelHiddenOnce\(\)\)/);
    assert.match(SRC, /lastAutohidePref && !enabled\) setHoverPanelHidden\(false\)/);
    assert.match(SRC, /data-once-hidden/);
  });

  test("5. the shipped recognizer is pointer-based and suppresses only its own stale click", () => {
    for (const term of [
      "function hidePanelOnce()",
      "function toggleAutohidePref()",
      "const onPillAutohideDown",
      "const onPillAutohideUp",
      "const onPillAutohideMove",
      "const onPillAutohideCancel",
      "const onPillAutohideClick",
      "classifyPillAutohideGesture({",
      "pillPointerMovement({",
      "BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL",
      "data-hold-active",
    ]) assert.ok(SRC.includes(term), term + " is wired");
    assert.match(SRC, /document\.addEventListener\(\s*"pointerdown",\s*onPillAutohideDown,\s*true\s*\)/);
    assert.match(SRC, /window\.addEventListener\(\s*"pointerup",\s*onPillAutohideUp,\s*true\s*\)/);
    assert.match(SRC, /window\.addEventListener\(\s*"pointermove",\s*onPillAutohideMove,\s*true\s*\)/);
    assert.match(SRC, /window\.addEventListener\(\s*"pointercancel",\s*onPillAutohideCancel,\s*true\s*\)/);
    assert.match(SRC, /document\.addEventListener\(\s*"click",\s*onPillAutohideClick,\s*true\s*\)/);
    assert.match(SRC, /window\.addEventListener\(\s*"keydown",\s*onPillAutohideKeyDown,\s*true\s*\)/);
    assert.doesNotMatch(SRC, /"mousedown",\s*onPillAutohideDown/);
    assert.doesNotMatch(SRC, /"mouseup",\s*onPillAutohideUp/);
    assert.doesNotMatch(SRC, /"mousemove",\s*onPillAutohideMove/);
    assert.match(SRC, /pillAutohideConsumedClick \|\| pillAutohideSuppressClick/);
    assert.match(SRC, /hidePanelOnce\(\);\s*event\.preventDefault\(\);/);
    assert.match(SRC, /classifyPillAutohideGesture,\n\s*clearHoverHide,/);
    assert.doesNotMatch(SRC, /btn\.addEventListener\("click", \(event\) => \{[\s\S]{0,400}setPref\(BGALAZKA_EXT_PREFS\.HOVER_REVEAL_PANEL/);
  });

  test("6. cleanup removes every delegated gesture listener, pending hold and one-shot marker", () => {
    for (const term of [
      "onPillAutohideDown",
      "onPillAutohideUp",
      "onPillAutohideMove",
      "onPillAutohideCancel",
      "onPillAutohideClick",
      "onPillAutohideKeyDown",
      "clearPillAutohidePress",
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
