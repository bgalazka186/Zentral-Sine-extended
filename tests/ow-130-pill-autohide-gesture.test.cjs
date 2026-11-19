"use strict";
/* OW-130 RED -> GREEN: a short mouse-up hides the panel once; a completed
 * hold keeps the old autohide toggle. Cancelled/moved presses do nothing.
 * The existing Triple/Super-pin long-press gesture is out of scope. */
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

function extractClassifier() {
  const start = SRC.indexOf("function classifyPillAutohideGesture");
  const end = SRC.indexOf("// <<OW-130 GESTURE END>>");
  assert.ok(start >= 0 && end > start, "the pure classifier is present and marker-bounded");
  const body = SRC.slice(start, end);
  // eslint-disable-next-line no-new-func
  return new Function(body + "\nreturn classifyPillAutohideGesture;")();
}

try {
  test("1. a pure classifier separates short click, completed hold and cancellations", () => {
    const classify = extractClassifier();
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

  test("2. the hold threshold matches the existing long-press gesture, without stealing its buttons", () => {
    assert.match(SRC, /const PILL_AUTOHIDE_HOLD_MS = 550;/);
    assert.match(SRC, /const PILL_AUTOHIDE_SELECTOR = "#zen-app-hover-reveal-btn";/);
    assert.match(SECONDARY, /const HOLD_MS = 550;/);
    assert.match(SECONDARY, /"#zen-app-dual-view-btn, #zen-app-panel-pill \.zen-app-btn\[data-pinned\]"/);
    assert.doesNotMatch(SRC, /PILL_AUTOHIDE_SELECTOR[\s\S]{0,200}zen-app-dual-view-btn/);
  });

  test("3. source splits mouse-up hide-once from hold-toggle and suppresses the click", () => {
    for (const term of [
      "function hidePanelOnce()",
      "function toggleAutohidePref()",
      "const onPillAutohideDown",
      "const onPillAutohideUp",
      "const onPillAutohideMove",
      "const onPillAutohideCancel",
      "const onPillAutohideClick",
      "classifyPillAutohideGesture({",
      "setHoverPanelHidden(true)",
      "BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL",
      "data-hold-active",
    ]) assert.ok(SRC.includes(term), term + " is wired");
    assert.match(SRC, /document\.addEventListener\(\s*"mousedown",\s*onPillAutohideDown,\s*true\s*\)/);
    assert.match(SRC, /window\.addEventListener\(\s*"mouseup",\s*onPillAutohideUp,\s*true\s*\)/);
    assert.match(SRC, /document\.addEventListener\(\s*"click",\s*onPillAutohideClick,\s*true\s*\)/);
    assert.match(SRC, /window\.addEventListener\(\s*"keydown",\s*onPillAutohideKeyDown,\s*true\s*\)/);
    assert.match(SRC, /classifyPillAutohideGesture,\n\s*clearHoverHide,/);
    assert.doesNotMatch(SRC, /btn\.addEventListener\("click", \(event\) => \{[\s\S]{0,400}setPref\(BGALAZKA_EXT_PREFS\.HOVER_REVEAL_PANEL/);
  });

  test("4. cleanup removes every delegated gesture listener and pending hold", () => {
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
    assert.match(SRC, /registerCleanup\([\s\S]{0,500}clearPillAutohidePress/);
  });

  console.log(`OW-130 pill autohide gesture tests passed (${passed})`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
