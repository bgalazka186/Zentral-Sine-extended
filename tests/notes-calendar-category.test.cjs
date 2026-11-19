"use strict";
/* Calendar category definitions and per-item notification overrides (Track 2.3b). */
const assert = require("node:assert/strict");
const cal = require("../additional/notes/calendar/ZentralNotesCalendar.js");

let clock = new Date(2026, 10, 11, 10, 0).getTime();
function fakeIO() {
  const files = new Map();
  return {
    files,
    join: (...parts) => parts.join("/"),
    readUTF8: async (path) => { if (!files.has(path)) throw new Error("not found"); return files.get(path); },
    writeUTF8: async (path, text) => files.set(path, text),
  };
}
const makeStore = (io) => cal.createItemStore({
  io, getDir: () => "/notes", now: () => clock,
  setTimer: () => 1, clearTimer() {}, warn(error) { throw error; },
});
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("ok -", name); }

(async () => {
  await test("category names, colours and three-stage defaults are normalized", () => {
    assert.equal(cal.cleanCategoryName("  Project\n   Work%%  "), "Project Work");
    const c = cal.cleanCategory({ name: " Projects ", color: "#ABCDEF", notify: {
      pre: { enabled: false, leadMinutes: 99 }, due: { enabled: true }, followup: { enabled: false, delayMinutes: 0 },
    } });
    assert.equal(c.name, "Projects");
    assert.equal(c.color, "#abcdef");
    assert.deepEqual(c.notify, {
      pre: { enabled: false, leadMinutes: 10 },
      due: { enabled: true },
      followup: { enabled: false, delayMinutes: 1 },
    });
    assert.equal(cal.cleanCategory({ name: "  %% \n" }), null);
  });

  await test("category section lookup and assignment preserve heading scope and avoid fenced code", () => {
    const body = "# Plan\n\n## Work\n%%calendar: Work%%\n- 2026-11-12 Shift\n\n```md\n%%calendar: Fake%%\n```\n";
    const at = body.indexOf("Shift") + 2;
    assert.equal(cal.calendarSectionAt(body, at).category, "Work");
    const changed = cal.setCalendarSectionCategory(body, at, "Projects");
    assert.ok(changed && !changed.created);
    assert.match(changed.body, /%%calendar: Projects%%/);
    const fencedAt = body.indexOf("%%calendar: Fake%%") + 3;
    assert.equal(cal.setCalendarSectionCategory(body, fencedAt, "Projects"), null, "does not insert a marker inside a code fence");
    const inserted = cal.setCalendarSectionCategory("# Plan\n\nA task here\n", 9, "Projects");
    assert.ok(inserted?.created);
    assert.match(inserted.body, /%%calendar: Projects%%/);
  });

  await test("custom category registry persists in calendar.json and v1 item files still migrate", async () => {
    const io = fakeIO();
    const st = makeStore(io);
    await st.open();
    assert.deepEqual(st.categoryList().map((c) => c.name), ["Birthdays", "Deadlines", "Subscriptions", "Work"]);
    const saved = st.upsertCategory({ name: "Projects", color: "#123456", notify: { pre: { enabled: false, leadMinutes: 3 } } });
    assert.equal(saved.name, "Projects");
    assert.equal(st.category("projects").color, "#123456");
    await st.flush();
    const raw = JSON.parse(io.files.get("/notes/calendar.json"));
    assert.equal(raw.v, 2);
    assert.equal(raw.categories.length, 1);
    const reopened = makeStore(io);
    await reopened.open();
    assert.equal(reopened.category("PROJECTS").name, "Projects");
    assert.equal(reopened.category("Projects").notify.pre.enabled, false);

    io.files.set("/notes/calendar.json", JSON.stringify({ v: 1, items: [cal.makeItem({ id: "legacy", summary: "Legacy", start: { date: "2026-11-12" }, x: { category: "Work" } }, clock)] }));
    const migrated = makeStore(io);
    await migrated.open();
    assert.equal(migrated.get("legacy").summary, "Legacy");
    assert.equal(migrated.category("Work").name, "Work", "built-in categories remain available without saved definitions");
  });

  await test("item-level stage overrides round-trip to Google and survive note-list resync", async () => {
    const io = fakeIO(), st = makeStore(io);
    await st.open();
    const body = "# Plan\n%%calendar: Work%%\n- 2026-11-12 09:00-10:00 Planning\n";
    const original = cal.extractNoteItems(body, "note-1", clock)[0];
    const edited = st.upsert({ ...original, x: { ...original.x, notify: { pre: { enabled: false, leadMinutes: 2 }, due: { enabled: true } } } });
    st.syncNote("note-1", body);
    const synced = st.get(edited.id);
    assert.deepEqual(synced.x.notify, { pre: { enabled: false, leadMinutes: 2 }, due: { enabled: true } });
    const roundTrip = cal.fromGoogle(cal.toGoogle(synced));
    assert.deepEqual(roundTrip.x.notify, synced.x.notify);
  });

  await test("item category overrides preserve one line independently of its source section", async () => {
    const io = fakeIO(), st = makeStore(io); await st.open();
    const body = "# Plan\n%%calendar: Work%%\n- 2026-11-12 09:00 First %%zn-item-id:first123%%\n- 2026-11-12 10:00 Second %%zn-item-id:second12%%\n";
    st.syncNote("note-1", body); const [first, second] = st.list({ noteId: "note-1" });
    const draft = cal.composeCalendarItem({ item: first, summary: first.summary, kind: "reminder", allDay: false, startDate: "2026-11-12", startTime: "09:00", category: "" }, clock);
    assert.equal(draft.x.categoryOverride, "", "explicit No category is distinguishable from inheritance");
    assert.equal(cal.fromGoogle(cal.toGoogle(draft)).x.categoryOverride, "", "empty override survives Google-shaped serialization");
    assert.ok(st.upsert(draft)); st.syncNote("note-1", body, { sourceEdit: true, updatedAt: clock + 1 });
    assert.equal(st.get(first.id).x.category, ""); assert.equal(st.get(second.id).x.category, "Work");
    await st.flush(); const loaded = makeStore(io); await loaded.open(); loaded.syncNote("note-1", body);
    assert.equal(loaded.get(first.id).x.category, "", "explicit clearing survives disk and sync");
    const inherited = cal.composeCalendarItem({ item: loaded.get(first.id), summary: first.summary, kind: "reminder", startDate: "2026-11-12", startTime: "09:00", category: "Work", categoryOverride: null }, clock + 2);
    assert.equal(Object.hasOwn(inherited.x, "categoryOverride"), false, "a user can restore section inheritance");
    assert.ok(loaded.upsert(inherited)); loaded.syncNote("note-1", body.replace("calendar: Work", "calendar: Personal"), { sourceEdit: true, updatedAt: clock + 3 });
    assert.equal(loaded.get(first.id).x.category, "Personal", "inherited item follows later section edits");
  });

  console.log(`${passed} calendar category tests passed`);
})().catch((error) => { console.error(error); process.exit(1); });
