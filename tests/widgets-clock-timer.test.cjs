"use strict";
/* OW-56: the clock and the stopwatch are one card.
 * A click turns the card over; the setting says which face it rests on. A countdown that ends asks two independent
 * questions (sound, notice) and answers once; it also marks the clock, and the mark is cleared by a click — never by
 * time. All of that state is per window and per run: a finished countdown is a moment, not a setting. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(root, "additional/widgets/ZentralWidgets.uc.js"), "utf8");
const CSS = fs.readFileSync(path.join(root, "additional/widgets/ZentralWidgets.css"), "utf8");
const SETTINGS = JSON.parse(fs.readFileSync(path.join(root, "additional/widgets/settings.json"), "utf8"));
const LAYOUT = JSON.parse(fs.readFileSync(path.join(root, "extension/settings/layout.json"), "utf8"));
const { createFakeSidebarHarness } = require("./helpers/fake-widgets-harness.cjs");

const seam = {};
const win = { __zentralWidgetsTestSeam: seam, ZentralRuntime: { register() {} } };
win.window = win;
vm.runInNewContext(SRC, {
  window: win,
  globalThis: { Services: {} },
  URL,
  Date,
  JSON,
  Math,
  Promise,
  RegExp,
  Number,
  String,
  Array,
  Object,
  Map,
  Set,
  console,
});
const c = seam.core;
const plain = (v) => JSON.parse(JSON.stringify(v));

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok -", name);
}

test("a click turns the card over, and the two faces are the only two", () => {
  assert.deepEqual(plain(c.WIDGET_MODES), ["clock", "timer"]);
  assert.equal(c.nextWidgetMode("clock", "click"), "timer");
  assert.equal(c.nextWidgetMode("timer", "click"), "clock", "and back again");
  assert.equal(c.nextWidgetMode("clock", ""), "clock", "opening the card is not a flip");
  assert.equal(c.nextWidgetMode("nonsense", ""), "clock", "junk rests on the clock");
  assert.equal(c.cleanWidgetMode("TIMER"), "timer");
});

test("a person who turned the click off keeps the setting as the only way to change the face", () => {
  assert.equal(c.nextWidgetMode("clock", "click", { clickEnabled: false }), "clock");
  assert.equal(c.nextWidgetMode("clock", "click", { clickEnabled: true }), "timer");
});

test("the end asks two independent questions, and answers once", () => {
  assert.deepEqual(plain(c.TIMER_END_SOUNDS), ["none", "beep", "chime"]);
  assert.deepEqual(plain(c.TIMER_END_NOTICES), ["none", "toast", "system"]);
  assert.equal(c.cleanTimerEndSound("CHIME"), "chime");
  assert.equal(c.cleanTimerEndSound("cowbell"), "beep", "junk keeps the sound we shipped");
  assert.equal(c.cleanTimerEndNotice("cowbell"), "none", "junk keeps the quiet default");

  const both = plain(c.timerEndPlan({ sound: "chime", notice: "toast" }));
  assert.deepEqual(both, { sound: "chime", notice: "toast", markClock: true, text: "Time is up" });
  const silent = plain(c.timerEndPlan({ sound: "none", notice: "none" }));
  assert.equal(silent.sound, "none");
  assert.equal(silent.notice, "none");
  assert.equal(silent.markClock, true, "even a silent end marks the clock: the numbers are the one thing always there");

  const again = plain(c.timerEndPlan({ sound: "chime", notice: "system", alreadyRung: true }));
  assert.deepEqual(again, { sound: "none", notice: "none", markClock: false, text: "Time is up" }, "one end, one alert");
  assert.equal(c.timerEndPlan({ text: "  " }).text, "Time is up", "empty text is never an empty notice");
});

test("the red mark is a pure state, and only a click clears it", () => {
  assert.deepEqual(plain(c.clockAlertState({ ringing: true })), { ringing: true, tone: "alert" });
  assert.deepEqual(plain(c.clockAlertState({ ringing: false })), { ringing: false, tone: "none" });
  assert.deepEqual(plain(c.clockAlertState({ ringing: true }, { clicked: true })), { ringing: false, tone: "none" });
  // A second click on an already-clear clock must not invent a mark.
  assert.equal(c.clockAlertState({}, { clicked: true }).ringing, false);
});

test("the red is a token, not a literal, on the numbers themselves", () => {
  // Anchor to the declaration, not the selector: `indexOf` on a selector finds a line that has no colour in it.
  const at = CSS.indexOf("color: var(--zw-clock-alert, #");
  assert.ok(at > 0, "the alert colour is a token with a literal fallback");
  const rule = CSS.slice(CSS.lastIndexOf("{", at) + 1, CSS.indexOf("}", at) + 1);
  assert.match(rule, /color: var\(--zw-clock-alert, #[0-9a-f]{6}\) !important/, "a theme can answer the colour");
  assert.ok(CSS.includes('.zw-clock[data-zw-clock-alert="true"] .zw-clock-seconds'), "the seconds too");
  assert.ok(/text-shadow: 0 0 12px var\(--zw-clock-alert/.test(CSS), "and it glows, so a glance finds it");
  // The face is a data attribute on the card, and the two faces never show at once.
  assert.ok(CSS.includes('.zw-clock[data-zw-clock-face="timer"] .zw-clock-main'), "the clock face hides while the timer is up");
  assert.ok(CSS.includes(".zw-clock-timer-face"), "the timer face has its own shape");
});

test("the three settings exist and reach Sine's own page", () => {
  const schema = new Map(SETTINGS.schema.map((x) => [x.property, x]));
  for (const [property, type] of [
    ["zen.workspace.zentral.widgets.clock.mode", "dropdown"],
    ["zen.workspace.zentral.widgets.timer.end_sound", "dropdown"],
    ["zen.workspace.zentral.widgets.timer.end_notice", "dropdown"],
  ]) {
    const item = schema.get(property);
    assert.ok(item, property + " is in the schema");
    assert.equal(item.type, type);
    assert.ok(LAYOUT.order.includes(property), property + " is in the Sine preference page");
  }
  const values = schema.get("zen.workspace.zentral.widgets.clock.mode").options.map((o) => o.value);
  assert.deepEqual(values, ["clock", "timer"]);
  const notices = schema.get("zen.workspace.zentral.widgets.timer.end_notice").options.map((o) => o.value);
  assert.deepEqual(notices, ["none", "toast", "system"]);
  // OW-61: the three assertions above were all true while the dialog showed none of these, because the dialog is
  // built from `settings`, not from `schema` or from the layout order. This is the assertion that was missing.
  for (const item of SETTINGS.schema) {
    assert.ok(SETTINGS.settings[item.property], item.property + " has a settings entry (or the dialog drops it)");
  }
  for (const property of [
    "zen.workspace.zentral.widgets.clock.mode",
    "zen.workspace.zentral.widgets.timer.end_sound",
    "zen.workspace.zentral.widgets.timer.end_notice",
    "zen.workspace.zentral.widgets.weather.places",
  ]) {
    const meta = SETTINGS.settings[property];
    assert.ok(meta, property + " is not generated-and-forgotten");
    assert.equal(meta.owner, "widgets", property + " belongs to this module");
    assert.ok(LAYOUT.categories.some((c) => c.id === meta.category && c.sections.some((sec) => sec.label === meta.section)),
      property + " points at a category and section the layout really declares");
  }
});

test("the retired Timer card moved its settings, and kept its owner's intent", () => {
  // The old pref is read once for migration and is deliberately not a setting any more.
  const standalone = JSON.parse(fs.readFileSync(path.join(root, "additional/widgets/standalone.json"), "utf8"));
  assert.ok((standalone.externalPrefs || []).includes("zen.workspace.zentral.widgets.timer.enabled"),
    "the old pref is declared external, so the build knows why the code still reads it");
  assert.ok(!SETTINGS.schema.some((x) => x.property === "zen.workspace.zentral.widgets.timer.enabled"),
    "and it is not offered in settings any more");
  assert.ok(!LAYOUT.order.includes("zen.workspace.zentral.widgets.timer.enabled"), "nor placed on the page");
  assert.ok(/function adoptLegacyTimerCard\(\)/.test(SRC), "one migration step carries the intent over");
  assert.ok(/writeStringPref\(WIDGET_PREFS.CLOCK_MODE, "timer"\)/.test(SRC), "to the Clock's own face setting");
  // The three settings that stayed are still real settings with a home in the dialog (the OW-61 rule).
  for (const property of ["zen.workspace.zentral.widgets.clock.mode", "zen.workspace.zentral.widgets.timer.end_sound", "zen.workspace.zentral.widgets.timer.end_notice"]) {
    assert.ok(SETTINGS.schema.some((x) => x.property === property), property + " is still declared");
    assert.ok(SETTINGS.settings[property], property + " still has a settings entry");
  }
});

test("nothing about a finished countdown is written to prefs", () => {
  // Only the face is a setting. The alert, the ring and the toast are state in the window.
  assert.ok(/const clockAlert = \{ ringing: false \};/.test(SRC), "the flag is per window");
  assert.ok(!/setStringPref\([^)]*ringing/.test(SRC), "and never stored");
  assert.ok(!/setBoolPref\([^)]*alert/.test(SRC), "and never stored as a bool either");
});

test("the toast is a line that leaves by itself", () => {
  assert.ok(/className = "zw-toast"/.test(SRC), "one element, reused");
  assert.ok(/setAttribute\("role", "status"\)/.test(SRC), "announced, not shouted");
  assert.ok(/}, 5000\);/.test(SRC), "five seconds and it is gone");
  assert.ok(CSS.includes("#zentral-sidebar-widgets .zw-toast[hidden]"), "hidden really hides");
});

test("the end sound has a real tone behind the beep, and falls back to the beep", () => {
  assert.ok(/AudioContext \|\| window\.webkitAudioContext/.test(SRC), "the same WebAudio path the reminder alert uses");
  assert.ok(/cleanTimerEndSound\(kind\) === "none"/.test(SRC) === false, "the guard is written once, in the plan");
  const sound = SRC.slice(SRC.indexOf("function playTimerEndSound"), SRC.indexOf("function timerNoticeText"));
  assert.match(sound, /if \(sound === "none"\) return;/, "none really plays nothing");
  assert.match(sound, /Services\.sound\.beep\(\)/, "the beep stays the fallback");
  assert.match(sound, /catch \(_\) \{\n          try \{ Services\.sound\.beep\(\); \}/, "no WebAudio still rings");
});

// ---- live: the real host, the real card ------------------------------------------------
(async () => {
  const h = createFakeSidebarHarness({
    "zen.workspace.zentral.widgets.enabled": true,
    "zen.workspace.zentral.widgets.clock.enabled": true,
    "zen.workspace.zentral.widgets.date.enabled": false,
    "zen.workspace.zentral.widgets.timer.enabled": false,
    "zen.workspace.zentral.widgets.timer.end_sound": "none",
  });
  const { api } = h.start();
  await new Promise((r) => setTimeout(r, 40));

  const clock = api.getTray().children.find((el) => el.getAttribute("data-zw-widget") === "clock");
  assert.ok(clock, "the clock card mounted");
  const body = clock.querySelector(".zw-clock");
  assert.equal(body.getAttribute("data-zw-clock-face"), "clock", "it rests on the clock");
  assert.equal(body.getAttribute("data-zw-clock-alert"), "false", "and nothing is ringing");

  // The card's own click turns it over, and the setting follows.
  const cardClicks = clock._listeners.filter(([type]) => type === "click");
  assert.equal(cardClicks.length, 1, "one click handler on the card itself");
  cardClicks[0][1]({ button: 0, stopPropagation() {}, preventDefault() {} });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(h.prefs.get("zen.workspace.zentral.widgets.clock.mode"), "timer", "the face is a setting, so it persists");
  assert.equal(body.getAttribute("data-zw-clock-face"), "timer", "and the card shows the timer face");

  cardClicks[0][1]({ button: 0, stopPropagation() {}, preventDefault() {} });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(h.prefs.get("zen.workspace.zentral.widgets.clock.mode"), "clock", "a second click turns it back");

  // ---- OW-60: the two cards really are one. The owner's three complaints, each driven on the real card. ----
  assert.equal(api.getTray().children.some((el) => el.getAttribute("data-zw-widget") === "timer"), false,
    "there is no second Timer card in the tray");

  cardClicks[0][1]({ button: 0, stopPropagation() {}, preventDefault() {} });
  await new Promise((r) => setTimeout(r, 20));
  const face = clock.querySelector(".zw-clock-timer-face");
  assert.ok(face, "the timer face is part of the clock card");
  // 1a. the controls are here, not on another card
  const startBtn = face.querySelector(".zw-timer-btn");
  assert.ok(startBtn, "Start/Stop is on the face");
  assert.equal(face.querySelectorAll(".zw-timer-preset").length, 5, "so are the five presets");
  assert.ok(face.querySelector(".zw-timer-field"), "and the typed duration");
  // 1b. Start really starts the stopwatch, and the numbers move
  const clickAll = (el) => (el._listeners || []).filter(([t]) => t === "click").forEach(([, fn]) => fn({ stopPropagation() {} }));
  clickAll(startBtn);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(body.getAttribute("data-zw-timer"), "stopwatch", "the stopwatch is running");
  const valueEl = face.querySelector(".zw-timer-value");
  const before = valueEl.textContent;
  h.advanceTime(3000);
  await new Promise((r) => setTimeout(r, 20));
  assert.notEqual(valueEl.textContent, before, "and its numbers advance with the clock");
  clickAll(startBtn);
  await new Promise((r) => setTimeout(r, 20));
  // A stopped stopwatch is idle as far as "something moves" is concerned, but it keeps its elapsed time on the face.
  assert.equal(body.getAttribute("data-zw-timer"), "idle", "stopping stops it");
  assert.equal(face.querySelector(".zw-timer-mode").textContent, "stopped", "and the face still says it is a stopped stopwatch");
  // `formatDuration` prints `0:03` (no padded hour), so assert the time is kept, not a particular padding.
  assert.notEqual(valueEl.textContent, "0:00", "the elapsed time is kept, not thrown away");
  // 1c. a preset starts the countdown: the stopwatch still has its countdown function
  clickAll(face.querySelectorAll(".zw-timer-preset")[0]);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(body.getAttribute("data-zw-timer"), "countdown", "1m starts a countdown from the same face");
  assert.equal(face.querySelector(".zw-timer-mode").textContent, "countdown", "and the face says so");
  assert.match(valueEl.textContent, /^1:00$|^0:59$/, "counting down from a minute");

  // 3. the quick note is reachable from the CLOCK face
  cardClicks[0][1]({ button: 0, stopPropagation() {}, preventDefault() {} });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(body.getAttribute("data-zw-clock-face"), "clock");
  const noteChip = body.querySelector(".zw-clock-note-chip");
  assert.ok(noteChip, "the clock face carries the note chip");
  const noteRow = body.querySelector(".zw-clock-note-row");
  assert.equal(noteRow.hidden, true, "the row ships hidden");
  clickAll(noteChip);
  assert.equal(noteRow.hidden, false, "the chip reveals it");

  api.destroy();
  console.log(`PASS widgets-clock-timer (${passed} tests, 1 live)`);
})();
