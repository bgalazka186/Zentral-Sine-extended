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
  // The shared widget toast uses the owner-facing four-second lifetime.
  assert.ok(/}, 4000\);/.test(SRC), "four seconds and it is gone");
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

// The bug behind the owner's report: JS hides a face with `.hidden`, but a `display: flex !important` rule outranks the
// user agent's `[hidden]` rule, so the clock kept drawing above the stopwatch. The JS flag was right all along, which is
// why no behavioural test saw it — only the cascade did.
{
  const hiddenRules = CSS.slice(CSS.indexOf(".zw-clock-main[hidden]"), CSS.indexOf(".zw-clock-main {", CSS.indexOf(".zw-clock-main[hidden]")));
  for (const el of ["zw-clock-main", "zw-clock-timer-face", "zw-clock-badge", "zw-clock-zone", "zw-timer-laps", "zw-timer-field-row", "zw-timer-presets"]) {
    assert.ok(CSS.includes(`.${el}[hidden]`), `.${el} has its own [hidden] rule, or an !important display beats it`);
  }
  assert.match(hiddenRules, /display: none !important/);
  // Every element the code hides by property must be in that list, or it silently stays on screen.
  for (const cls of ["main", "timerFace", "zoneEl", "badgeEl", "laps", "fieldRow", "presets"]) {
    assert.ok(new RegExp(`${cls}\\.hidden = `).test(SRC), `${cls} is hidden by property, so it needs the rule above`);
  }
}

// ---- the owner's shape (OW-65, updated by OW-129): clock, then a chevron-revealed quick note under it;
// click the hour, the stopwatch panel appears where the clock was, with the same note still under it. ----
(async () => {
  const h = createFakeSidebarHarness({
    "zen.workspace.zentral.widgets.enabled": true,
    "zen.workspace.zentral.widgets.clock.enabled": true,
    "zen.workspace.zentral.widgets.date.enabled": false,
    "zen.workspace.zentral.widgets.weather.enabled": false,
    "zen.workspace.zentral.widgets.timer.click_stopwatch": true,
    "zen.workspace.zentral.widgets.timer.enabled": false,
  }, { notes: true });
  const { api } = h.start();
  await new Promise((r) => setTimeout(r, 40));
  const clock = api.getTray().children.find((el) => el.getAttribute("data-zw-widget") === "clock");
  const body = clock.querySelector(".zw-clock");
  const noteRow = body.querySelector(".zw-clock-note-row");
  const timeCol = body.querySelector(".zw-clock-time-col");

  assert.equal(body.getAttribute("data-zw-clock-face"), "clock", "the card rests on the clock");
  const toggle = body.querySelector(".zw-clock-note-toggle");
  assert.ok(toggle, "OW-129's bottom-right chevron is present");
  assert.equal(noteRow.hidden, true, "the quick note starts hidden");
  for (const [type, fn] of [...(toggle._listeners || [])]) {
    if (type === "click") fn({ type: "click", stopPropagation() {}, preventDefault() {} });
  }
  assert.equal(noteRow.hidden, false, "clicking the chevron puts the quick note under the clock");
  assert.equal(body.querySelector(".zw-clock-note-chip").hidden, true, "and there is no separate chip to reveal it");
  const order = Array.from(body.children).map((el) => el.className);
  assert.ok(order.indexOf("zw-clock-time-col") !== -1 && order.indexOf("zw-clock-note-row") > order.indexOf("zw-clock-time-col"),
    "the note comes AFTER the time area, so it is drawn under it");

  // Click the hour: the stopwatch panel takes the clock's place in the same column, and the note does not move.
  const cardClick = clock._listeners.find(([t]) => t === "click")[1];
  cardClick({ button: 0, stopPropagation() {}, preventDefault() {} });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(body.getAttribute("data-zw-clock-face"), "timer", "clicking the hour brings up the stopwatch panel");
  assert.equal(noteRow.hidden, false, "the note is still there, under the panel now");
  assert.ok(timeCol.querySelector(".zw-clock-timer-face"), "the panel took the clock's place inside the same column");
  assert.equal(timeCol.querySelector(".zw-clock-timer-face").hidden, false, "and it is the visible face");
  assert.equal(body.querySelector(".zw-clock-main").hidden, true, "while the clock is put away, not stacked above it");
  assert.ok(Array.from(body.children).indexOf(noteRow) > Array.from(body.children).indexOf(timeCol),
    "the note is still drawn after the time area");

  // The timer controls, not the card, own their clicks — the "Wyzeruj" bug was a button pushed past the edge.
  const reset = body.querySelectorAll(".zw-timer-btn").find((b) => /Wyzeruj|Reset/.test(b.textContent));
  assert.ok(reset, "the reset control is on the panel");

  api.destroy();
  console.log("ok - the owner's shape: note under the clock, and still under the stopwatch when it is up");
})();

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
  // ---- OW-63: clicking the stopwatch goes BACK to the clock, and the fields cannot push the buttons out ----
  // The owner: "clicking on stopwatch doesnt revert it to clock". The cause was the timer face swallowing every click,
  // so the card's own handler never ran while that face was up.
  {
    // The FACE answers a click: its numbers, its kind line and its empty space all lead to the card's own flip.
    const faceUp = clock.querySelector(".zw-clock-timer-face");
    assert.ok(faceUp, "the timer face is up");
    const stops = faceUp._listeners.filter(([type]) => type === "click");
    assert.equal(stops.length, 1, "the timer face answers a click itself");
    stops[0][1]({ stopPropagation() {} });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(h.prefs.get("zen.workspace.zentral.widgets.clock.mode"), "clock",
      "clicking the stopwatch goes back to the clock");
    assert.equal(body.getAttribute("data-zw-clock-face"), "clock", "and the clock is what is shown");
    // Back to the timer face for the rest of the checks.
    cardClicks[0][1]({ button: 0, stopPropagation() {}, preventDefault() {} });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(body.getAttribute("data-zw-clock-face"), "timer");
  }
  {
    // A CONTROL keeps its own click: pressing Start must not also turn the card over. (Put the face up first: the
    // flip above left the card on the clock, which is the whole point of OW-63.)
    assert.equal(body.getAttribute("data-zw-clock-face"), "timer", "the timer face is up");
    const face2 = clock.querySelector(".zw-clock-timer-face");
    const startBtn = face2.querySelectorAll(".zw-timer-btn").find((b) => /Start|Stop|Resume/.test(b.textContent));
    assert.ok(startBtn, "the Start control is on the face");
    startBtn._listeners.filter(([t]) => t === "click").forEach(([, fn]) => fn({ stopPropagation() {} }));
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(body.getAttribute("data-zw-clock-face"), "timer", "pressing a control does not flip the card");
    // The control DID its work (the stopwatch state changed) — that is what "kept its own click" means here. The
    // badge/attribute can lag by a render, so the button's own label is the honest thing to check.
    assert.equal(startBtn.textContent, "Stop", "and it does start the stopwatch");
    // Leave the card as this block found it: the OW-60 checks below start from an idle stopwatch.
    startBtn._listeners.filter(([t]) => t === "click").forEach(([, fn]) => fn({ stopPropagation() {} }));
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(startBtn.textContent, "Start", "and the second press stops it");
  }
  {
    // The source rule itself: only CONTROLS may swallow a click. The face is not in that list any more, and the face
    // does answer clicks — by turning the card over (which is what the owner asked for).
    const swallow = SRC.slice(SRC.indexOf("for (const el of [timerActions, presets, fieldRow])"), SRC.indexOf("for (const { ms, button } of presetButtons)"));
    assert.ok(!/timerActions, presets, fieldRow, timerFace/.test(swallow), "the face is not among the swallowers");
    assert.match(swallow, /\[timerFace, readout, timerKindEl, laps\]/, "the face turns the card over like the clock does");
    assert.match(swallow, /flipFace\(\)/, "and it is the same flip the card uses");
  }
  {
    // OW-63 layout: the field row wraps instead of overflowing, and the field is allowed to shrink.
    const fieldRule = CSS.slice(CSS.indexOf(".zw-timer-field-row,"), CSS.indexOf(".zw-timer-field,"));
    assert.match(fieldRule, /flex-wrap: wrap !important/, "the field row wraps");
    assert.match(CSS, /\.zw-timer-field-row \.zw-timer-field \{[^}]*flex: 1 1 64px !important/, "the field shrinks to a floor");
    assert.match(CSS, /\.zw-timer-field-row \.zw-timer-field \{[^}]*min-width: 48px !important/, "and has a floor");
    assert.match(CSS, /\.zw-timer-field-row \.zw-timer-btn \{[^}]*flex: 0 0 auto !important/, "the button keeps its size");
    assert.match(CSS, /\.zw-timer-field-row \.zw-timer-btn \{[^}]*white-space: nowrap !important/, "and its words stay on one line");
  }

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

  // 3. the quick note is a plain part of the Clock face (the owner: it is not a separate feature to switch on)
  cardClicks[0][1]({ button: 0, stopPropagation() {}, preventDefault() {} });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(body.getAttribute("data-zw-clock-face"), "clock");
  // This harness has no Notes, so the row is correctly ABSENT: it is part of the face, not a switch that draws an
  // empty field nobody can save. (The "under the clock" case is driven in its own test below, with Notes present.)
  const noteRow = body.querySelector(".zw-clock-note-row");
  assert.equal(noteRow.hidden, true, "without Notes the row is not drawn at all");
  const noteChip = body.querySelector(".zw-clock-note-chip");
  assert.ok(noteChip.hidden, "and there is no chip to reveal it: it is not a separate feature");
  // The note lives in the same column as the time and BOTH faces, so it sits under whichever one is up.
  const timeCol = body.querySelector(".zw-clock-time-col");
  assert.ok(timeCol, "the card has a time column");
  assert.ok(timeCol.querySelector(".zw-clock-main"), "the clock face is inside it");
  assert.ok(timeCol.querySelector(".zw-clock-timer-face"), "and so is the timer panel");
  const kids = Array.from(body.children).map((el) => el.className);
  assert.ok(kids.indexOf("zw-clock-time-col") < kids.indexOf("zw-clock-note-row"),
    "the note row comes after the time column, not beside it");

  api.destroy();
  console.log(`PASS widgets-clock-timer (${passed} tests, 1 live)`);
})();
