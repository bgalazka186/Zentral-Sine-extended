"use strict";
/* OW-133: the native-popup hold, tested on its own.
 *
 * The hold is the whole defence against a platform popup that outlives the surface it was opened from: while it is
 * engaged, every involuntary teardown in the sheet waits, and the panel's hover guard reads the published attribute
 * so it does not slide away underneath the popup. That only works if the hold itself is honest:
 *   - it refuses anything that is not a platform-popup control (a plain button must not pin a panel),
 *   - it is bounded by NATIVE_POPUP_HOLD_MS whatever a caller passes, and expires on its own,
 *   - engaging twice refreshes one deadline instead of stacking timers,
 *   - `releaseSoon` coalesces (a picker reports itself several ways; the work must still run once),
 *   - `onRelease` work runs exactly once, and never twice,
 *   - `release()` cancels its timers, so nothing fires into a destroyed sheet.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { markedBlock } = require("./helpers/source-blocks.cjs");
const makeFakeDom = require("./helpers/fake-dom.cjs");

const { El } = makeFakeDom();

const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "additional/notes/ZentralNotes.uc.js"), "utf8");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

// ---- the block under test, extracted from the module ----
const BLOCK = markedBlock(SRC, "// <<OW-133 NATIVE POPUP HOLD>>", "// <<OW-133 NATIVE POPUP HOLD END>>");
const OWNS_CLOSURE = new Function(
  "document",
  "window",
  "Date",
  `${BLOCK}\nreturn { createNativePopupHold, nativePopupControl, NATIVE_POPUP_CONTROL, NATIVE_POPUP_ATTR, NATIVE_POPUP_HOLD_MS, NATIVE_POPUP_SETTLE_MS };`,
);

function clock(start = 1000) {
  let now = start;
  let nextId = 0;
  const timers = new Map();
  return {
    Date: { now: () => now },
    setTimer(fn, ms) {
      const id = ++nextId;
      timers.set(id, { fn, at: now + Number(ms) || now });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = target;
    },
    get now() {
      return now;
    },
    get pending() {
      return timers.size;
    },
    delays: [],
  };
}

function harness({ holdMs } = {}) {
  const fake = clock();
  const doc = { documentElement: new El("html") };
  const mod = OWNS_CLOSURE(doc, { setTimeout: () => 0 }, fake.Date);
  const hold = mod.createNativePopupHold({
    doc,
    win: {},
    setTimer: (fn, ms) => {
      fake.delays.push(ms);
      return fake.setTimer(fn, ms);
    },
    clearTimer: (id) => fake.clearTimer(id),
    ...(holdMs ? { holdMs } : {}),
  });
  return { hold, fake, doc, mod };
}

const picker = () => {
  const el = new El("input");
  el.setAttribute("type", "color");
  return el;
};

test("the selector names every control that can raise a platform popup", () => {
  const { mod } = harness();
  for (const type of ["color", "date", "time", "datetime-local", "month", "week", "file"]) assert.ok(mod.NATIVE_POPUP_CONTROL.includes(`input[type="${type}"]`), type);
  assert.ok(mod.NATIVE_POPUP_CONTROL.includes("select"), "a native dropdown takes the pointer the same way");
  assert.ok(mod.NATIVE_POPUP_CONTROL.includes("input[list]"), "a datalist popup is platform-drawn too");
  assert.ok(mod.NATIVE_POPUP_HOLD_MS > 0 && mod.NATIVE_POPUP_HOLD_MS <= 60000, "the hold is a bounded wait, not a pin");
  assert.equal(mod.NATIVE_POPUP_ATTR, "bgalazka-native-popup-open", "the panel's guard reads this exact attribute");
});

test("nativePopupControl only matches a control, never a plain element or text", () => {
  const { mod } = harness();
  const button = new El("button");
  const span = new El("span");
  assert.equal(mod.nativePopupControl(button), null);
  assert.equal(mod.nativePopupControl(span), null);
  assert.equal(mod.nativePopupControl(null), null);
  assert.equal(mod.nativePopupControl({}), null, "a non-node (an event target stub) is not a crash");
  assert.equal(mod.nativePopupControl(Object.assign({ nodeType: 1 }, {})), null, "a node without closest() is not a crash");
  const colour = picker();
  assert.equal(mod.nativePopupControl(colour), colour);
  const select = new El("select");
  assert.equal(mod.nativePopupControl(select), select);
});

test("engaging a control publishes the attribute and holds; engaging anything else does nothing", () => {
  const { hold, doc } = harness();
  assert.equal(hold.held(), false);
  assert.equal(hold.engage(new El("button")), false, "a plain button cannot pin the sheet");
  assert.equal(doc.documentElement.hasAttribute("bgalazka-native-popup-open"), false);
  assert.equal(hold.engage(picker()), true);
  assert.equal(hold.held(), true);
  assert.equal(doc.documentElement.getAttribute("bgalazka-native-popup-open"), "true");
});

test("the hold expires on its own and takes the attribute with it", () => {
  const { hold, doc, fake, mod } = harness({ holdMs: 500 });
  hold.engage(picker());
  fake.advance(400);
  assert.equal(hold.held(), true, "still inside the hold");
  fake.advance(200);
  assert.equal(hold.held(), false, "the hold ends without anyone reporting back");
  assert.equal(doc.documentElement.hasAttribute("bgalazka-native-popup-open"), false);
  assert.equal(fake.pending, 0, `no timer survives the expiry (${mod.NATIVE_POPUP_HOLD_MS} ms cap)`);
});

test("a caller cannot pin the panel: any deadline is clamped to NATIVE_POPUP_HOLD_MS", () => {
  const { hold, fake, mod } = harness();
  hold.engage(picker(), 10 * 60 * 1000);
  assert.ok(Math.max(...fake.delays) <= mod.NATIVE_POPUP_HOLD_MS + 25, `scheduled ${Math.max(...fake.delays)} ms for a 10-minute request`);
  fake.advance(mod.NATIVE_POPUP_HOLD_MS + 100);
  assert.equal(hold.held(), false);
});

test("engaging twice refreshes one deadline instead of stacking timers", () => {
  const { hold, fake, doc } = harness({ holdMs: 300 });
  hold.engage(picker());
  fake.advance(200);
  hold.engage(picker());
  fake.advance(200);
  assert.equal(hold.held(), true, "the second engagement moved the deadline");
  assert.equal(fake.pending, 1, "one expiry timer at a time");
  fake.advance(200);
  assert.equal(hold.held(), false);
  assert.equal(doc.documentElement.hasAttribute("bgalazka-native-popup-open"), false);
});

test("releaseSoon coalesces: several reports, one drain", () => {
  const { hold, fake } = harness();
  let runs = 0;
  hold.onRelease(() => runs++);
  hold.engage(picker());
  assert.equal(hold.releaseSoon(), true);
  fake.advance(50);
  assert.equal(hold.releaseSoon(), true, "a second report within the settle turn is absorbed");
  fake.advance(50);
  assert.equal(runs, 0, "the release waits for one settle turn");
  fake.advance(1000);
  assert.equal(runs, 1);
  assert.equal(hold.held(), false);
});

test("releaseSoon on an idle hold releases immediately instead of arming a timer", () => {
  const { hold, fake } = harness();
  let runs = 0;
  hold.onRelease(() => runs++);
  assert.equal(hold.releaseSoon(), false);
  assert.equal(fake.pending, 0);
  fake.advance(5000);
  assert.equal(runs, 0, "nothing was waiting, so nothing runs");
});

test("the work registered with onRelease runs exactly once, whatever the number of release signals", () => {
  const { hold, fake, doc } = harness();
  const order = [];
  hold.onRelease(() => order.push("first"));
  hold.onRelease(() => order.push("second"));
  hold.engage(picker());
  hold.release();
  hold.release();
  fake.advance(5000);
  assert.deepEqual(order, ["first", "second"], "in registration order");
  assert.equal(doc.documentElement.hasAttribute("bgalazka-native-popup-open"), false);
});

test("one failing step does not stop the others (a bad teardown cannot strand the sheet)", () => {
  const { hold } = harness();
  const done = [];
  hold.onRelease(() => {
    throw new Error("boom");
  });
  hold.onRelease(() => done.push("second"));
  hold.engage(picker());
  assert.doesNotThrow(() => hold.release());
  assert.deepEqual(done, ["second"]);
});

test("release() clears its timers, so nothing fires into a torn-down sheet", () => {
  const { hold, fake } = harness();
  hold.engage(picker());
  hold.releaseSoon();
  assert.equal(fake.pending, 2, "an expiry and a settle timer were armed");
  hold.release();
  assert.equal(fake.pending, 0, "both are cancelled");
  assert.doesNotThrow(() => fake.advance(10 * 60 * 1000));
  assert.equal(hold.held(), false);
});

test("the attribute is only touched when the published state actually changes", () => {
  const { hold, doc } = harness();
  let writes = 0;
  const el = doc.documentElement;
  const set = el.setAttribute.bind(el);
  const remove = el.removeAttribute.bind(el);
  el.setAttribute = (k, v) => {
    if (k === "bgalazka-native-popup-open") writes++;
    return set(k, v);
  };
  el.removeAttribute = (k) => {
    if (k === "bgalazka-native-popup-open") writes++;
    return remove(k);
  };
  hold.engage(picker());
  hold.engage(picker());
  hold.engage(picker());
  assert.equal(writes, 1, "three interactions, one write");
  hold.release();
  hold.release();
  assert.equal(writes, 2, "one removal");
});

test("a document without a documentElement cannot crash the hold", () => {
  const fake = clock();
  const mod = OWNS_CLOSURE({ documentElement: null }, {}, fake.Date);
  const hold = mod.createNativePopupHold({ doc: {}, win: {}, setTimer: (fn, ms) => fake.setTimer(fn, ms), clearTimer: (id) => fake.clearTimer(id) });
  assert.doesNotThrow(() => hold.engage(picker()));
  assert.equal(hold.held(), true);
  assert.doesNotThrow(() => hold.release());
});

console.log(`\n${passed} checks passed`);
