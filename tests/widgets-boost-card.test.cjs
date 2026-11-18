"use strict";
/* OW-90, live: the Boost card in the fake sidebar.
 *
 * The pure tests pin the words and the rules. This file proves the wiring the plan asked for:
 *   - a plain click calls `runLevel1` exactly once, and the toast says what was freed;
 *   - a second click while the first run settles does not stack a second run;
 *   - the arrow opens the menu, the menu's only working entry runs the light pass, and the greyed entries are
 *     disabled (part three has not shipped);
 *   - the tray's `pause_when_hidden` is what the shell already does, so nothing new is asserted about it here;
 *   - destroying the shell unsubscribes from the module, so no callback outlives the card. */
const assert = require("node:assert/strict");
const { createFakeSidebarHarness } = require("./helpers/fake-widgets-harness.cjs");

const BASE = {
  "zen.workspace.zentral.widgets.enabled": true,
  "zen.workspace.zentral.widgets.clock.enabled": false,
  "zen.workspace.zentral.widgets.date.enabled": false,
  "zen.workspace.zentral.widgets.weather.enabled": false,
  "zen.workspace.zentral.widgets.boost.enabled": true,
};

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A stand-in for `additional/boost/`: the card's only contract with it is `runLevel1`, `onChange` and `lastMB`.
function makeBoostModule({ freedMB = 240, beforeMB = 900 } = {}) {
  const calls = { runLevel1: 0, startSampling: 0, stopSampling: 0 };
  const listeners = new Set();
  let resolvePending = null;
  const module = {
    calls,
    lastValue: beforeMB,
    runLevel1() {
      calls.runLevel1 += 1;
      // A promise the test resolves, so "a second click while it runs" is a real state and not a race.
      return new Promise((resolve) => {
        resolvePending = () => {
          const result = { beforeMB, afterMB: beforeMB - freedMB, freedMB, by: "minimize" };
          module.lastValue = result.afterMB;
          for (const fn of [...listeners]) fn(module.lastValue);
          resolve(result);
        };
      });
    },
    finishRun() {
      const done = resolvePending;
      resolvePending = null;
      done?.();
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    listenerCount: () => listeners.size,
    lastMB: () => module.lastValue,
    memoryMB: () => module.lastValue,
    startSampling() { calls.startSampling += 1; },
    stopSampling() { calls.stopSampling += 1; },
  };
  return module;
}

function fire(el, type, extra = {}) {
  for (const [t, fn] of [...(el._listeners || [])]) {
    if (t === type) fn({ type, target: el, preventDefault() {}, stopPropagation() {}, ...extra });
  }
}

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("the card shows the module's reading and follows it", async () => {
  const h = createFakeSidebarHarness({ ...BASE });
  const boost = makeBoostModule();
  boost.lastValue = 512;
  h.window.ZentralBoost = boost;
  const { api } = h.start();
  await tick(50);
  const card = api.getTray().children.find((el) => el.getAttribute("data-zw-widget") === "boost");
  assert.ok(card, "the Boost card is mounted");
  const value = card.querySelector(".zw-boost-value");
  assert.equal(value.textContent, "512 MB", "the number the module already knew");
  api.destroy();
});

test("a click runs Level 1 once and toasts what was freed", async () => {
  const h = createFakeSidebarHarness({ ...BASE });
  const boost = makeBoostModule({ freedMB: 240, beforeMB: 900 });
  h.window.ZentralBoost = boost;
  const { api } = h.start();
  await tick(50);
  const card = api.getTray().children.find((el) => el.getAttribute("data-zw-widget") === "boost");
  const body = card.querySelector(".zw-boost");
  fire(body, "click");
  assert.equal(boost.calls.runLevel1, 1, "one click, one pass");
  // A second click while the first settles must not start another.
  fire(body, "click");
  assert.equal(boost.calls.runLevel1, 1, "the card refuses a second run while one is in flight");
  boost.finishRun();
  await tick(30);
  const toast = api.getTray().querySelector(".zw-toast");
  assert.ok(toast, "a toast line exists");
  assert.equal(toast.hidden, false, "and it is shown");
  assert.equal(toast.textContent, "Freed 240 MB", "with the number the module measured");
  assert.equal(toast.getAttribute("role"), "status", "announced, not shouted");
  // The number follows the module's own callback.
  assert.equal(body.querySelector(".zw-boost-value").textContent, "660 MB", "and the card shows the new reading");
  api.destroy();
});

test("the menu offers what the build can really do, and greys the rest", async () => {
  const h = createFakeSidebarHarness({ ...BASE });
  // A module with the policy (so deep works) but nothing asleep (so Restore is greyed with its reason).
  const boost = makeBoostModule();
  boost.state = () => ({ policy: true, undoSize: 0 });
  boost.calls.runLevel2 = 0;
  boost.runLevel2 = async () => { boost.calls.runLevel2 += 1; return { by: "level2", freedMB: 10, unloaded: { tabs: 3, panels: 0 } }; };
  boost.restore = () => ({ panels: 0, tabs: 0 });
  h.window.ZentralBoost = boost;
  const { api } = h.start();
  await tick(50);
  const card = api.getTray().children.find((el) => el.getAttribute("data-zw-widget") === "boost");
  const body = card.querySelector(".zw-boost");
  const popup = body.querySelector(".zw-boost-popup");
  const arrow = body.querySelector(".zw-boost-menu-btn");
  assert.equal(popup.hidden, true, "closed until asked");
  fire(arrow, "click");
  assert.equal(popup.hidden, false, "the arrow opens it");
  assert.equal(arrow.getAttribute("aria-expanded"), "true", "and says so");
  const items = popup.querySelectorAll(".zw-boost-menu-item");
  assert.equal(items.length, 3, "light, deep and restore");
  assert.equal(items[0].disabled, false, "the light pass works");
  assert.equal(items[1].disabled, false, "OW-91 made the deep pass real");
  assert.equal(items[2].disabled, true, "nothing is asleep yet, so there is nothing to restore");
  // The deep entry runs the deep pass, and the toast says what went to sleep.
  fire(items[1], "click");
  assert.equal(popup.hidden, true, "choosing a command closes the menu");
  await tick(30);
  assert.equal(boost.calls.runLevel2, 1, "the deep pass ran once");
  const toast = api.getTray().querySelector(".zw-toast");
  assert.equal(toast.textContent, "Put 3 tab(s) and 0 panel(s) to sleep, freed 10 MB");
  // The arrow again: Restore is offered as soon as the module reports something asleep.
  boost.state = () => ({ policy: true, undoSize: 3 });
  fire(arrow, "click");
  const after = popup.querySelectorAll(".zw-boost-menu-item");
  assert.equal(after[2].disabled, false, "three things asleep is three to wake");
  assert.equal(after[2].textContent, "Restore (3)");
  fire(after[2], "click");
  await tick(20);
  api.destroy();
});

test("Escape closes the menu, and so does a click outside it", async () => {
  const h = createFakeSidebarHarness({ ...BASE });
  h.window.ZentralBoost = makeBoostModule();
  const { api } = h.start();
  await tick(50);
  const card = api.getTray().children.find((el) => el.getAttribute("data-zw-widget") === "boost");
  const body = card.querySelector(".zw-boost");
  const popup = body.querySelector(".zw-boost-popup");
  fire(body.querySelector(".zw-boost-menu-btn"), "click");
  assert.equal(popup.hidden, false);
  h.fireDoc("keydown");
  // A key the card does not use leaves it alone.
  assert.equal(popup.hidden, false, "a random key does not close it");
  h.fireDoc("keydown", { key: "Escape" });
  assert.equal(popup.hidden, true, "Escape closes it");
  // And so does a pointer press anywhere else on the page.
  fire(body.querySelector(".zw-boost-menu-btn"), "click");
  assert.equal(popup.hidden, false, "opened again");
  h.fireDoc("pointerdown", { target: h.docRoot });
  assert.equal(popup.hidden, true, "a click elsewhere closes it");
  api.destroy();
});

test("the card unsubscribes when the shell is destroyed", async () => {
  const h = createFakeSidebarHarness({ ...BASE });
  const boost = makeBoostModule();
  h.window.ZentralBoost = boost;
  const { api } = h.start();
  await tick(50);
  assert.equal(boost.listenerCount(), 1, "one subscription while the card is mounted");
  api.destroy();
  await tick(20);
  assert.equal(boost.listenerCount(), 0, "and none after the shell goes away");
});

test("the card keeps working when the module is missing", async () => {
  const h = createFakeSidebarHarness({ ...BASE });
  // No `window.ZentralBoost` at all: the card must draw a dash and refuse to run, never throw.
  const { api } = h.start();
  await tick(50);
  const card = api.getTray().children.find((el) => el.getAttribute("data-zw-widget") === "boost");
  assert.ok(card, "the card is still mounted");
  const body = card.querySelector(".zw-boost");
  assert.equal(body.querySelector(".zw-boost-value").textContent, "\u2014", "no reading is a dash");
  fire(body, "click");
  await tick(20);
  assert.equal(api.getTray().querySelector(".zw-toast")?.hidden ?? true, true, "and no toast pretends something happened");
  api.destroy();
});

test("the retired Status card is never mounted", async () => {
  const h = createFakeSidebarHarness({ ...BASE, "zen.workspace.zentral.widgets.status.enabled": true });
  h.window.ZentralBoost = makeBoostModule();
  const { api } = h.start();
  await tick(50);
  const ids = api.getTray().children.map((el) => el.getAttribute("data-zw-widget"));
  assert.deepEqual(ids, ["boost"], "only Boost, even with the old pref switched on");
  api.destroy();
});

(async () => {
  for (const [name, fn] of tests) {
    await fn();
    passed++;
    console.log("ok -", name);
  }
  console.log(`\nPASS widgets-boost-card (${passed} tests)`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
