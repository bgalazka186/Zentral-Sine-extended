"use strict";
/* OW-133: nothing takes the Notes sheet away while a platform popup still owns it.
 *
 * The bug: with a native picker (or dropdown) open, the panel's autohide folded the sheet, or a close dropped the
 * popover, and the platform popup was left anchored to a control that no longer existed. The window then ignored
 * every click. The fix has two halves, and this file checks both:
 *
 *   1. the deferral itself (`createDeferredTeardown`): one timer, one drain, each step isolated;
 *   2. every teardown entry point in the sheet: it asks the hold first, and it defers instead of acting — plus the
 *      general rule that ANY function which hides the sheet or takes its card out of the top layer asks the hold,
 *      so a teardown added later cannot quietly skip the guard.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { functionBlock, functionBlocks, markedBlock } = require("./helpers/source-blocks.cjs");

const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "additional/notes/ZentralNotes.uc.js"), "utf8");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

// ---- 1. the deferral, on its own ----
const DEFER_BLOCK = markedBlock(SRC, "// <<OW-133 DEFERRED TEARDOWN>>", "// <<OW-133 DEFERRED TEARDOWN END>>");
const makeDeferral = new Function(`${DEFER_BLOCK}\nreturn createDeferredTeardown;`)();

function deferralHarness({ alive = true, runAfter } = {}) {
  let nextId = 0;
  const timers = new Map();
  const errors = [];
  const state = { alive };
  const deferred = makeDeferral({
    win: {
      setTimeout: (fn, ms) => {
        const id = ++nextId;
        timers.set(id, { fn, ms });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    },
    alive: () => state.alive,
    warn: (error) => errors.push(error),
    ...(runAfter === undefined ? {} : { runAfter }),
  });
  const runAll = () => {
    for (const [id, timer] of [...timers]) {
      timers.delete(id);
      timer.fn();
    }
  };
  return { deferred, timers, errors, state, runAll };
}

test("deferred work runs in order, once, after the single timer", () => {
  const { deferred, timers, runAll } = deferralHarness();
  const order = [];
  deferred.defer(() => order.push("fold"));
  deferred.defer(() => order.push("close"));
  assert.equal(deferred.pending(), 2);
  assert.equal(deferred.armed(), true);
  assert.equal(timers.size, 1, "one timer for any number of steps");
  assert.deepEqual(order, [], "nothing runs while the popup still owns the sheet");
  runAll();
  assert.deepEqual(order, ["fold", "close"]);
  assert.equal(deferred.pending(), 0);
  assert.equal(deferred.armed(), false);
});

test("registering the same step twice runs it once", () => {
  const { deferred, runAll } = deferralHarness();
  let runs = 0;
  const step = () => runs++;
  deferred.defer(step);
  deferred.defer(step);
  runAll();
  assert.equal(runs, 1);
});

test("a step that throws does not skip the ones after it", () => {
  const { deferred, errors, runAll } = deferralHarness();
  const done = [];
  deferred.defer(() => {
    throw new Error("closeDialog exploded");
  });
  deferred.defer(() => done.push("after"));
  runAll();
  assert.deepEqual(done, ["after"]);
  assert.equal(errors.length, 1, "the failure is reported, not swallowed");
});

test("work queued for a sheet that is already gone is dropped", () => {
  const { deferred, state, runAll } = deferralHarness();
  let runs = 0;
  deferred.defer(() => runs++);
  state.alive = false;
  deferred.flush();
  runAll();
  assert.equal(runs, 0, "a destroyed sheet must not run teardown steps");
  assert.equal(deferred.pending(), 0);
});

test("cancel() drops the pending work and its timer (module teardown)", () => {
  const { deferred, timers } = deferralHarness();
  let runs = 0;
  deferred.defer(() => runs++);
  deferred.cancel();
  assert.equal(timers.size, 0);
  assert.equal(deferred.armed(), false);
  assert.doesNotThrow(() => deferred.flush());
  assert.equal(runs, 0);
});

test("deferring something that is not a function ignores it instead of blowing up later", () => {
  const { deferred, timers } = deferralHarness();
  assert.doesNotThrow(() => deferred.defer(null));
  assert.equal(deferred.pending(), 0);
  assert.equal(timers.size, 1, "the timer is still the caller's contract");
});

test("the drain delay is the bounded 120 ms, not a frame or a second", () => {
  const { deferred, timers } = deferralHarness();
  deferred.defer(() => {});
  assert.equal([...timers.values()][0].ms, 120);
  assert.equal(deferred.runAfter, 120);
});

// ---- 2. every entry point in the sheet ----
const SHEET = functionBlock(SRC, "createSheet").text;
const sheetStart = functionBlock(SRC, "createSheet").start;
const sheetFns = functionBlocks(SRC, sheetStart, sheetStart + SHEET.length);
const fn = (name) => sheetFns.find((entry) => entry.name === name);

test("the sheet's teardown entry points are all still where this test expects them", () => {
  for (const name of ["collapse", "foldWithParentPanel", "closeTopLayerForParentPanel", "close", "drop", "layout", "syncParentPanelHidden", "flushDeferredTeardown"]) {
    assert.ok(fn(name), `${name}() is still a named function in createSheet`);
  }
});

const GUARDED = ["collapse", "foldWithParentPanel", "closeTopLayerForParentPanel", "close"];

test("each involuntary teardown asks the hold before it changes anything", () => {
  const firstMutation = {
    collapse: /collapsed = true/,
    foldWithParentPanel: /foldedByParentPanel = true/,
    closeTopLayerForParentPanel: /for \(const step of/,
    close: /isOpen = false/,
  };
  for (const name of GUARDED) {
    const body = fn(name).text;
    const guard = body.indexOf("nativePopup.held()");
    assert.ok(guard >= 0, `${name}() must consult nativePopup.held()`);
    assert.ok(/deferTeardown\(/.test(body), `${name}() must defer through deferTeardown()`);
    const mutation = firstMutation[name].exec(body);
    assert.ok(mutation, `${name}() still changes ${name === "close" ? "isOpen" : "its own state"}`);
    assert.ok(guard < mutation.index, `${name}(): the hold is asked before the state changes`);
    assert.ok(guard < body.indexOf("deferTeardown("), `${name}(): the hold is asked before the deferral`);
  }
});

test("a deferral is never unconditional (the guard and the deferral live together)", () => {
  // `deferTeardown` itself is the plumbing both halves share; every caller asks the hold first.
  const offenders = sheetFns
    .filter((entry) => entry.name !== "deferTeardown" && entry.name !== "flushDeferredTeardown")
    .filter((entry) => /deferTeardown\(/.test(entry.text) && !/nativePopup\.held\(\)/.test(entry.text))
    .map((entry) => entry.name);
  assert.deepEqual(offenders, [], `these functions defer without asking the hold first: ${offenders.join(", ")}`);
});

test("close() is exempt only for a module that is being destroyed", () => {
  const body = fn("close").text;
  assert.match(body, /if \(!destroying && nativePopup\.held\(\)\) return deferTeardown\(close\);/, "an unloading window has nothing left to protect");
});

test("drop() never hides the popover that owns an open platform popup", () => {
  const body = fn("drop").text;
  const guard = body.indexOf("nativePopup.held()");
  assert.ok(guard >= 0, "drop() consults the hold");
  assert.ok(guard < body.indexOf("topLayer = false"), "the hold is asked before topLayer is cleared");
  assert.ok(/localName === "select"/.test(body), "the older <select> rule is still there");
});

test("a suspended layout defers the card teardown instead of hiding it under the popup", () => {
  const body = fn("layout").text;
  assert.ok(/deferTeardown\(/.test(body), "layout() defers the closeDialog of a suspended sheet");
  assert.ok(/nativePopup\.held\(\)/.test(body), "and asks the hold first");
});

test("no teardown step is left unguarded next to the isolated loop", () => {
  const bare = /(^|\n)\s*(closeMenu|closeDialog)\(\);/;
  for (const name of [...GUARDED, "flushDeferredTeardown"]) {
    assert.doesNotMatch(fn(name).text.replace(/^\s*\/\/.*$/gm, ""), bare, `${name}(): call the steps through the isolated loop, not one after the other`);
  }
});

test("every teardown entry point isolates its steps (one throw cannot skip the rest)", () => {
  for (const name of [...GUARDED, "flushDeferredTeardown"]) {
    const body = fn(name).text;
    const loop = /for \(const step of \[closeMenu, closeDialog\]\) \{\s*try \{\s*step\(\);\s*\} catch \(error\) \{\s*warn\(error\);\s*\}\s*\}/.test(body);
    const factory = SHEET.includes("createDeferredTeardown(") && name === "flushDeferredTeardown";
    if (factory) {
      // flushDeferredTeardown delegates to the factory, whose own drain is tested above.
      assert.match(body, /deferredTeardown\.flush\(\)/);
      continue;
    }
    assert.ok(loop, `${name}() runs closeMenu/closeDialog through the try/catch loop`);
  }
});

test("the universal rule: anything that hides the sheet or drops its card asks the hold first", () => {
  // A teardown added later (a new card, a new collapse path) is caught here without being named: hiding what a
  // platform popup is anchored to is exactly what leaves the platform grab behind.
  const hides = /(root\.hidden = true|root\.dataset\.collapsed = "true"|topLayer = false)/;
  // A `catch` body that clears `topLayer` is a raise that failed, not a surface being taken away (raise() re-shows the
  // card, it never leaves it hidden), so the rule looks at the body outside those blocks.
  const body = (entry) => entry.text.replace(/catch\s*(?:\([\w\s]*\))?\s*\{[^{}]*\}/g, "");
  const hiding = sheetFns.filter((entry) => hides.test(body(entry))).map((entry) => entry.name);
  const offenders = sheetFns.filter((entry) => hides.test(body(entry)) && !/nativePopup\.held\(\)/.test(entry.text)).map((entry) => entry.name);
  assert.deepEqual(offenders, [], `these functions hide the sheet or its top-layer card without asking the hold: ${offenders.join(", ")}`);
  // The rule must stay awake: if the scan stops finding the known hiders, the check above proves nothing.
  assert.deepEqual([...new Set(hiding)].sort(), ["close", "collapse", "drop", "foldWithParentPanel"], `the marker scan no longer sees the known hiders: ${hiding.join(", ")}`);
});

test("the parent panel's own hide covers every autohide trigger", () => {
  const body = fn("syncParentPanelHidden").text;
  assert.match(body, /hideTrigger\(\) === "leave"\) foldWithParentPanel\(\)/, "hover autohide still folds with the panel");
  assert.match(body, /else if \(parentHidden\) closeTopLayerForParentPanel\(\)/, 'the "click" (and any other) trigger must not leave a top-layer card over a hidden panel');
  assert.match(body, /else restoreFromParentPanel\(\)/);
});

test("the panel-grown guard is the same rule as the sheet's: no teardown under an open platform popup", () => {
  const hover = fs.readFileSync(path.join(ROOT, "extension/panels/interaction/ZentralPanelHover.js"), "utf8");
  assert.match(hover, /hasAttribute\("bgalazka-native-popup-open"\)/, "the panel's hover guard reads the hold's attribute");
});

console.log(`\n${passed} checks passed`);
