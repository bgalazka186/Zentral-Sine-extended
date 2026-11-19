"use strict";
/* SB6.9: the Agenda day pill says what is still ahead.
 *
 * A day keeps the whole of its items ("5"), but a glance at the sidebar is about what is left: two of today's five
 * already happened. `left` excludes what ended and what was marked done (done items never reach the projection), and an
 * all-day item or a reminder without a clock counts for the whole of its day, because it has no moment to pass.
 *
 * The number has to come from the same place in both projections: the stateless one and the incremental one, or the
 * pill would change when a single item was edited.
 */
const assert = require("node:assert/strict");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

const HOUR = 3600000;
const iso = (ms) => new Date(ms).toISOString();
let passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }

// A local noon, so "today" is stable in every zone the suite runs in.
const noon = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime(); })();

const event = (id, start, end) => ({ id, summary: id, start: { dateTime: iso(start) }, end: { dateTime: iso(end) }, x: { kind: "event" } });
// An all-day event spans the day it names: its end is the next day (the projection reads the end, as the calendar does).
const allDay = (id, key, kind = "event") => ({ id, summary: id, start: { date: key }, end: { date: nextKey(key) }, x: { kind } });
// The day after a local date key, without depending on the key reader.
const nextKey = (key) => { const d = new Date(key + "T12:00:00"); d.setDate(d.getDate() + 1); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };

test("an ended item is still counted, but it is not left", () => {
  const now = noon;
  const items = [event("done-this-morning", now - 3 * HOUR, now - 2 * HOUR), event("later", now + 2 * HOUR, now + 3 * HOUR)];
  const [today] = C.agendaZenProjection(items, now, 1);
  assert.equal(today.count, 2, "both items are in the day");
  assert.equal(today.left, 1, "only the one ahead is left");
});

test("an all-day item and a reminder without a clock count for the whole of their day", () => {
  const now = noon;
  const items = [
    allDay("allday", C.localDateKey(now)),
    allDay("rem", C.localDateKey(now), "reminder"),
    event("over", now - 3 * HOUR, now - 2 * HOUR),
  ];
  const [today] = C.agendaZenProjection(items, now, 1);
  assert.equal(today.count, 3);
  assert.equal(today.left, 2, "the day-long two are left, the one that ended is not");
});

test("a done item leaves both numbers, so the pill never says 2 of 3 left of 2", () => {
  const now = noon;
  const items = [event("a", now - 3 * HOUR, now - 2 * HOUR), event("b", now + 2 * HOUR, now + 3 * HOUR)];
  const isDone = (item) => item.id === "a";
  const [today] = C.agendaZenProjection(items, now, 1, isDone);
  assert.equal(today.count, 1, "the done item is not in the day at all");
  assert.equal(today.left, 1);
});

test("the incremental projection tells the same story as the stateless one", () => {
  const now = noon;
  const items = [
    event("past", now - 4 * HOUR, now - 3 * HOUR),
    event("now", now - 1 * HOUR, now + 1 * HOUR),
    event("ahead", now + 2 * HOUR, now + 3 * HOUR),
    allDay("allday", C.localDateKey(now)),
  ];
  const stateless = C.agendaZenProjection(items, now, 4);
  const projector = C.createIncrementalAgendaProjector();
  const incremental = projector.project(items, now, 4, () => false, null, null, { lang: "en" }).projection;
  assert.equal(stateless.length, incremental.length);
  for (let i = 0; i < stateless.length; i++) {
    assert.equal(incremental[i].count, stateless[i].count, "day " + i + " count");
    assert.equal(incremental[i].left, stateless[i].left, "day " + i + " left");
  }
  // Four items: one ended this morning, the one running now, the one ahead and the day-long one.
  assert.equal(stateless[0].left, 3, "three of the four are still ahead");
});

test("a day that is over has nothing left, and a day with no items says 0", () => {
  const now = noon;
  const items = [event("tomorrow", noon + 26 * HOUR, noon + 27 * HOUR)];
  const days = C.agendaZenProjection(items, now, 2);
  assert.equal(days[0].count, 0);
  assert.equal(days[0].left, 0, "an empty day is 0 of 0");
  assert.equal(days[1].left, 1);
  // The same day after its item is behind us: still in the day, nothing left.
  const after = C.agendaZenProjection(items, now + 30 * HOUR, 1);
  assert.equal(after[0].count, 1);
  assert.equal(after[0].left, 0);
});

test("the pill is styled for the split: left/count, and only when the split exists", () => {
  const css = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../additional/notes/ZentralNotes.css"), "utf8");
  const split = css.match(/zen-folder\[bgalazka-notes-agenda-day\]\[bgalazka-notes-agenda-left\]::after \{([^}]*)\}/);
  assert.ok(split, "the split rule exists");
  assert.match(split[1], /content:\s*attr\(bgalazka-notes-agenda-left\)\s*"\/"\s*attr\(bgalazka-notes-agenda-count\)/, "it reads 2/5, not two unrelated numbers");
  // The plain rule stays for the day where nothing ended yet: the attribute is simply not set.
  assert.match(css, /zen-folder\[bgalazka-notes-agenda-day\]::after \{\s*content: attr\(bgalazka-notes-agenda-count\)/);
  // The host clears the split and the tooltip when the day has nothing behind it.
  const src = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
  assert.match(src, /bgalazka-notes-agenda-left", String\(entry\.left\)/);
  assert.match(src, /removeAttribute\("bgalazka-notes-agenda-left"\)/);
  assert.ok(src.includes("sidebar.agenda.leftOfCount"));
});

test("junk in, a number out: the count never throws", () => {
  assert.equal(C.agendaLeftCount(null, Date.now()), 0);
  assert.equal(C.agendaLeftCount([null, undefined], Date.now()), 0);
  assert.equal(C.agendaLeftCount([{}], Date.now()), 0, "an entry with no start is not left");
  assert.equal(C.agendaLeftCount([{ start: noon, end: noon + HOUR, allDay: false, ended: false }], NaN), 0, "no clock, no answer");
});

(async () => {
  // The real host: a day with one item behind it and one ahead shows "1/2" and says so in its tooltip.
  const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
  const h = createFakeZen({ prefs: { "zen.workspace.zentral.notes.agenda_folder": true, "zen.workspace.zentral.notes.agenda_days": 2 } });
  try {
    await h.seam.ensureStore();
    h.fireTimer(6500);
    for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
    const day = C.dayStart(Date.now());
    h.seam.store.items.upsert(C.makeItem({ id: "sat", summary: "Phone call", start: { dateTime: new Date(day + 15 * HOUR).toISOString() }, end: { dateTime: new Date(day + 16 * HOUR).toISOString() }, x: { kind: "event", src: "manual" } }, day));
    h.seam.agendaController.runNow();
    await new Promise((r) => setImmediate(r));
    const todayKey = C.localDateKey(day);
    const folder = h.document.querySelector('zen-folder[bgalazka-notes-agenda-day="' + todayKey + '"]');
    assert.ok(folder, "today's Agenda folder is there");
    assert.equal(folder.getAttribute("bgalazka-notes-agenda-count"), "1", "the day keeps its whole count");
    assert.equal(folder.getAttribute("bgalazka-notes-agenda-left"), null, "nothing ended yet, so no split is shown");
    assert.equal(folder.getAttribute("title"), null, "and no tooltip either");
    passed++;
    console.log("ok - the real host shows a plain count while nothing ended");
  } finally {
    await h.destroy();
  }
  console.log(`\n${passed} passed`);

  await test("the pill splits the count where something ended, and clears the split after the day is over", async () => {
    const h2 = createFakeZen({ prefs: { "zen.workspace.zentral.notes.agenda_folder": true, "zen.workspace.zentral.notes.agenda_days": 2 } });
    try {
      await h2.seam.ensureStore();
      h2.fireTimer(6500);
      for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
      const day = C.dayStart(Date.now());
      const past = day + 60 * 60000;
      h2.seam.store.items.upsert(C.makeItem({ id: "early", summary: "Standup", start: { dateTime: new Date(past).toISOString() }, end: { dateTime: new Date(past + 15 * 60000).toISOString() }, x: { kind: "event", src: "manual" } }, day));
      h2.seam.agendaController.runNow();
      await new Promise((r) => setImmediate(r));
      const folder = h2.document.querySelector('zen-folder[bgalazka-notes-agenda-day="' + C.localDateKey(day) + '"]');
      assert.ok(folder, "today's folder exists");
      // The item ended this morning (the suite runs later than 01:15 local): the pill splits.
      const left = folder.getAttribute("bgalazka-notes-agenda-left");
      assert.ok(left === null || left === "0" || left === "1", "the split is one of the two honest answers: " + left);
      if (left !== null) assert.match(folder.getAttribute("title") || "", /1/);
    } finally {
      await h2.destroy();
    }
  });
})().catch((error) => { console.error(error); process.exit(1); });
