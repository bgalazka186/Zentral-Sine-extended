"use strict";
/* T3.9d tests: the Timer widget, the Clock click and the Quick note.
 * Everything that decides anything is pure here: the parser, the stopwatch state machine, the countdown (which must
 * survive a sleeping window and ring exactly once), and the presets. The wiring checks that the widget owns no timer
 * of its own, that the Clock click is only a shortcut, and that a quick note reaches Notes through the same opener
 * channel the Date card already uses — never a second channel. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(root, "additional/widgets/ZentralWidgets.uc.js"), "utf8");
const NOTES = fs.readFileSync(path.join(root, "additional/notes/ZentralNotes.uc.js"), "utf8");
const seam = {};
const win = { __zentralWidgetsTestSeam: seam, ZentralRuntime: { register() {} } };
win.window = win;
vm.runInNewContext(SRC, { window: win, globalThis: { Services: {} }, URL, Date, JSON, Math, Promise, RegExp, Number, String, Array, Object, Map, Set, console });
const c = seam.core;

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok -", name);
}
const json = (v) => JSON.parse(JSON.stringify(v));

test("a duration is read the way a person types it", () => {
  assert.equal(c.parseTimerDuration("5"), 5000, "a bare number is seconds");
  assert.equal(c.parseTimerDuration("90"), 90000);
  assert.equal(c.parseTimerDuration("5m"), 300000);
  assert.equal(c.parseTimerDuration("5 min"), 300000);
  assert.equal(c.parseTimerDuration("2 godz"), 7200000);
  assert.equal(c.parseTimerDuration("1h30"), 5400000, "hours add up with the minutes after them");
  assert.equal(c.parseTimerDuration("30s"), 30000);
  assert.equal(c.parseTimerDuration("45 sek"), 45000);
  assert.equal(c.parseTimerDuration("1:30"), 90000, "clock shape: one minute thirty");
  assert.equal(c.parseTimerDuration("1:02:07"), 3727000);
  assert.equal(c.parseTimerDuration(""), 0);
  assert.equal(c.parseTimerDuration("later"), 0, "a word that is not a time is not a time");
  assert.equal(c.parseTimerDuration("999999"), 86400000, "a day is the ceiling");
  assert.equal(c.parseTimerDuration("1,5h"), 5400000, "a decimal comma is decimal, Polish style");
});

test("the clock shows hours only when there are hours", () => {
  assert.equal(c.formatDuration(0), "0:00");
  assert.equal(c.formatDuration(7000), "0:07");
  assert.equal(c.formatDuration(727000), "12:07");
  assert.equal(c.formatDuration(3727000), "1:02:07");
  assert.equal(c.formatDuration(-5), "0:00");
  assert.equal(c.formatDuration(NaN), "0:00");
});

test("the stopwatch measures the wall clock, so a sleep cannot make it drift", () => {
  const t0 = 1000;
  let s = c.stopwatchStart(c.STOPWATCH_IDLE, t0);
  assert.equal(c.stopwatchElapsed(s, t0 + 5000), 5000);
  // The window slept: no tick ran for an hour, and the measurement is still right.
  assert.equal(c.stopwatchElapsed(s, t0 + 3600000), 3600000);
  s = c.stopwatchStop(s, t0 + 7000);
  assert.equal(c.stopwatchElapsed(s, t0 + 999999), 7000, "a stopped watch stays where it stopped");
  s = c.stopwatchStart(s, t0 + 10000);
  assert.equal(c.stopwatchElapsed(s, t0 + 12000), 9000, "restarting continues from the stop");
  assert.deepEqual(json(c.stopwatchReset().laps), []);
  assert.equal(c.stopwatchElapsed(c.stopwatchReset(), t0), 0);
});

test("laps remember when they were taken, not how long the watch ran after", () => {
  const t0 = 5000;
  let s = c.stopwatchStart(c.STOPWATCH_IDLE, t0);
  s = c.stopwatchLap(s, t0 + 3000);
  s = c.stopwatchLap(s, t0 + 9000);
  assert.deepEqual(json(s.laps), [3000, 9000]);
  s = c.stopwatchStop(s, t0 + 10000);
  assert.deepEqual(json(s.laps), [3000, 9000], "stopping keeps the laps");
  assert.equal(c.stopwatchLap(s, t0 + 20000), s, "a stopped watch takes no laps");
});

test("a countdown rings once, even if the window slept through the end", () => {
  const t0 = 10000;
  let t = c.timerStart(5 * 60000, t0);
  assert.equal(c.timerRemaining(t, t0 + 60000), 4 * 60000);
  let tick = c.timerTick(t, t0 + 60000);
  assert.equal(tick.finished, false);
  // The window slept for an hour: the timer finished while nobody looked.
  tick = c.timerTick(t, t0 + 3600000);
  assert.equal(tick.finished, true, "it rings on the first look after the end");
  t = tick.state;
  assert.equal(c.timerTick(t, t0 + 3600000 + 1000).finished, false, "and never a second time");
  assert.equal(c.timerRemaining(t, t0 + 3600000), 0);
  assert.equal(c.nextTimerTickDelayMs(t, t0), 0, "a finished timer needs no tick");
});

test("the countdown keeps its bounds and its tick is once a second at most", () => {
  const t0 = 0;
  const t = c.timerStart(5 * 60000, t0);
  assert.equal(c.nextTimerTickDelayMs(t, t0 + 1000), 1000);
  assert.equal(c.nextTimerTickDelayMs(t, t0 + 299500), 500, "the last half second waits the half second");
  assert.equal(c.nextTimerTickDelayMs(c.TIMER_IDLE, t0), 0);
  assert.equal(c.timerStart(0, t0).durationMs, 1000, "never a timer of zero");
  assert.equal(c.timerStart(9e9, t0).durationMs, 86400000, "never longer than a day");
  const stopped = c.timerStop(c.timerStart(60000, t0), t0 + 20000);
  assert.equal(stopped.remainingMs, 40000, "stopping keeps what is left");
  assert.equal(c.timerRemaining(stopped, t0 + 999999), 40000, "and it stays put while stopped");
  assert.deepEqual(json(c.timerReset()), json(c.TIMER_IDLE));
});

test("the presets are the five people actually ask for", () => {
  assert.deepEqual(json(c.TIMER_PRESETS_MS), [60000, 300000, 600000, 1800000, 3600000]);
});

test("the widget owns no timer and the Clock click is only a shortcut", () => {
  const timerWidget = SRC.slice(SRC.indexOf('id: "timer"'), SRC.indexOf('id: "timer"') + 9000);
  assert.ok(timerWidget.length > 1000, "the timer widget exists");
  assert.ok(!/setInterval/.test(timerWidget), "no interval of its own");
  assert.ok(/nextTimerTickDelayMs/.test(timerWidget), "its next wake-up comes from the shared rule");
  // The Clock click must not become the only way to do anything: the timer widget carries the same controls.
  assert.ok(/TIMER_CLICK_STOPWATCH/.test(SRC), "the Clock click is a setting");
  const clock = SRC.slice(SRC.indexOf('id: "clock"'), SRC.indexOf('id: "date"'));
  assert.ok(/onClockClick|resolveClockClick/.test(clock), "the click is decided by a pure function");
});

test("a quick note goes through the one opener channel Notes already publishes", () => {
  assert.ok(/openQuickNote/.test(SRC), "the widget asks the opener for a quick note");
  assert.ok(/typeof opener\.openQuickNote !== "function"/.test(SRC), "and only offers it when Notes is there");
  assert.ok(/quickCapture: \(text\) =>/.test(NOTES), "Notes exposes exactly that one entry point");
  assert.ok(/function openNoteFromOutside\(/.test(NOTES), "and one body decides the start view for notes opened from outside");
  assert.ok(/function openQuickNoteFromHost\(text\)/.test(NOTES));
  assert.ok(/openQuickNote: \(text\) => openQuickNoteFromHost\(text\)/.test(NOTES), "same symbol, one channel");
  const host = NOTES.slice(NOTES.indexOf("quickCapture: (text) =>"), NOTES.indexOf("quickCapture: (text) =>") + 800);
  assert.ok(/store\.create\(body\)/.test(host), "the note is created by the store, not by typing into a field");
  assert.ok(/if \(!body\) \{ newNote\(""\); return true; \}/.test(host), "an empty capture just opens a fresh note");
  assert.ok(/return openNoteFromOutside\(made\.id\);/.test(host), "the new note opens through the one outside path");
});

console.log("\nPASS widgets-timer (" + passed + " tests)");
