"use strict";
/* Cross-feature regression sweep after the batched OW-124 / OW-127..OW-132 work.
 * These tests are deliberately small and independent: pure helpers, the fake
 * widget Clock, a real extracted pill-gesture runtime, settings surfaces and
 * generated-source contracts. No live Zen/Sine behavior is claimed. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const SRC = {
  widgets: read("additional/widgets/ZentralWidgets.uc.js"),
  notes: read("additional/notes/ZentralNotes.uc.js"),
  hover: read("extension/panels/interaction/ZentralPanelHover.js"),
};
const { createFakeSidebarHarness } = require("./helpers/fake-widgets-harness.cjs");
const core = createFakeSidebarHarness().core;
const plain = (v) => JSON.parse(JSON.stringify(v));

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`ok - ${name}`);
}

function gestureRuntime() {
  const start = SRC.hover.indexOf("function classifyPillAutohideGesture");
  const end = SRC.hover.indexOf("      function ensurePillHoverRevealButton()");
  assert.ok(start >= 0 && end > start, "the gesture block is bounded and extractable");
  const block = SRC.hover.slice(start, end);

  let now = 1000;
  let nextTimer = 0;
  const timers = new Map();
  const fakeDate = { now: () => now };
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

  const makeEmitter = () => ({
    listeners: [],
    addEventListener(type, fn) { this.listeners.push({ type, fn }); },
    removeEventListener(type, fn) { this.listeners = this.listeners.filter((l) => !(l.type === type && l.fn === fn)); },
    fire(type, extra = {}) {
      const ev = {
        type,
        button: 0,
        isTrusted: true,
        target: target,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.stopped = true; },
        stopImmediatePropagation() { this.immediateStopped = true; },
        ...extra,
      };
      for (const l of [...this.listeners]) if (l.type === type) l.fn(ev);
      return ev;
    },
  });

  const target = {
    attrs: new Map(),
    closest(selector) { return selector === "#zen-app-hover-reveal-btn" ? this : null; },
    setAttribute(k, v) { this.attrs.set(k, String(v)); },
    removeAttribute(k) { this.attrs.delete(k); },
    getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; },
  };
  const outside = { closest: () => null };
  const document = makeEmitter();
  const window = makeEmitter();
  let hiddenCalls = 0;
  let toggleCalls = 0;
  let pref = false;

  // The extracted block is intentionally not copied into the test: it runs the
  // shipped gesture code with fake DOM, clock and preference seams.
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    "document", "window", "Date", "setTimeout", "clearTimeout",
    "BGALAZKA_EXT_PREFS", "getPref", "setPref", "syncHoverPanelAvailability",
    "clearHoverHide", "setHoverPanelHidden", "PILL_AUTOHIDE_HOLD_MS", "PILL_AUTOHIDE_SELECTOR",
    block + `
      return {
        classifyPillAutohideGesture,
        onPillAutohideDown, onPillAutohideUp, onPillAutohideMove,
        onPillAutohideCancel, onPillAutohideClick, onPillAutohideKeyDown,
        removePillAutohideListeners,
        get press() { return pillAutohidePress; },
        get consumed() { return pillAutohideConsumedClick; },
      };
    `,
  );
  const runtime = factory(
    document,
    window,
    fakeDate,
    fakeSetTimeout,
    fakeClearTimeout,
    { HOVER_REVEAL_PANEL: "zen.workspace.zentral.panels.autohide" },
    (_k, fallback) => (fallback === undefined ? pref : fallback),
    (_k, v) => { pref = v; toggleCalls++; },
    () => {},
    () => {},
    (hidden) => { if (hidden) hiddenCalls++; },
    550,
    "#zen-app-hover-reveal-btn",
  );
  return { runtime, document, window, target, outside, advance, state: () => ({ hiddenCalls, toggleCalls, pref }) };
}

 (async () => {
try {
  await test("1. every batched pure helper and settings row stays exported together", () => {
    for (const name of [
      "cleanWidgetSpacePolicy", "planWidgetSpace", "clockQuickNoteVisibility",
      "readWeatherRainSeries", "weatherRainPlan", "weatherRainText",
    ]) assert.equal(typeof core[name], "function", name + " is exported");
    const notesCore = (() => {
      const vm = require("node:vm");
      const dom = require("./helpers/fake-dom.cjs")();
      const win = { document: dom.document, ZentralRuntime: { register() {} }, __zentralNotesTestSeam: {} };
      win.window = win;
      vm.runInNewContext(SRC.notes, {
        window: win, document: dom.document,
        globalThis: { window: win, document: dom.document, Services: {} },
        ChromeUtils: {}, console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, WeakMap, WeakSet, Symbol, Reflect,
        setTimeout, clearTimeout,
      });
      return win.__zentralNotesTestSeam.core;
    })();
    for (const name of ["cleanSidebarLabelRoads", "demoNoteColorPlan"]) {
      assert.equal(typeof notesCore[name], "function", name + " is exported");
    }
    const settings = JSON.parse(read("additional/widgets/settings.json"));
    const layout = JSON.parse(read("extension/settings/layout.json"));
    for (const pref of ["zen.workspace.zentral.widgets.space_priority", "zen.workspace.zentral.widgets.space_scroll"]) {
      assert.ok(settings.schema.some((row) => row.property === pref), pref + " schema row");
      assert.ok(layout.order.includes(pref), pref + " layout row");
    }
  });

  await test("2. no-pressure widget planning preserves the displayed order, not the priority list", () => {
    const defs = [{ id: "date" }, { id: "clock" }, { id: "weather" }];
    const policy = core.cleanWidgetSpacePolicy("clock,date", "weather", ["clock", "date", "weather"]);
    const plan = plain(core.planWidgetSpace(defs, policy, { pressure: false, maxHeight: 1000, minHeight: 48 }));
    assert.deepEqual(plan.visible, ["date", "clock", "weather"], "display order wins when there is room");
    assert.equal(plan.spaceMode, "all");
    assert.deepEqual(plan.never, []);
    const pressure = plain(core.planWidgetSpace(defs, policy, { pressure: true, maxHeight: 48, minHeight: 48 }));
    assert.equal(pressure.visible[0], "clock", "priority wins under pressure");
    assert.equal(pressure.never.includes("weather"), false, "weather remains scroll-reachable");
  });

  await test("3. daily fallback never confuses precipitation hours with heavy-rain intensity", () => {
    const T0 = Date.UTC(2026, 10, 18, 9, 0, 0) / 1000;
    const payload = {
      timezone: "UTC",
      utc_offset_seconds: 0,
      current: { time: T0, temperature_2m: 8, relative_humidity_2m: 70, weather_code: 3, wind_speed_10m: 4 },
      daily: {
        time: [T0, T0 + 86400, T0 + 2 * 86400],
        weather_code: [61, 3, 3],
        temperature_2m_max: [9, 8, 7],
        temperature_2m_min: [2, 1, 0],
        precipitation_probability_max: [90, 5, 5],
        precipitation_hours: [9, 0, 0],
        snowfall_sum: [0, 0, 0],
      },
    };
    const value = core.readWeatherPayload(payload, "metric", "en");
    const plan = plain(core.weatherRainPlan(value, { lang: "en", nowMs: T0 * 1000 }));
    assert.equal(plan.source, "daily");
    assert.equal(plan.heavy, false, "9 hours of WMO 61 light rain is not 3 mm/h heavy rain");
    assert.equal(plan.allDay, true);
    assert.doesNotMatch(plan.long, /heavy rain/);
    assert.equal(plan.noRainText, "No rain this week");

    const heavyPayload = plain(payload);
    heavyPayload.daily.weather_code = [65, 3, 3];
    heavyPayload.daily.precipitation_hours = [0, 0, 0];
    const heavyPlan = plain(core.weatherRainPlan(core.readWeatherPayload(heavyPayload, "metric", "en"), {
      lang: "en",
      nowMs: T0 * 1000,
    }));
    assert.equal(heavyPlan.source, "daily");
    assert.equal(heavyPlan.heavy, true, "WMO 65 still marks genuine heavy rain without hourly intensity");
    assert.match(heavyPlan.long, /heavy rain/);
  });

  await test("4. OW-129 Save closes the chevron when the Notes opener disappears", async () => {
    const h = createFakeSidebarHarness({
      "zen.workspace.zentral.widgets.enabled": true,
      "zen.workspace.zentral.widgets.clock.enabled": true,
      "zen.workspace.zentral.widgets.date.enabled": false,
    }, { notes: true });
    const { api } = h.start();
    await new Promise((r) => setTimeout(r, 40));
    const clock = api.getTray().children.find((el) => el.getAttribute("data-zw-widget") === "clock");
    const body = clock.querySelector(".zw-clock");
    const toggle = body.querySelector(".zw-clock-note-toggle");
    const row = body.querySelector(".zw-clock-note-row");
    const field = body.querySelector(".zw-clock-note");
    const save = body.querySelector(".zw-clock-note-btn");
    const click = (el) => {
      for (const [type, fn] of [...(el._listeners || el.listeners || [])]) {
        if (type === "click") fn({ type: "click", stopPropagation() {}, preventDefault() {} });
      }
    };
    click(toggle);
    assert.equal(row.hidden, false, "the row is open before Save");
    field.value = "Orphaned note";
    delete h.window[Symbol.for("zentral/notes-calendar-opener/v1")];
    click(save);
    assert.equal(row.hidden, true, "an unavailable opener cannot leave the row open");
    assert.equal(toggle.hidden, true, "or leave a dead chevron visible");
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    assert.equal(toggle.getAttribute("data-zw-open"), "false");
    assert.equal(field.value, "", "and does not keep an unsaved note for the next open");
    api.destroy();
  });

  await test("5. OW-130 off-target, cancel, no-op and cleanup paths release the press and consumed-click latch", () => {
    const a = gestureRuntime();
    a.document.fire("mousedown", { target: a.target });
    a.advance(200);
    a.window.fire("mouseup", { target: a.target });
    assert.equal(a.runtime.consumed, true, "a completed short press leaves its own click latch");
    a.document.fire("mousedown", { target: a.target });
    a.advance(200);
    a.window.fire("mouseup", { target: a.outside });
    assert.equal(a.runtime.press, null, "off-target mouse-up clears the press");
    assert.equal(a.runtime.consumed, false, "and releases the stale latch");
    assert.equal(a.target.getAttribute("data-hold-active"), null);
    const click = a.document.fire("click", { target: a.target });
    assert.equal(click.defaultPrevented, undefined, "the next ordinary click is not swallowed");

    const b = gestureRuntime();
    b.document.fire("mousedown", { target: b.target });
    b.advance(200);
    b.window.fire("mouseup", { target: b.target });
    assert.equal(b.runtime.consumed, true, "a real short gesture consumes its own click");
    b.window.fire("pointercancel");
    assert.equal(b.runtime.consumed, false, "cancel releases a stale latch");
    const nextClick = b.document.fire("click", { target: b.target });
    assert.equal(nextClick.defaultPrevented, undefined, "and leaves the following click alone");
    assert.equal(b.state().hiddenCalls, 1);
    assert.equal(b.state().toggleCalls, 0);

    const c = gestureRuntime();
    c.document.fire("mousedown", { target: c.target });
    c.advance(600);
    c.window.fire("mouseup", { target: c.target });
    assert.equal(c.state().toggleCalls, 1, "a completed hold still toggles the pref");
    assert.equal(c.state().hiddenCalls, 0);
    assert.equal(c.runtime.press, null);
    assert.equal(c.target.getAttribute("data-hold-active"), null);

    const d = gestureRuntime();
    d.document.fire("mousedown", { target: d.target });
    d.advance(200);
    d.window.fire("mouseup", { target: d.target });
    assert.equal(d.runtime.consumed, true, "a real short gesture consumes its own click");
    d.window.fire("mouseup", { target: d.target });
    assert.equal(d.runtime.consumed, false, "a stray mouse-up with no press releases the latch");
    const dClick = d.document.fire("click", { target: d.target });
    assert.equal(dClick.defaultPrevented, undefined, "and leaves the following click alone");

    const e = gestureRuntime();
    e.document.fire("mousedown", { target: e.target });
    e.advance(200);
    e.window.fire("mouseup", { target: e.target });
    assert.equal(e.runtime.consumed, true, "pre-load a stale latch for a no-op verdict");
    e.document.fire("mousedown", { target: e.target });
    e.advance(200);
    e.window.fire("mouseup", { target: e.target, button: 2 });
    assert.equal(e.runtime.consumed, false, "a no-op verdict cannot leave a stale latch");
    assert.equal(e.state().hiddenCalls, 1);
    assert.equal(e.state().toggleCalls, 0);

    const f = gestureRuntime();
    f.document.fire("mousedown", { target: f.target });
    f.advance(200);
    f.window.fire("mouseup", { target: f.target });
    assert.equal(f.runtime.consumed, true, "pre-load a latch before cleanup");
    f.runtime.removePillAutohideListeners();
    assert.equal(f.runtime.consumed, false, "cleanup cannot leave a click latch behind");
  });

  await test("6. OW-131 inheritance preview uses the resolved value, not a nested Inherit sentence", () => {
    assert.match(SRC.notes, /cDesc\.valueLabel \|\| resolvedColor\.effective/);
    assert.doesNotMatch(SRC.notes, /cDesc\.label \|\| resolvedColor\.effective/);
    assert.match(SRC.notes, /resolveCalendarItemColor\(\{[\s\S]{0,200}customColor/);
    assert.match(SRC.notes, /color: customColor/);
  });

  console.log(`OW-127..OW-132 regression sweep tests passed (${passed})`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
})();
