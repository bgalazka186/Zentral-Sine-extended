"use strict";
/* OW-100: "remove dragging elements from widgets, they dont do anything."
 *
 * The card handle was a `draggable="true"` button painted with a grab cursor. In Zen's sidebar the HTML5 drag never
 * moved a card: the cursor promised a reorder and the drop did nothing. A control that offers an action and then does
 * not perform it is worse than no control at all, so the promise is gone: the handle is a plain button whose click opens
 * a real Move menu (up / down, each disabled at the ends), and Alt+Up / Alt+Down still work from the keyboard. Every row
 * writes the one order pref through the one function, so the menu and the keyboard cannot disagree.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createFakeSidebarHarness, widgetCss: CSS } = require("./helpers/fake-widgets-harness.cjs");

const root = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(root, "additional/widgets/ZentralWidgets.uc.js"), "utf8");

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("ok - " + name); }
  catch (err) { failed++; console.error("FAIL:", name, "\n ", err && err.stack ? err.stack : err); }
}
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

const BASE = {
  "zen.workspace.zentral.widgets.enabled": true,
  "zen.workspace.zentral.widgets.clock.enabled": true,
  "zen.workspace.zentral.widgets.date.enabled": true,
  "zen.workspace.zentral.widgets.weather.enabled": false,
  "zen.workspace.zentral.widgets.boost.enabled": false,
};

const fire = (el, type, extra = {}) => {
  const base = { preventDefault() {}, stopPropagation() {}, ...extra };
  for (const [t, fn] of el._listeners || []) if (t === type) fn(base);
};

const cardsOf = (api) => [...api.getTray().children];
const idsOf = (api) => cardsOf(api).map((el) => el.getAttribute("data-zw-widget"));

(async () => {
  await test("no widget source advertises a drag any more", async () => {
    assert.ok(!/setAttribute\(\s*"draggable"/.test(SRC), "nothing sets draggable on a card or its handle");
    assert.ok(!/addEventListener\(\s*"dragstart"/.test(SRC), "and nothing listens for a drag start that cannot happen");
    assert.ok(!/addEventListener\(\s*"drop"/.test(SRC), "nor for a drop");
    assert.ok(!/data-zw-dragging/.test(CSS), "the CSS no longer has a dragging state to paint");
  });

  await test("the handle shows a pointer, not a grab, and is not disabled while there is somewhere to move", async () => {
    assert.ok(/\.zw-grip\s*\{[^}]*cursor:\s*pointer/s.test(CSS), "the handle's cursor is a pointer — a button, not a drag surface");
    assert.ok(!/\.zw-grip\s*\{[^}]*cursor:\s*grab/s.test(CSS), "no grab cursor survives on the handle");
    assert.ok(!/grabbing/.test(CSS), "and no grabbing state either");

    const h = createFakeSidebarHarness(BASE);
    const { api } = h.start();
    await tick(60);
    const grips = cardsOf(api).map((c) => c.querySelector(".zw-grip"));
    assert.equal(grips.filter(Boolean).length, 2, "every card still has its handle");
    for (const grip of grips) {
      assert.equal(grip.getAttribute("draggable"), null, "the handle does not claim to be draggable");
      assert.equal(grip.getAttribute("disabled"), null, "with two cards, neither handle is dead");
    }
    api.destroy();
  });

  await test("clicking the handle opens a Move menu, and its rows really move the card", async () => {
    const h = createFakeSidebarHarness(BASE);
    const { api } = h.start();
    await tick(60);
    assert.deepEqual(idsOf(api), ["clock", "date"], "the default order");
    const clockCard = cardsOf(api).find((c) => c.getAttribute("data-zw-widget") === "clock");
    const grip = clockCard.querySelector(".zw-grip");

    fire(grip, "click");
    const menu = clockCard.querySelector(".zw-grip-menu");
    assert.ok(menu, "the click opens a menu; it does nothing else, and nothing else is promised");
    const rows = [...menu.children];
    assert.deepEqual(rows.map((r) => r.textContent), ["Move this widget up", "Move this widget down"],
      "the menu offers the two moves that exist");
    assert.equal(rows[0].getAttribute("disabled"), "true", "the first card cannot move up, and the row says so instead of doing nothing");

    fire(rows[1], "click");
    await tick(60); h.flushRaf();
    assert.deepEqual(idsOf(api), ["date", "clock"], "the row moved the card, and the tray followed");
    assert.match(h.prefs.get("zen.workspace.zentral.widgets.order"), /^date,clock/, "through the one order pref");
    assert.equal(clockCard.querySelector(".zw-grip-menu"), null, "and the menu closed after the move");
    api.destroy();
  });

  await test("the last card cannot move down, and its menu row is disabled", async () => {
    const h = createFakeSidebarHarness(BASE);
    const { api } = h.start();
    await tick(60);
    const dateCard = cardsOf(api).find((c) => c.getAttribute("data-zw-widget") === "date");
    fire(dateCard.querySelector(".zw-grip"), "click");
    const rows = [...dateCard.querySelector(".zw-grip-menu").children];
    assert.equal(rows[1].getAttribute("disabled"), "true", "the card at the bottom offers no move down");
    assert.equal(rows[0].getAttribute("disabled"), null, "but it can move up");
    api.destroy();
  });

  await test("a lone widget is not offered a move it cannot make", async () => {
    const h = createFakeSidebarHarness({ ...BASE, "zen.workspace.zentral.widgets.date.enabled": false });
    const { api } = h.start();
    await tick(60);
    assert.deepEqual(idsOf(api), ["clock"], "one card");
    const grip = cardsOf(api)[0].querySelector(".zw-grip");
    assert.equal(grip.getAttribute("disabled"), "true", "the handle is disabled rather than opening a menu of two dead rows");
    api.destroy();
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
