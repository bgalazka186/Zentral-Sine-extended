"use strict";
/* T3.9b tests: Built-in Clock & Date sidebar widgets.
 * Verifies pure formatting (auto/24h/12h, seconds, time zone, long/short/ISO date,
 * year, ISO week number), boundary-aligned wakeups (minute/second/midnight, zero polling),
 * cache staleness across minute & midnight boundaries on resume, live pref reactivity,
 * video-player avoidance coexistence, and leak-free disposal. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const widgetSrc = fs.readFileSync(
  path.join(root, "additional/widgets/ZentralWidgets.uc.js"),
  "utf8",
);

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("ok -", name);
}

function createClockDateHarness(initialPrefs = {}, startMs = Date.UTC(2026, 10, 16, 14, 5, 30, 0)) {
  const prefs = new Map(Object.entries(initialPrefs));
  const prefObservers = [];
  let nowMs = startMs;
  let nextTimerId = 1;
  const timers = new Map();
  const rafs = new Map();
  let nextRafId = 1;
  const docListeners = [];
  const winListeners = [];

  class FakeElement {
    constructor(tag, id = "") {
      this.tagName = String(tag || "div").toUpperCase();
      this.localName = String(tag || "div").toLowerCase();
      this.nodeType = 1;
      this.id = id;
      this.className = "";
      this.textContent = "";
      this.hidden = false;
      this.parentNode = null;
      this.children = [];
      this.attrs = new Map();
      this._rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
      this.style = {
        _props: new Map(),
        setProperty(k, v) { this._props.set(k, String(v)); },
        removeProperty(k) { this._props.delete(k); },
        getPropertyValue(k) { return this._props.get(k) || ""; },
      };
    }
    get parentElement() { return this.parentNode; }
    get isConnected() {
      let cur = this;
      while (cur) { if (cur === docRoot) return true; cur = cur.parentNode; }
      return false;
    }
    get previousSibling() {
      if (!this.parentNode) return null;
      const i = this.parentNode.children.indexOf(this);
      return i > 0 ? this.parentNode.children[i - 1] : null;
    }
    get nextSibling() {
      if (!this.parentNode) return null;
      const i = this.parentNode.children.indexOf(this);
      return i >= 0 && i + 1 < this.parentNode.children.length ? this.parentNode.children[i + 1] : null;
    }
    setRect(r) {
      const top = r.top ?? 0, left = r.left ?? 0;
      const width = r.width ?? 0, height = r.height ?? 0;
      this._rect = { left, top, right: left + width, bottom: top + height, width, height };
      return this;
    }
    getBoundingClientRect() { return { ...this._rect }; }
    setAttribute(k, v) { this.attrs.set(k, String(v)); if (k === "id") this.id = String(v); if (k === "class") this.className = String(v); }
    getAttribute(k) { return k === "id" ? (this.id || null) : (this.attrs.has(k) ? this.attrs.get(k) : null); }
    hasAttribute(k) { return k === "hidden" ? this.hidden || this.attrs.has("hidden") : this.attrs.has(k); }
    removeAttribute(k) { this.attrs.delete(k); if (k === "hidden") this.hidden = false; }
    appendChild(ch) { if (ch.parentNode) ch.remove(); ch.parentNode = this; this.children.push(ch); return ch; }
    insertBefore(ch, ref) {
      if (!ref) return this.appendChild(ch);
      if (ch.parentNode) ch.remove();
      const idx = this.children.indexOf(ref);
      if (idx < 0) return this.appendChild(ch);
      ch.parentNode = this;
      this.children.splice(idx, 0, ch);
      return ch;
    }
    remove() {
      if (!this.parentNode) return;
      const idx = this.parentNode.children.indexOf(this);
      if (idx >= 0) this.parentNode.children.splice(idx, 1);
      this.parentNode = null;
    }
    contains(other) { let c = other; while (c) { if (c === this) return true; c = c.parentNode; } return false; }
    matches(sel) {
      return sel.split(",").some((part) => {
        const s = part.trim();
        if (s.startsWith("#")) return this.id === s.slice(1);
        if (s.startsWith(".")) return this.className.split(/\s+/).includes(s.slice(1));
        return this.localName === s.toLowerCase();
      });
    }
    querySelectorAll(sel) {
      const out = [];
      const walk = (n) => { for (const ch of n.children) { if (ch.matches(sel)) out.push(ch); walk(ch); } };
      walk(this);
      return out;
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  }

  const docRoot = new FakeElement("window", "main-window");
  const toolbox = new FakeElement("toolbox", "navigator-toolbox").setRect({ width: 179, height: 900 });
  const topBar = new FakeElement("hbox", "zen-sidebar-top-buttons").setRect({ top: 0, width: 179, height: 132 });
  const verticalTabs = new FakeElement("vbox", "vertical-tabs").setRect({ top: 132, width: 179, height: 724 });
  const tab = new FakeElement("tab", "");
  tab.className = "tabbrowser-tab";
  tab.setRect({ top: 132, width: 179, height: 298 });
  verticalTabs.appendChild(tab);
  const media = new FakeElement("toolbar", "zen-media-controls-toolbar").setRect({ top: 856, width: 179, height: 0 });
  media.hidden = true;
  const video = new FakeElement("div", "zentral-video-preview").setRect({ top: 856, width: 179, height: 0 });
  video.hidden = true;
  const bottom = new FakeElement("hbox", "zen-sidebar-bottom-buttons").setRect({ top: 856, width: 179, height: 44 });
  toolbox.appendChild(topBar);
  toolbox.appendChild(verticalTabs);
  toolbox.appendChild(media);
  toolbox.appendChild(video);
  toolbox.appendChild(bottom);
  docRoot.appendChild(toolbox);

  const findById = (n, id) => {
    if (n.id === id) return n;
    for (const c of n.children) { const r = findById(c, id); if (r) return r; }
    return null;
  };

  const document = {
    documentElement: docRoot,
    hidden: false,
    getElementById: (id) => findById(docRoot, id),
    createElement: (tag) => new FakeElement(tag),
    addEventListener: (t, fn) => docListeners.push([t, fn]),
    removeEventListener: (t, fn) => { const i = docListeners.findIndex((x) => x[0] === t && x[1] === fn); if (i >= 0) docListeners.splice(i, 1); },
  };

  const Services = {
    prefs: {
      getPrefType: (k) => (prefs.has(k) ? (typeof prefs.get(k) === "boolean" ? 128 : typeof prefs.get(k) === "number" ? 64 : 32) : 0),
      getBoolPref: (k, d) => (prefs.has(k) ? Boolean(prefs.get(k)) : d),
      getIntPref: (k, d) => (prefs.has(k) ? Number(prefs.get(k)) : d),
      getStringPref: (k, d) => (prefs.has(k) ? String(prefs.get(k)) : d),
      setBoolPref: (k, v) => { prefs.set(k, Boolean(v)); for (const [pk, o] of [...prefObservers]) if (pk === k) o.observe(null, "nsPref:changed", k); },
      setIntPref: (k, v) => { prefs.set(k, Math.round(Number(v))); for (const [pk, o] of [...prefObservers]) if (pk === k) o.observe(null, "nsPref:changed", k); },
      setStringPref: (k, v) => { prefs.set(k, String(v)); for (const [pk, o] of [...prefObservers]) if (pk === k) o.observe(null, "nsPref:changed", k); },
      addObserver: (k, o) => prefObservers.push([k, o]),
      removeObserver: (k, o) => { const i = prefObservers.findIndex((x) => x[0] === k && x[1] === o); if (i >= 0) prefObservers.splice(i, 1); },
    },
    obs: { addObserver() {}, removeObserver() {} },
  };

  const window = {
    innerWidth: 1440,
    innerHeight: 900,
    windowState: 1,
    STATE_MINIMIZED: 2,
    document,
    gBrowser: { tabContainer: { addEventListener() {}, removeEventListener() {} } },
    gBrowserInit: { delayedStartupFinished: true },
    __zentralWidgetsTestSeam: {},
    ZentralRuntime: {
      services: {},
      nativeSidebarElement: () => toolbox,
      register({ id, init }) { this._registered = { id, init }; },
    },
    getComputedStyle: (el) => ({ display: el.hidden ? "none" : "flex", visibility: "visible", position: "static", marginTop: "0px", marginBottom: "0px", paddingLeft: "0px", paddingRight: "0px", paddingTop: "0px", paddingBottom: "0px" }),
    setTimeout: (fn, ms = 0) => { const id = nextTimerId++; timers.set(id, { fn, at: nowMs + Math.max(0, ms), ms }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    requestAnimationFrame: (fn) => { const id = nextRafId++; rafs.set(id, fn); return id; },
    cancelAnimationFrame: (id) => { rafs.delete(id); },
    addEventListener: (t, fn) => winListeners.push([t, fn]),
    removeEventListener: (t, fn) => { const i = winListeners.findIndex((x) => x[0] === t && x[1] === fn); if (i >= 0) winListeners.splice(i, 1); },
  };

  const RealDate = Date;
  const FakeDate = class extends RealDate {
    constructor(...a) { super(...(a.length ? a : [nowMs])); }
    static now() { return nowMs; }
  };

  const ctx = vm.createContext({
    window,
    document,
    Services,
    Date: FakeDate,
    Intl,
    console: { log() {}, warn() {}, error() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    setTimeout: window.setTimeout,
    clearTimeout: window.clearTimeout,
    requestAnimationFrame: window.requestAnimationFrame,
    cancelAnimationFrame: window.cancelAnimationFrame,
    Promise,
  });
  ctx.globalThis = ctx;

  vm.runInContext(widgetSrc, ctx);
  const api = (() => {
    window.ZentralRuntime._registered.init({ runtime: window.ZentralRuntime });
    return window.ZentralRuntime.services.widgets;
  })();

  const flushRaf = () => { const fns = [...rafs.values()]; rafs.clear(); for (const f of fns) f(); };
  const advanceTime = (ms) => {
    nowMs += ms;
    const due = [...timers.entries()].filter(([, t]) => t.at <= nowMs).sort((a, b) => a[1].at - b[1].at);
    for (const [id, t] of due) { if (!timers.has(id)) continue; timers.delete(id); t.fn(); }
  };
  const fireDoc = (type) => { for (const [t, fn] of [...docListeners]) if (t === type) fn({ type }); };

  return {
    api,
    core: window.__zentralWidgetsTestSeam.core,
    Services,
    document,
    toolbox,
    video,
    timers,
    flushRaf,
    advanceTime,
    fireDoc,
    setNow: (v) => { nowMs = v; },
    getNow: () => nowMs,
  };
}

(async () => {
  await test("pure formatClockParts: 24h, 12h, midnight, seconds, and timezone across zones", () => {
    const h = createClockDateHarness();
    const { formatClockParts, nextClockDelayMs } = h.core;

    // 2026-11-16T14:05:09Z
    const ts = Date.UTC(2026, 10, 16, 14, 5, 9, 250);

    const f24 = formatClockParts(ts, { format: "24h", showSeconds: false, locale: "en-US", timeZone: "UTC" });
    assert.equal(f24.time, "14:05");
    assert.equal(f24.seconds, "");
    assert.equal(f24.meridiem, "");
    assert.equal(f24.key, "2026-11-16T14:05");

    const f12 = formatClockParts(ts, { format: "12h", showSeconds: true, showZone: true, locale: "en-US", timeZone: "UTC" });
    assert.equal(f12.time, "2:05");
    assert.equal(f12.seconds, "09");
    assert.equal(f12.meridiem, "PM");
    assert.ok(f12.zoneLabel.length > 0, "zone label rendered");
    assert.equal(f12.key, "2026-11-16T14:05:09");

    // Midnight in Europe/Warsaw (UTC+1 in November -> 23:05 UTC = 00:05 CET next day)
    const midnightCet = formatClockParts(Date.UTC(2026, 10, 16, 23, 5, 0), {
      format: "24h",
      locale: "pl-PL",
      timeZone: "Europe/Warsaw",
    });
    assert.equal(midnightCet.time, "00:05");
    assert.equal(midnightCet.key, "2026-11-17T00:05");

    // Exact boundary alignment: at :09.250s -> 50750ms to next minute, 750ms to next second
    assert.equal(nextClockDelayMs(ts, false), 50750);
    assert.equal(nextClockDelayMs(ts, true), 750);

    h.api.destroy();
  });

  await test("pure formatDateParts & isoWeekNumber: long, short, iso, year, and ISO week edge dates", () => {
    const h = createClockDateHarness();
    const { formatDateParts, isoWeekNumber, nextLocalMidnightDelayMs } = h.core;

    // 2026-11-16 is a Monday in ISO week 47
    assert.equal(isoWeekNumber(2026, 11, 16), 47);
    assert.equal(isoWeekNumber(2026, 1, 1), 1);
    assert.equal(isoWeekNumber(2026, 12, 31), 53); // 2026 starts on Thursday -> 53 ISO weeks!
    assert.equal(isoWeekNumber(2024, 12, 30), 1);  // Monday of ISO 2025-W01

    const ts = Date.UTC(2026, 10, 16, 14, 5, 0);
    const dLong = formatDateParts(ts, { format: "long", showYear: false, showWeekNumber: false, locale: "en-US", timeZone: "UTC" });
    assert.equal(dLong.dayNumber, "16");
    assert.equal(dLong.weekdayLong, "Monday");
    assert.equal(dLong.primary, "November 16");
    assert.equal(dLong.weekBadge, "");

    const dShortYrWk = formatDateParts(ts, { format: "short", showYear: true, showWeekNumber: true, locale: "en-US", timeZone: "UTC" });
    assert.equal(dShortYrWk.secondary, "Mon");
    assert.equal(dShortYrWk.primary, "Nov 16, 2026");
    assert.equal(dShortYrWk.weekBadge, "W47");

    const dIso = formatDateParts(ts, { format: "iso", showWeekNumber: true, locale: "en-US", timeZone: "UTC" });
    assert.equal(dIso.primary, "2026-11-16");
    assert.equal(dIso.secondary, "Monday");
    assert.equal(dIso.weekBadge, "W47");

    // Midnight delay in UTC from 23:59:50.000 -> ~10,100ms
    const almostMidnight = Date.UTC(2026, 10, 16, 23, 59, 50, 0);
    const delay = nextLocalMidnightDelayMs(almostMidnight, "UTC");
    assert.ok(delay >= 10000 && delay <= 10200, `expected ~10.1s to midnight, got ${delay}`);

    h.api.destroy();
  });

  await test("live Clock & Date widgets: auto-registered, minute/second/midnight boundaries, live pref switches, and pause/resume staleness", () => {
    // Start at local 2026-11-16 23:58:40.000 (20s before 23:59, 80s before midnight!)
    const startLocal = new Date(2026, 10, 16, 23, 58, 40, 0).getTime();
    const h = createClockDateHarness(
      {
        "zen.workspace.zentral.widgets.enabled": true,
        "zen.workspace.zentral.widgets.clock.format": "24h",
        "zen.workspace.zentral.widgets.date.format": "iso",
      },
      startLocal,
    );

    const tray = h.api.getTray();
    assert.equal(tray.hidden, false);
    assert.deepEqual(
      tray.children.map((c) => c.getAttribute("data-zw-widget")),
      ["clock", "date"],
    );

    const clockTime = tray.querySelector(".zw-clock-time");
    const clockSec = tray.querySelector(".zw-clock-seconds");
    const datePrimary = tray.querySelector(".zw-date-primary");
    const dateWeek = tray.querySelector(".zw-date-week");

    assert.equal(clockTime.textContent, "23:58");
    assert.equal(clockSec.hidden, true);
    assert.equal(datePrimary.textContent, "2026-11-16");
    assert.equal(dateWeek.hidden, true);
    // Exactly 2 single-shot boundary timers (1 for clock next minute, 1 for date next midnight)
    assert.equal(h.api.activeTimerCount(), 2);

    // Advance 19s -> still 23:58:59 (zero premature updates!)
    h.advanceTime(19000);
    assert.equal(clockTime.textContent, "23:58");

    // Advance 1s -> exact minute boundary 23:59:00!
    h.advanceTime(1000);
    assert.equal(clockTime.textContent, "23:59");
    assert.equal(datePrimary.textContent, "2026-11-16");

    // Live pref change: enable seconds + week number + 12h format!
    h.Services.prefs.setBoolPref("zen.workspace.zentral.widgets.clock.show_seconds", true);
    h.Services.prefs.setStringPref("zen.workspace.zentral.widgets.clock.format", "12h");
    h.Services.prefs.setBoolPref("zen.workspace.zentral.widgets.date.show_week_number", true);
    assert.equal(clockSec.hidden, false);
    assert.equal(clockSec.textContent, ":00");
    assert.equal(tray.querySelector(".zw-clock-meridiem").hidden, false);
    assert.equal(dateWeek.hidden, false);
    assert.equal(dateWeek.textContent, "W47");

    // Advance 1s -> seconds tick cleanly to :01!
    h.advanceTime(1000);
    assert.equal(clockSec.textContent, ":01");

    // Switch back to 24h without seconds
    h.Services.prefs.setBoolPref("zen.workspace.zentral.widgets.clock.show_seconds", false);
    h.Services.prefs.setStringPref("zen.workspace.zentral.widgets.clock.format", "24h");
    assert.equal(clockSec.hidden, true);

    // Hide window at 23:59:01 -> ALL timers paused (0 active timers)!
    h.document.hidden = true;
    h.fireDoc("visibilitychange");
    h.flushRaf();
    assert.equal(h.api.isPaused(), true);
    assert.equal(h.api.activeTimerCount(), 0);

    // Advance 70 seconds across midnight (to 2026-11-17 00:00:11) while hidden -> still paused!
    h.advanceTime(70000);
    assert.equal(h.api.activeTimerCount(), 0);

    // Unhide window -> BOTH clock AND date detect crossed minute/midnight boundaries via isStale and immediately update!
    h.document.hidden = false;
    h.fireDoc("visibilitychange");
    h.flushRaf();
    assert.equal(clockTime.textContent, "00:00");
    assert.equal(datePrimary.textContent, "2026-11-17");
    assert.equal(h.api.activeTimerCount(), 2);

    // Turn off Clock alone via per-widget toggle -> only Date remains visible
    h.Services.prefs.setBoolPref("zen.workspace.zentral.widgets.clock.enabled", false);
    assert.deepEqual(
      tray.children.map((c) => c.getAttribute("data-zw-widget")),
      ["date"],
    );
    assert.equal(h.api.activeTimerCount(), 1);

    // Video player appears (16:9 = 125px) -> Date remains cleanly visible & video untouched
    h.video.hidden = false;
    h.video.setRect({ top: 731, width: 179, height: 125 });
    const area = h.api.remeasure();
    assert.equal(area.visible, true);
    assert.equal(area.rawFreeHeight, 301);
    assert.equal(h.video.style._props.size, 0);

    h.api.destroy();
    assert.equal(h.timers.size, 0);
  });

  console.log(`\nPASS widgets-clock-date (${passed} tests)`);
})();
