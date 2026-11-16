"use strict";
/* OW-08a — Alert stage 1 (pre): live countdown chip to due time, stronger default sound
 * ("normal" instead of "quiet"), non-modal corner status card, quiet-hours & one-alert-per-stage preserved. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const cal = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const notesSource = fs.readFileSync(path.join(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const notesCss = fs.readFileSync(path.join(__dirname, "../additional/notes/ZentralNotes.css"), "utf8");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("ok - " + name);
}

(async () => {
  await test("Stage 1 default sound is 'normal' (stronger than 'quiet') while preserving quiet-hours suppression and override precedence", () => {
    assert.equal(cal.DEFAULT_ALERT_SETTINGS.stages.pre.sound, "normal");
    assert.deepEqual(cal.DEFAULT_ALERT_SETTINGS.stages.pre.quietAllow, []);

    const cleaned = cal.cleanAlertSettings(null);
    assert.equal(cleaned.stages.pre.sound, "normal");

    // Outside quiet hours: Stage 1 plays at normal volume (0.2 > quiet 0.08, < loud 0.35).
    const dayTime = new Date(2026, 10, 16, 14, 0, 0).getTime();
    const policyDay = cal.resolveAlertPolicy({ x: {} }, null, null, null, "pre", dayTime);
    assert.equal(policyDay.sound, "normal");
    assert.equal(policyDay.play, true);
    assert.equal(policyDay.volume, 0.2);

    // During active quiet hours with default empty allow-list: Stage 1 sound is suppressed.
    const nightTime = new Date(2026, 10, 16, 23, 30, 0).getTime();
    const quietGlobal = {
      quietHours: { enabled: true, start: "22:00", end: "07:00", days: [0, 1, 2, 3, 4, 5, 6] },
    };
    const policyNight = cal.resolveAlertPolicy({ x: {} }, null, null, quietGlobal, "pre", nightTime);
    assert.equal(policyNight.sound, "normal");
    assert.equal(policyNight.quiet, true);
    assert.equal(policyNight.play, false);

    // Category / note / item overrides still take precedence over global Stage 1 default.
    const quietItem = { x: { notify: { pre: { sound: "quiet" } } } };
    assert.equal(cal.resolveAlertPolicy(quietItem, null, null, null, "pre", dayTime).sound, "quiet");
  });

  await test("pure countdown helpers compute dueAt (honoring Google lead overrides) and tabular countdown text + next tick delay", () => {
    assert.equal(typeof cal.reminderDueAt, "function");
    assert.equal(typeof cal.reminderPreCountdownText, "function");
    assert.equal(typeof cal.reminderCountdownDelayMs, "function");

    const base = new Date(2026, 10, 16, 15, 0, 0).getTime();
    const plain = { start: { dateTime: new Date(base).toISOString() }, x: { kind: "reminder" } };
    assert.equal(cal.reminderDueAt(plain), base);

    const withOverride = {
      start: { dateTime: new Date(base).toISOString() },
      reminders: { overrides: [{ minutes: 10 }] },
      x: { kind: "reminder" },
    };
    assert.equal(cal.reminderDueAt(withOverride), base - 10 * 60000);

    assert.equal(cal.reminderPreCountdownText(base, base - 5 * 60000), "Due in 5:00");
    assert.equal(cal.reminderPreCountdownText(base, base - (4 * 60000 + 59000)), "Due in 4:59");
    assert.equal(cal.reminderPreCountdownText(base, base - 45000), "Due in 0:45");
    assert.equal(cal.reminderPreCountdownText(base, base - 400), "Due in 0:01");
    assert.equal(cal.reminderPreCountdownText(base, base), "Due now");
    assert.equal(cal.reminderPreCountdownText(base, base + 5000), "Due now");
    assert.equal(cal.reminderPreCountdownText(0, base), "");

    assert.equal(cal.reminderCountdownDelayMs(base, base - 5000), 1000);
    assert.equal(cal.reminderCountdownDelayMs(base, base - 4350), 350);
    assert.equal(cal.reminderCountdownDelayMs(base, base), 0);
  });

  await test("Stage 1 alert card renders non-modal live countdown chip, ticks down to Due now, stops idle timers, and honors one-alert-per-stage", async () => {
    const dom = require("./helpers/fake-dom.cjs")();
    const { document } = dom;
    const win = {
      __zentralNotesParts: { "notes-calendar": cal },
      document,
      ZentralRuntime: { register() {} },
      __zentralNotesTestSeam: {},
    };
    win.window = win;
    vm.runInNewContext(notesSource, {
      window: win, document, globalThis: { Services: {} }, ChromeUtils: {},
      console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, setTimeout, clearTimeout,
    });
    const core = win.__zentralNotesTestSeam.core;

    let clockNow = new Date(2026, 10, 16, 14, 55, 0).getTime();
    const dueAt = clockNow + 5 * 60000; // 15:00:00
    let nextTimerId = 1;
    const timers = new Map();
    const setTimer = (fn, ms) => {
      const id = nextTimerId++;
      timers.set(id, { fn, at: clockNow + ms, ms });
      return id;
    };
    const clearTimer = (id) => { timers.delete(id); };
    const advanceTo = (targetMs) => {
      clockNow = targetMs;
      for (const [id, entry] of [...timers.entries()].sort((a, b) => a[1].at - b[1].at)) {
        if (entry.at <= clockNow) {
          timers.delete(id);
          entry.fn();
        }
      }
    };

    let records = [];
    let onHistory = null;
    const history = {
      list: () => records,
      stateFor: () => "pending",
      on(fn) { onHistory = fn; return () => { onHistory = null; }; },
    };
    const listen = (target, type, fn) => {
      target.addEventListener(type, fn);
      return () => target.removeEventListener(type, fn);
    };

    const stack = core.createReminderAlertStack({
      document, history, listen,
      now: () => clockNow,
      setTimer,
      clearTimer,
    });

    // Focus an existing element in document to verify Stage 1 stays non-modal and does not steal focus.
    const editorInput = document.createElement("input");
    document.body.append(editorInput);
    editorInput.focus();
    assert.ok(document.activeElement === editorInput, "editor holds focus before Stage 1 alert");

    const id = { itemId: "standup", occurrenceId: "standup@1" };
    const actions = [{ id: "done", label: "Done", callback: () => true }];
    assert.equal(stack.show({ identity: id, title: "Team stand-up", stage: "pre", dueAt, actions }), true);

    assert.ok(document.activeElement === editorInput, "Stage 1 alert remains non-modal and preserves active focus");
    const stackHost = document.documentElement.querySelector(".zn-reminder-stack");
    const card = document.documentElement.querySelector(".zn-reminder-card");
    assert.ok(stackHost && card, "Stage 1 alert rendered in corner stack");
    assert.equal(card.getAttribute("data-stage"), "pre");
    assert.equal(card.getAttribute("role"), "status");

    const chip = card.querySelector(".zn-reminder-countdown");
    assert.ok(chip, "Stage 1 card renders .zn-reminder-countdown chip");
    assert.equal(chip.getAttribute("aria-hidden"), "true", "ticking countdown chip is aria-hidden to prevent polite live-region chatter");
    assert.equal(chip.textContent, "Due in 5:00");
    assert.equal(timers.size, 1, "one countdown timer armed while Stage 1 pre-alert is active");

    // Tick 1 second forward -> 4:59
    advanceTo(clockNow + 1000);
    assert.equal(chip.textContent, "Due in 4:59");
    assert.equal(timers.size, 1);

    // Jump to 3 seconds before due -> 0:03, then to exact due time -> Due now and timer stops!
    advanceTo(dueAt - 3000);
    assert.equal(chip.textContent, "Due in 0:03");
    assert.equal(timers.size, 1);

    advanceTo(dueAt);
    assert.equal(chip.textContent, "Due now");
    assert.equal(timers.size, 0, "countdown timer stops once due time is reached (no permanent polling)");

    // Re-open fresh Stage 1 card with 2 minutes left, then upgrade to Stage 2 ('due') -> replaces card without countdown chip and clears timer.
    clockNow = dueAt - 120000;
    stack.show({ identity: id, title: "Team stand-up", stage: "pre", dueAt, actions });
    assert.equal(timers.size, 1);
    stack.show({ identity: id, title: "Team stand-up", stage: "due", dueAt, actions });
    const dueCard = document.documentElement.querySelector(".zn-reminder-card");
    assert.equal(dueCard.getAttribute("data-stage"), "due");
    assert.equal(dueCard.querySelector(".zn-reminder-countdown"), null, "Stage 2 card does not render Stage 1 pre countdown chip");
    assert.equal(timers.size, 0, "upgrading Stage 1 -> Stage 2 cancels countdown timer immediately");

    // One-alert-per-stage rule: stale Stage 1 ('pre') cannot downgrade an open Stage 2 ('due') card,
    // and scheduler claims Stage 1 once per occurrence/schedule.
    stack.show({ identity: id, title: "Team stand-up", stage: "pre", dueAt, actions });
    assert.equal(document.documentElement.querySelector(".zn-reminder-card").getAttribute("data-stage"), "due");
    assert.equal(timers.size, 0);

    // Verify destroy() cleans up active Stage 1 countdown timers too.
    const id2 = { itemId: "review", occurrenceId: "review@1" };
    stack.show({ identity: id2, title: "Code review", stage: "pre", dueAt, actions });
    assert.equal(timers.size, 1);
    stack.destroy();
    assert.equal(timers.size, 0, "destroy() cancels any armed countdown timer");

    // Verify showReminders forwards dueAt to alertStack.show, and CSS styles .zn-reminder-countdown with tabular-nums.
    const begin = notesSource.indexOf("      function showReminders(list) {");
    const end = notesSource.indexOf("      const reminders = createReminderScheduler", begin);
    const shown = [];
    const mock = {
      disposed: false,
      CALENDAR_PART: { ...cal, resolveAlertPolicy: () => ({ play: false }) },
      store: { meta: {}, items: {} },
      alertStack: { show: (x) => shown.push(x) },
      createReminderAlertActions: () => [],
      titleOf: () => "",
      openReminderNote() {}, showNotes() {}, warn() {},
    };
    vm.runInNewContext(notesSource.slice(begin, end) + "\nthis.showReminders = showReminders;", mock);
    mock.showReminders([{
      __calendarReminder: true,
      __calendarItem: { id: "r1", summary: "Call", start: { dateTime: new Date(dueAt).toISOString() }, x: { kind: "reminder" } },
      __stage: "pre",
    }]);
    assert.equal(shown.length, 1);
    assert.equal(shown[0].stage, "pre");
    assert.equal(shown[0].dueAt, dueAt);
    assert.match(notesCss, /\.zn-reminder-countdown\s*\{[\s\S]*?font-variant-numeric:\s*tabular-nums/);
  });

  console.log(`\n${passed} Stage 1 alert tests passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
