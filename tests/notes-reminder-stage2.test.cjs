"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const cal = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const makeDom = require("./helpers/fake-dom.cjs");

function loadCore(dom, extraWin = {}) {
  const win = {
    __zentralNotesParts: { "notes-calendar": cal },
    document: dom.document,
    ZentralRuntime: { register() {} },
    __zentralNotesTestSeam: {},
    ...extraWin,
  };
  win.window = win;
  vm.runInNewContext(
    fs.readFileSync(require.resolve("../additional/notes/ZentralNotes.uc.js"), "utf8"),
    {
      window: win,
      document: dom.document,
      globalThis: { Services: {} },
      ChromeUtils: {},
      console,
      URL,
      Date,
      JSON,
      Math,
      Promise,
      RegExp,
      Number,
      Map,
      Set,
      setTimeout,
      clearTimeout,
    }
  );
  return win.__zentralNotesTestSeam.core;
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("ok - " + name);
}

(async () => {
  await test("Stage 2 presentation, louder 'loud' default sound, and WebAudio urgent pulse fallback", () => {
    const pre = cal.reminderAlertPresentation("pre");
    const due = cal.reminderAlertPresentation("due");
    const followup = cal.reminderAlertPresentation("followup");

    assert.equal(pre.layout, "corner");
    assert.equal(pre.persistent, false);
    assert.equal(due.stage, "due");
    assert.equal(due.rank, 2);
    assert.equal(due.label, "Due now");
    assert.equal(due.layout, "large");
    assert.equal(due.persistent, true);
    assert.equal(followup.layout, "centred");
    assert.equal(followup.persistent, true);

    assert.equal(cal.REMINDER_STACK_LIMIT, 3);
    assert.equal(typeof cal.reminderStackMoreLabel, "function");
    assert.equal(cal.reminderStackMoreLabel(0, false), "");
    assert.equal(cal.reminderStackMoreLabel(2, false), "+2 more");
    assert.equal(cal.reminderStackMoreLabel(2, true), "Show fewer");

    // Stage 2 default sound is 'loud' (0.35), strictly louder than Stage 1 'normal' (0.20).
    assert.equal(cal.DEFAULT_ALERT_SETTINGS.stages.due.sound, "loud");
    const dayTime = new Date(2026, 10, 16, 14, 0, 0).getTime();
    const prePolicy = cal.resolveAlertPolicy({ x: {} }, null, null, null, "pre", dayTime);
    const duePolicy = cal.resolveAlertPolicy({ x: {} }, null, null, null, "due", dayTime);
    assert.equal(duePolicy.sound, "loud");
    assert.equal(duePolicy.play, true);
    assert.ok(duePolicy.volume > prePolicy.volume, "Stage 2 default volume must exceed Stage 1");

    // Quiet hours still suppress Stage 2 sound unless 'loud' is in quietHours.allowed.due.
    const nightTime = new Date(2026, 10, 16, 23, 30, 0).getTime();
    const quietGlobal = {
      quietHours: { enabled: true, start: "22:00", end: "07:00", days: [0, 1, 2, 3, 4, 5, 6] },
    };
    const dueNight = cal.resolveAlertPolicy({ x: {} }, null, null, quietGlobal, "due", nightTime);
    assert.equal(dueNight.sound, "loud");
    assert.equal(dueNight.quiet, true);
    assert.equal(dueNight.play, false);

    // playReminderSound('due') defaults to Stage 2 'loud' volume (0.35) and 3 urgent pulses even without explicit policy.
    const source = fs.readFileSync(require.resolve("../additional/notes/ZentralNotes.uc.js"), "utf8");
    const fnBegin = source.indexOf("      let soundCtx = null;\n      function playReminderSound");
    const fnEnd = source.indexOf("      onCleanup(() => { try { soundCtx?.close?.(); }", fnBegin);
    assert.ok(fnBegin >= 0 && fnEnd > fnBegin);
    const oscCalls = [];
    const gainRamps = [];
    class FakeAudioContext {
      constructor() { this.state = "running"; this.currentTime = 10; this.destination = {}; }
      createOscillator() {
        const osc = { frequency: { value: 0 }, connect: (g) => g, start(t) { osc.started = t; }, stop(t) { osc.stopped = t; } };
        oscCalls.push(osc);
        return osc;
      }
      createGain() {
        const ramps = [];
        gainRamps.push(ramps);
        return {
          gain: { setValueAtTime() {}, exponentialRampToValueAtTime(v) { ramps.push(v); } },
          connect() {},
        };
      }
    }
    const audioCtx = {
      CALENDAR_PART: cal,
      window: { AudioContext: FakeAudioContext },
      Services: { sound: { beep() {} } },
      warn() {},
    };
    vm.runInNewContext(source.slice(fnBegin, fnEnd) + "\nthis.playReminderSound = playReminderSound;", audioCtx);
    audioCtx.playReminderSound("due");
    assert.equal(oscCalls.length, 3, "Stage 2 plays 3 urgent audio pulses");
    assert.equal(gainRamps[0][0], duePolicy.volume, "Stage 2 fallback uses 'loud' volume");
  });

  await test("Stage 2 renders a large persistent card without unrecorded Close escape, staying until acted on", () => {
    const dom = makeDom();
    let nowMs = new Date(2026, 10, 16, 15, 0, 0).getTime();
    const timers = [];
    const core = loadCore(dom);
    let historyRecords = [];
    let onHistory = null;
    const history = {
      list: ({ itemId, occurrenceId }) =>
        historyRecords.filter((r) => r.itemId === itemId && r.occurrenceId === occurrenceId),
      stateFor: () => "pending",
      on(fn) { onHistory = fn; return () => { onHistory = null; }; },
    };
    const listen = (target, type, fn) => {
      target.addEventListener(type, fn);
      return () => target.removeEventListener(type, fn);
    };
    const stack = core.createReminderAlertStack({
      document: dom.document,
      history,
      listen,
      now: () => nowMs,
      setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
      clearTimer: () => {},
    });

    let acted = "";
    const actions = [
      { id: "open", label: "Open linked note", callback: () => { acted = "open"; return true; } },
      { id: "done", label: "Done", callback: () => { acted = "done"; return true; } },
      { id: "snooze-10", label: "Snooze 10 min", callback: () => { acted = "snooze"; return true; } },
      { id: "dismiss", label: "Dismiss", callback: () => { acted = "dismiss"; return true; } },
    ];

    // Stage 1 card still offers non-persistent local Close button.
    const q = (sel) => dom.document.documentElement.querySelector(sel);
    const qa = (sel) => dom.document.documentElement.querySelectorAll(sel);
    stack.show({ identity: { itemId: "s1", occurrenceId: "s1" }, title: "Early heads up", stage: "pre", actions });
    const preCard = q('.zn-reminder-card[data-stage="pre"]');
    assert.equal(preCard.getAttribute("data-layout"), "corner");
    assert.notEqual(preCard.querySelector('[data-action="close"]'), null, "Stage 1 keeps local Close button");
    preCard.querySelector('[data-action="close"]').click();
    assert.equal(qa(".zn-reminder-card").length, 0);

    // Stage 2 card is marked large + persistent, highlights Done, and omits unrecorded Close button.
    stack.show({ identity: { itemId: "s2", occurrenceId: "s2" }, title: "Submit quarterly filing", stage: "due", actions });
    assert.equal(timers.length, 0, "Stage 2 registers no auto-dismiss or countdown timer");
    const dueCard = q('.zn-reminder-card[data-stage="due"]');
    assert.ok(dueCard);
    assert.equal(dueCard.getAttribute("data-layout"), "large");
    assert.equal(dueCard.getAttribute("data-persistent"), "true");
    assert.equal(dueCard.querySelector('[data-action="close"]'), null, "Stage 2 persistent card omits unrecorded Close button");
    const doneBtn = dueCard.querySelector('[data-action="done"]');
    assert.ok(doneBtn.classList.contains("zn-reminder-action-primary"), "Done button gets primary action styling");

    // Advancing wall clock by 2 hours does not dismiss Stage 2 card.
    nowMs += 2 * 3600 * 1000;
    assert.equal(qa('.zn-reminder-card[data-stage="due"]').length, 1);

    // Acting on Done closes the card.
    doneBtn.click();
    assert.equal(acted, "done");
    assert.equal(qa(".zn-reminder-card").length, 0);

    // Defensive fallback: if a Stage 2 card is created with zero actions, Close remains so it is never trapped.
    stack.show({ identity: { itemId: "bare", occurrenceId: "bare" }, title: "Bare due card", stage: "due", actions: [] });
    const bareCard = q('.zn-reminder-card[data-stage="due"]');
    assert.notEqual(bareCard.querySelector('[data-action="close"]'), null);
    bareCard.querySelector('[data-action="close"]').click();
    assert.equal(qa(".zn-reminder-card").length, 0);

    // History resolution from another window also closes a persistent Stage 2 card.
    stack.show({ identity: { itemId: "sync", occurrenceId: "sync" }, title: "Cross-window due", stage: "due", actions });
    historyRecords = [{ id: "h1", itemId: "sync", occurrenceId: "sync", action: "done" }];
    onHistory({ kind: "refresh" });
    assert.equal(qa(".zn-reminder-card").length, 0);

    stack.destroy();
  });

  await test("ZentralNotes.css styles larger Stage 2 card, calm accent pulse, prefers-reduced-motion override, and +N more control", () => {
    const fullCss = fs.readFileSync(require.resolve("../additional/notes/ZentralNotes.css"), "utf8");
    const stackIdx = fullCss.indexOf(".zn-reminder-stack {");
    assert.ok(stackIdx >= 0);
    const css = fullCss.slice(stackIdx);
    // Wider corner stack when a large / Stage 2 card is visible.
    assert.match(css, /\.zn-reminder-stack:has\(\.zn-reminder-card\[data-(?:stage="due"|layout="large")\]\)[\s\S]*?width:\s*min\(440px/);
    // Larger Stage 2 card with accent pulse animation.
    assert.match(css, /\.zn-reminder-card\[data-stage="due"\][^{]*\{[^}]*padding:\s*16px\s+18px[^}]*animation:\s*zn-reminder-due-accent\b/);
    assert.match(css, /@keyframes\s+zn-reminder-due-accent\b/);
    // prefers-reduced-motion disables Stage 2 accent pulse animation.
    const rmMatch = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?\})\s*\}/);
    assert.ok(rmMatch, "prefers-reduced-motion media block exists");
    assert.match(rmMatch[1], /\.zn-reminder-card\[data-stage="due"\]/);
    assert.match(rmMatch[1], /animation:\s*none/);
    // +N more overflow toggle styled.
    assert.match(css, /\.zn-reminder-more\s*\{/);
  });

  await test("Stack limit caps visible cards at 3 with '+N more', prioritizes Stage 2 over Stage 1, promotes on close/history, and toggles expand", () => {
    const dom = makeDom();
    const core = loadCore(dom);
    let historyRecords = [];
    let onHistory = null;
    const history = {
      list: ({ itemId, occurrenceId }) =>
        historyRecords.filter((r) => r.itemId === itemId && r.occurrenceId === occurrenceId),
      stateFor: () => "pending",
      on(fn) { onHistory = fn; return () => { onHistory = null; }; },
    };
    const listen = (target, type, fn) => {
      target.addEventListener(type, fn);
      return () => target.removeEventListener(type, fn);
    };
    const q = (sel) => dom.document.documentElement.querySelector(sel);
    const qa = (sel) => dom.document.documentElement.querySelectorAll(sel);
    const stack = core.createReminderAlertStack({ document: dom.document, history, listen });
    const mkActions = (key) => [{ id: "done", label: "Done", callback: () => { doneKeys.push(key); return true; } }];
    const doneKeys = [];

    // Add 2 Stage 1 cards and 3 Stage 2 cards (5 total > limit 3).
    stack.show({ identity: { itemId: "p1", occurrenceId: "p1" }, title: "Pre 1", stage: "pre", actions: mkActions("p1") });
    stack.show({ identity: { itemId: "p2", occurrenceId: "p2" }, title: "Pre 2", stage: "pre", actions: mkActions("p2") });
    stack.show({ identity: { itemId: "d1", occurrenceId: "d1" }, title: "Due 1", stage: "due", actions: mkActions("d1") });
    stack.show({ identity: { itemId: "d2", occurrenceId: "d2" }, title: "Due 2", stage: "due", actions: mkActions("d2") });
    stack.show({ identity: { itemId: "d3", occurrenceId: "d3" }, title: "Due 3", stage: "due", actions: mkActions("d3") });

    // Only 3 cards are mounted in DOM, and all 3 are the higher-priority Stage 2 cards!
    let visibleTitles = qa(".zn-reminder-card .zn-reminder-title").map((el) => el.textContent);
    assert.deepEqual(visibleTitles, ["Due 1", "Due 2", "Due 3"]);

    let moreBtn = q(".zn-reminder-more");
    assert.ok(moreBtn, "+N more button rendered when stack exceeds limit");
    assert.equal(moreBtn.textContent, "+2 more");
    assert.equal(moreBtn.getAttribute("aria-expanded"), "false");

    // Clicking '+2 more' expands all 5 cards in priority order and flips button to 'Show fewer'.
    moreBtn.click();
    visibleTitles = qa(".zn-reminder-card .zn-reminder-title").map((el) => el.textContent);
    assert.deepEqual(visibleTitles, ["Due 1", "Due 2", "Due 3", "Pre 1", "Pre 2"]);
    moreBtn = q(".zn-reminder-more");
    assert.equal(moreBtn.textContent, "Show fewer");
    assert.equal(moreBtn.getAttribute("aria-expanded"), "true");

    // Clicking 'Show fewer' collapses back to 3 visible cards and '+2 more'.
    moreBtn.click();
    assert.equal(qa(".zn-reminder-card").length, 3);
    assert.equal(q(".zn-reminder-more").textContent, "+2 more");

    // Completing visible 'Due 1' promotes 'Pre 1' into the 3rd slot and updates '+2 more' -> '+1 more'.
    qa(".zn-reminder-card")[0].querySelector('[data-action="done"]').click();
    assert.deepEqual(doneKeys, ["d1"]);
    visibleTitles = qa(".zn-reminder-card .zn-reminder-title").map((el) => el.textContent);
    assert.deepEqual(visibleTitles, ["Due 2", "Due 3", "Pre 1"]);
    assert.equal(q(".zn-reminder-more").textContent, "+1 more");

    // Upgrading overflow 'Pre 2' to Stage 2 ('due') promotes it ahead of 'Pre 1' while keeping '+1 more'!
    stack.show({ identity: { itemId: "p2", occurrenceId: "p2" }, title: "Pre 2 now Due", stage: "due", actions: mkActions("p2") });
    visibleTitles = qa(".zn-reminder-card .zn-reminder-title").map((el) => el.textContent);
    assert.deepEqual(visibleTitles, ["Due 2", "Due 3", "Pre 2 now Due"]);
    assert.equal(q(".zn-reminder-more").textContent, "+1 more");

    // Resolving overflow 'Pre 1' via reminder history removes it from overflow and hides '+1 more'!
    historyRecords = [{ id: "hp1", itemId: "p1", occurrenceId: "p1", action: "done" }];
    onHistory({ kind: "refresh" });
    assert.equal(qa(".zn-reminder-card").length, 3);
    assert.equal(q(".zn-reminder-more"), null, "+N more disappears once stack fits within limit");

    stack.destroy();

    // Verify showReminders forwards >15 reminders into alertStack so +N more reflects large due batches.
    const source = fs.readFileSync(require.resolve("../additional/notes/ZentralNotes.uc.js"), "utf8");
    const begin = source.indexOf("      function showReminders(list) {");
    const end = source.indexOf("      const reminders = createReminderScheduler", begin);
    const shown = [];
    const mock = {
      disposed: false,
      CALENDAR_PART: { ...cal, resolveAlertPolicy: () => ({ play: false }) },
      store: { meta: {}, items: {} },
      alertStack: { show: (x) => shown.push(x) },
      createReminderAlertActions: () => [],
      titleOf: () => "",
      openReminderNote() {},
      showNotes() {},
      warn() {},
    };
    vm.runInNewContext(source.slice(begin, end) + "\nthis.showReminders = showReminders;", mock);
    const batch = Array.from({ length: 20 }, (_, i) => ({
      __calendarReminder: true,
      __calendarItem: { id: "b" + i, summary: "Item " + i, start: { dateTime: "2026-11-16T15:00:00.000Z" }, x: { kind: "reminder" } },
      __stage: "due",
    }));
    mock.showReminders(batch);
    assert.equal(shown.length, 20, "showReminders passes all 20 due items to alertStack for +N more overflow accounting");
  });

  console.log(`\n${passed} Stage 2 alert tests passed`);
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
