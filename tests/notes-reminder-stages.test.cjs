"use strict";
const assert = require("node:assert/strict");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

const at = Date.parse("2026-11-13T12:00:00.000Z");
const item = (start, notify = {}, updated = "2026-11-13T08:00:00.000Z") => C.makeItem({
  id: "rem-1", summary: "Appointment", updated, start: { dateTime: new Date(start).toISOString() },
  x: { kind: "reminder", category: "Work", notify },
}, at);

function test(name, fn) { try { fn(); console.log("ok -", name); } catch (error) { console.error("FAIL " + name + "\n", error); process.exitCode = 1; } }

test("three-stage plan uses adaptive lead capped by configured lead and exact due/follow-up times", () => {
  const it = item(at + 5 * 60 * 60 * 1000, { pre: { enabled: true, leadMinutes: 10 }, due: { enabled: true }, followup: { enabled: true, delayMinutes: 3 } });
  const stages = C.reminderStagePlan(it, null, at);
  assert.deepEqual(stages.map((s) => s.stage), ["pre", "due", "followup"]);
  assert.equal(stages[0].at, at + 5 * 60 * 60 * 1000 - 10 * 60000);
  assert.equal(stages[1].at, at + 5 * 60 * 60 * 1000);
  assert.equal(stages[2].at, at + 5 * 60 * 60 * 1000 + 3 * 60000);
});

test("adaptive pre-alert scales from one to ten minutes using the saved scheduling horizon", () => {
  const soon = item(at + 4 * 60000, { pre: { enabled: true, leadMinutes: 10 } }, new Date(at).toISOString());
  const far = item(at + 4 * 60 * 60 * 1000, { pre: { enabled: true, leadMinutes: 10 } }, new Date(at).toISOString());
  assert.equal(C.reminderStagePlan(soon, null, at)[0].leadMinutes, 1);
  assert.equal(C.reminderStagePlan(far, null, at)[0].leadMinutes, 10);
});

test("category defaults are inherited and item overrides win without mutating either input", () => {
  const category = { pre: { enabled: true, leadMinutes: 4 }, due: { enabled: true }, followup: { enabled: true, delayMinutes: 7 } };
  const it = item(at + 60 * 60000, { due: { enabled: false }, followup: { delayMinutes: 2 } });
  const before = JSON.stringify([category, it.x.notify]);
  const stages = C.reminderStagePlan(it, category, at);
  assert.deepEqual(stages.map((s) => s.stage), ["pre", "followup"]);
  assert.equal(stages[0].leadMinutes, 4);
  assert.equal(stages[1].delayMinutes, 2);
  assert.equal(JSON.stringify([category, it.x.notify]), before);
});

test("disabled stages, invalid items, and already-past stages are represented safely", () => {
  const disabled = item(at + 60000, { pre: { enabled: false }, due: { enabled: false }, followup: { enabled: false } });
  assert.deepEqual(C.reminderStagePlan(disabled, null, at), []);
  assert.deepEqual(C.reminderStagePlan(null, null, at), []);
  const past = item(at + 30000, { pre: { enabled: true, leadMinutes: 10 } }, new Date(at - 3600000).toISOString());
  const stage = C.reminderStagePlan(past, null, at)[0];
  assert.ok(stage.at < at);
  assert.equal(stage.stage, "pre");
});

// History claims are stage-scoped: one window's pre-alert must not suppress the due or follow-up stage.
(async () => {
  const files = new Map();
  const io = {
    join: (...parts) => parts.join("/"),
    readUTF8: async (key) => { if (!files.has(key)) { const error = new Error("not found"); error.code = "ENOENT"; throw error; } return files.get(key); },
    writeUTF8: async (key, value) => files.set(key, value),
    exists: async (key) => files.has(key),
  };
  let now = at;
  const makeHistory = () => C.createReminderHistoryStore({ io, getDir: () => "/profile", now: () => now, setTimer: () => 0, clearTimer() {} });
  const first = makeHistory(), second = makeHistory();
  await first.open(); await second.open();
  const entry = { itemId: "rem-1", occurrenceId: "rem-1", summary: "Appointment", start: { dateTime: new Date(at + 3600000).toISOString() }, at: now };
  assert.ok(await first.claimAlert({ ...entry, stage: "pre" }));
  assert.equal(await second.claimAlert({ ...entry, stage: "pre" }), null);
  assert.ok(await second.claimAlert({ ...entry, stage: "due" }));
  assert.ok(await second.claimAlert({ ...entry, stage: "followup" }));
  const reloaded = makeHistory(); await reloaded.open();
  assert.deepEqual(reloaded.list().map((record) => record.stage).sort(), ["due", "followup", "pre"]);
  console.log("ok - history claims are stage-scoped, cross-window and durable");
})().catch((error) => { console.error("FAIL stage history claims\n", error); process.exitCode = 1; });

test("Day-Plan snapshot separates local Today and Tomorrow, filters completed items and prepares a Markdown preview", () => {
  const today = new Date(2026, 10, 13, 9, 0).getTime();
  const todayKey = C.ymd(new Date(today)), tomorrowKey = C.ymd(new Date(today + 86400000));
  const rows = [
    C.makeItem({ id: "today", summary: "Stand-up", start: { dateTime: new Date(new Date(2026, 10, 13, 10, 30).getTime()).toISOString() }, x: { kind: "reminder" } }, today),
    C.makeItem({ id: "tomorrow", summary: "Dentist", start: { dateTime: new Date(new Date(2026, 10, 14, 8, 15).getTime()).toISOString() }, x: { kind: "reminder" } }, today),
  ];
  const plan = C.dayPlanSnapshot(rows, today, (it) => it.id === "today");
  assert.equal(plan.today.key, todayKey);
  assert.equal(plan.today.count, 0);
  assert.equal(plan.tomorrow.key, tomorrowKey);
  assert.equal(plan.tomorrow.count, 1);
  assert.match(plan.tomorrowPreview, /^## Tomorrow\n- 08:15 · Dentist$/);
});

test("quiet hours are OFF by default and overnight windows use the selected start weekday", () => {
  assert.equal(C.cleanAlertSettings(null).quietHours.enabled, false);
  const settings = { quietHours: { enabled: true, start: "22:00", end: "07:00", days: [5] } };
  assert.equal(C.quietHoursActive(new Date(2026, 10, 13, 23, 30).getTime(), settings.quietHours), true, "Friday evening is in the window");
  assert.equal(C.quietHoursActive(new Date(2026, 10, 14, 6, 59).getTime(), settings.quietHours), true, "Saturday morning belongs to Friday's overnight window");
  assert.equal(C.quietHoursActive(new Date(2026, 10, 14, 7, 0).getTime(), settings.quietHours), false, "the end is exclusive");
  assert.equal(C.quietHoursActive(new Date(2026, 10, 14, 23, 0).getTime(), settings.quietHours), false, "Saturday is not a selected start day");
});

test("sound and quiet-hour bypass precedence is reminder > note > category > global", () => {
  const now = new Date(2026, 10, 13, 23, 0).getTime();
  const global = { stages: { due: { sound: "loud" } }, quietHours: { enabled: true, start: "22:00", end: "07:00", days: [5], allowed: { due: ["loud"] } } };
  const category = { due: { sound: "quiet", quietAllow: ["quiet"] } };
  const note = { due: { sound: "normal", quietAllow: ["normal"] } };
  const reminder = { x: { notify: { due: { sound: "silent", quietAllow: [] } } } };
  const itemPolicy = C.resolveAlertPolicy(reminder, category, note, global, "due", now);
  assert.equal(itemPolicy.sound, "silent");
  assert.equal(itemPolicy.play, false);
  const notePolicy = C.resolveAlertPolicy({ x: {} }, category, note, global, "due", now);
  assert.equal(notePolicy.sound, "normal");
  assert.equal(notePolicy.play, true, "note-level allow-list bypasses quiet hours");
  const categoryPolicy = C.resolveAlertPolicy({ x: {} }, category, null, global, "due", now);
  assert.equal(categoryPolicy.sound, "quiet");
  assert.equal(categoryPolicy.play, true, "category-level sound and bypass are inherited");
  const globalPolicy = C.resolveAlertPolicy({ x: {} }, null, null, global, "due", now);
  assert.equal(globalPolicy.sound, "loud");
  assert.equal(globalPolicy.play, true, "global allow-list applies when no narrower override exists");
  assert.equal(C.resolveAlertPolicy({ x: {} }, null, null, null, "pre", now).play, true, "quiet hours off preserves existing sound behavior");
});

test("category sound defaults remain inherited after a calendar.json round trip", () => {
  const category = C.cleanCategory({ name: "General" });
  assert.equal(Object.hasOwn(category.notify.due, "sound"), false);
  const restored = C.cleanCategory({ ...category });
  assert.equal(Object.hasOwn(restored.notify.due, "sound"), false);
  const policy = C.resolveAlertPolicy({ x: {} }, restored.notify, null, { stages: { due: { sound: "quiet" } } }, "due", at);
  assert.equal(policy.sound, "quiet", "default category sound does not mask a global profile");
});
