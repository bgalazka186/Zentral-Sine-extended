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
        pointerId: 1,
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
  const document = makeEmitter();
  const window = makeEmitter();
  let hiddenCalls = 0;
  let toggleCalls = 0;
  let pref = false;
  const hiddenOptions = [];

  // The extracted block is intentionally not copied into the test: it runs the
  // shipped gesture code with fake DOM, clock and preference seams.
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    "document", "window", "Date", "setTimeout", "clearTimeout",
    "BGALAZKA_EXT_PREFS", "getPref", "setPref", "syncHoverPanelAvailability",
    "clearHoverHide", "setHoverPanelHidden", "PILL_AUTOHIDE_HOLD_MS",
    "PILL_AUTOHIDE_MOVE_TOLERANCE_PX", "PILL_AUTOHIDE_SELECTOR",
    block + `
      return {
        classifyPillAutohideGesture,
        pillPointerMovement,
        onPillAutohideDown, onPillAutohideUp, onPillAutohideMove,
        onPillAutohideCancel, onPillAutohideClick, onPillAutohideKeyDown,
        removePillAutohideListeners,
        get press() { return pillAutohidePress; },
        get consumed() { return pillAutohideConsumedClick; },
        get suppress() { return pillAutohideSuppressClick; },
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
    (_k, fallback) => (_k === "zen.workspace.zentral.panels.autohide" ? pref : fallback),
    (_k, v) => { pref = v; toggleCalls++; },
    () => {},
    () => {},
    (hidden, opts) => { if (hidden) { hiddenCalls++; hiddenOptions.push(opts || {}); } },
    550,
    8,
    "#zen-app-hover-reveal-btn",
  );
  return {
    runtime, document, window, target, outside, advance,
    state: () => ({ hiddenCalls, toggleCalls, pref, hiddenOptions: [...hiddenOptions] }),
  };
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

  await test("5. OW-130 pointer jitter, one-shot hide, cancel and cleanup paths release stale latches", () => {
    const a = gestureRuntime();
    a.document.fire("pointerdown", { target: a.target });
    a.window.fire("pointermove", { target: a.target, clientX: 105, clientY: 106 });
    a.advance(200);
    a.window.fire("pointerup", { target: a.target, clientX: 105, clientY: 106 });
    assert.equal(a.runtime.press, null, "sub-threshold jitter does not cancel the press");
    assert.equal(a.runtime.consumed, true, "a completed short press leaves its own click latch");
    assert.equal(a.state().hiddenCalls, 1, "a short press hides once");
    assert.equal(a.state().hiddenOptions[0].once, true, "hide-once is independent of the saved preference");
    assert.equal(a.state().toggleCalls, 0, "a short press does not toggle the pref");
    assert.equal(a.document.fire("click", { target: a.target }).defaultPrevented, true,
      "the gesture's own click is consumed");
    assert.equal(a.runtime.consumed, false);
    assert.equal(a.state().hiddenCalls, 1, "the consumed click does not hide twice");

    const b = gestureRuntime();
    b.document.fire("pointerdown", { target: b.target });
    b.advance(600);
    assert.equal(b.target.getAttribute("data-hold-active"), "true", "the hold timer marks the button");
    b.window.fire("pointerup", { target: b.target });
    assert.equal(b.state().toggleCalls, 1, "a completed hold still toggles the pref");
    assert.equal(b.state().hiddenCalls, 0);
    assert.equal(b.runtime.press, null);
    assert.equal(b.target.getAttribute("data-hold-active"), null);

    const c = gestureRuntime();
    c.document.fire("pointerdown", { target: c.target });
    c.window.fire("pointermove", { target: c.target, clientX: 130, clientY: 100 });
    assert.equal(c.runtime.press, null, "movement beyond 8 px cancels the press");
    assert.equal(c.runtime.suppress, true, "and suppresses the resulting click");
    c.advance(200);
    c.window.fire("pointerup", { target: c.target });
    assert.equal(c.document.fire("click", { target: c.target }).defaultPrevented, true);
    assert.equal(c.state().hiddenCalls, 0, "a real drag never hides the panel");
    assert.equal(c.document.fire("click", { target: c.target }).defaultPrevented, true,
      "the next plain click is a fresh one-shot hide");
    assert.equal(c.state().hiddenCalls, 1);

    const d = gestureRuntime();
    d.document.fire("pointerdown", { target: d.target });
    d.advance(200);
    d.window.fire("pointerup", { target: d.outside });
    assert.equal(d.runtime.press, null, "off-target pointer-up clears the press");
    assert.equal(d.runtime.consumed, false, "and releases the stale consumed latch");
    assert.equal(d.runtime.suppress, true, "while suppressing the canceled click");
    assert.equal(d.target.getAttribute("data-hold-active"), null);
    assert.equal(d.document.fire("click", { target: d.target }).defaultPrevented, true);
    assert.equal(d.state().hiddenCalls, 0);

    const e = gestureRuntime();
    e.document.fire("pointerdown", { target: e.target });
    e.advance(200);
    e.window.fire("pointercancel", { target: e.target });
    assert.equal(e.runtime.consumed, false, "cancel releases a stale latch");
    assert.equal(e.runtime.suppress, true, "and cancels this gesture's click");
    assert.equal(e.document.fire("click", { target: e.target }).defaultPrevented, true);
    assert.equal(e.state().hiddenCalls, 0);

    const f = gestureRuntime();
    f.document.fire("pointerdown", { target: f.target });
    f.advance(200);
    f.window.fire("pointerup", { target: f.target, button: 2 });
    assert.equal(f.runtime.consumed, false, "a no-op verdict cannot leave a consumed latch");
    assert.equal(f.runtime.suppress, true, "but its click is suppressed");
    assert.equal(f.document.fire("click", { target: f.target }).defaultPrevented, true);
    assert.equal(f.state().hiddenCalls, 0);

    const g = gestureRuntime();
    g.document.fire("pointerdown", { target: g.target });
    g.advance(200);
    g.window.fire("pointerup", { target: g.target });
    assert.equal(g.runtime.consumed, true, "pre-load a stale latch before cleanup");
    g.runtime.removePillAutohideListeners();
    assert.equal(g.runtime.consumed, false, "cleanup cannot leave a click latch behind");
    assert.equal(g.runtime.suppress, false, "or a cancel-suppression latch");
    assert.equal(g.runtime.press, null);
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
