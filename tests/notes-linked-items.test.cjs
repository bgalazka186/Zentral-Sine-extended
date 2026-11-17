"use strict";
/* OW-59: unlinking a reminder or an event from its note, and listing what a note (or one date) has linked.
 * The note text is the only truth, so an unlink is a text edit: the words stay and only the date (or a generated
 * Agenda line) goes. These tests drive the real store, so "the item is gone" means the reconciler said so. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const calPath = path.resolve(__dirname, "../additional/notes/calendar/ZentralNotesCalendar.js");
const cal = require(calPath);
const dom = require("./helpers/fake-dom.cjs")();
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const en = require("../additional/notes/i18n/en.js");
cal.registerLanguage("en", en);

const win = {
  __zentralNotesParts: { "notes-calendar": cal },
  __zentralNotesLangTables: { en },
  document: dom.document,
  ZentralRuntime: { register() {} },
  __zentralNotesTestSeam: {},
  requestAnimationFrame() {},
  cancelAnimationFrame() {},
  setTimeout,
  clearTimeout,
  innerWidth: 1200,
  innerHeight: 800,
};
win.window = win;
vm.runInNewContext(source, {
  window: win,
  document: dom.document,
  Event: dom.Ev,
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
});
const c = win.__zentralNotesTestSeam.core;
const plain = (v) => JSON.parse(JSON.stringify(v));

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("ok -", name);
  } catch (err) {
    failed++;
    console.error("FAIL " + name + "\n", err);
  }
}

let clock = new Date(2026, 10, 13, 9, 0).getTime();
function fakeIO() {
  const files = new Map();
  return {
    files,
    join: (...p) => p.join("/"),
    filename: (p) => p.split("/").pop(),
    readUTF8: async (p) => {
      if (!files.has(p)) throw new Error("nf " + p);
      return files.get(p).text;
    },
    writeUTF8: async (p, text) => {
      files.set(p, { text, mtime: clock });
    },
    remove: async (p) => {
      files.delete(p);
    },
    exists: async (p) => files.has(p) || [...files.keys()].some((k) => k.startsWith(p + "/")),
    children: async (d) => [...new Set([...files.keys()].filter((k) => k.startsWith(d + "/")).map((k) => d + "/" + k.slice(d.length + 1).split("/")[0]))],
    stat: async (p) => ({ size: (files.get(p)?.text || "").length, lastModified: files.get(p)?.mtime ?? 1 }),
    removeTree: async (d) => {
      for (const k of [...files.keys()]) if (k.startsWith(d + "/")) files.delete(k);
    },
    restrict: async () => {},
    makeDir: async () => {},
  };
}
const mk = (io) => c.createStore({ io, notify() {}, windowId: "t", now: () => clock, getDir: async () => "/n", getMaxSaveMs: () => 5000, setTimer: () => 0, clearTimer() {}, warn(e) { throw e; } });

test("a line loses its date and keeps its words", () => {
  const now = Date.parse("2026-11-13T09:00:00Z");
  assert.equal(cal.unlinkLineText("- [ ] 2026-11-20 09:00-10:00 Lunch %%zn-item-id:abcd1%%", now), "- [ ] Lunch");
  assert.equal(cal.unlinkLineText("- 2026-11-20 14:00 Dentist", now), "- Dentist");
  // A short written date is not what the extractor reads as a schedule (it never became an item), so unlink refuses
  // it rather than editing a line it does not fully understand.
  assert.equal(cal.unlinkLineText("- 20.11 14:00 Dentist", now), null, "a line the extractor never scheduled is refused");
  assert.equal(cal.unlinkLineText("- 09:00 Dentist", now), null, "a bare time is not a date: never silently deleted");
  assert.equal(cal.unlinkLineText("- just words", now), null, "no date, nothing to unlink");
  assert.equal(cal.unlinkLineText("", now), null);
});

test("unlinking a dated list line leaves no item behind", () => {
  const now = Date.parse("2026-11-13T09:00:00Z");
  const body = "# Day\n\n%%calendar%%\n- [ ] 2026-11-20 09:00-10:00 Lunch %%zn-item-id:abcd1%%\n- [ ] 2026-11-21 09:00 Keep me %%zn-item-id:abcd2%%\n";
  assert.equal(cal.extractNoteItems(body, "n", now).length, 2);
  const line = body.split("\n")[3];
  const after = body.replace(line, cal.unlinkLineText(line, now));
  const items = cal.extractNoteItems(after, "n", now);
  assert.equal(items.length, 1, "the unlinked line is no longer a calendar item");
  assert.equal(items[0].summary, "Keep me", "and its neighbour is untouched");
  assert.match(after, /- \[ \] Lunch\n/, "the words are still there, checkbox and all");
});

test("the plan names an action per source, and refuses where nothing can be done", () => {
  const list = { id: "a", x: { src: "list", noteId: "n", key: "k" } };
  assert.equal(cal.unlinkPlan(list).action, "drop-date");
  assert.equal(cal.unlinkPlan(list).keepsText, true);
  const note = { id: "b", x: { src: "note", noteId: "n", key: "k" } };
  assert.equal(cal.unlinkPlan(note).action, "drop-schedule");
  const free = { id: "c", x: { src: "ics" } };
  assert.deepEqual(plain(cal.unlinkPlan(free)), { ok: false, source: "free", action: "none", keepsText: false, reason: "no-note-text" });
  assert.equal(cal.unlinkPlan(null).reason, "no-item");
  // A genuine mirror is the one case where unlinking removes the whole line: the line IS the item. Build it the way
  // the store does (`agendaMirrorLine` + `mirroredItem`), not by hand-assembling an identity that would not match.
  const now2 = Date.parse("2026-11-13T09:00:00Z");
  const manualItem = { id: "m1", summary: "Mirrored", start: { date: "2026-11-20", time: "09:00" }, x: { kind: "reminder", src: "manual" } };
  const line = cal.agendaMirrorLine(manualItem, { now: now2 });
  assert.ok(line && line.lineId, "the mirror line is generated");
  const mirrored = cal.mirroredItem(manualItem, "n1", line.lineId, "Agenda");
  assert.equal(cal.isMirroredAgendaItem(mirrored), true, "it is a real mirror");
  assert.deepEqual(plain(cal.unlinkPlan(mirrored)), { ok: true, source: "list", action: "remove-line", keepsText: false, reason: "" });
});

test("noteLinkedItems answers for one note, one date, and never for a stranger", () => {
  const now = Date.parse("2026-11-13T09:00:00Z");
  const items = cal.extractNoteItems(
    "# Day\n\n%%calendar%%\n- [ ] 2026-11-20 09:00 Lunch %%zn-item-id:aaaa1%%\n- [ ] 2026-11-21 10:00 Call %%zn-item-id:aaaa2%%\n",
    "note-1",
    now,
  );
  assert.equal(items.length, 2);
  const all = cal.noteLinkedItems(items, "note-1");
  assert.equal(all.length, 2, "both are listed");
  assert.equal(all[0].date <= all[1].date, true, "oldest first");
  assert.equal(cal.noteLinkedItems(items, "note-1", { date: "2026-11-20" }).length, 1, "a date narrows it");
  assert.equal(cal.noteLinkedItems(items, "note-1", { date: "2026-11-25" }).length, 0);
  assert.equal(cal.noteLinkedItems(items, "someone-else").length, 0, "another note never sees them");
  // A date is a scope of its own: the date's menu asks about the day, not about one note, so the notes may differ.
  const other = cal.extractNoteItems("# D\n\n%%calendar%%\n- [ ] 2026-11-20 11:00 Other %%zn-item-id:bbbb1%%\n", "note-2", now);
  const both = [...items, ...other];
  assert.deepEqual(plain(cal.noteLinkedItems(both, "", { date: "2026-11-20" }).map((i) => i.title)), ["Lunch", "Other"], "a date crosses notes");
  assert.deepEqual(plain(cal.noteLinkedItems(both, "note-2", { date: "2026-11-20" }).map((i) => i.title)), ["Other"], "note and date together narrow both");
  assert.equal(cal.noteLinkedItems(both, "").length, 0, "but no scope at all lists nothing");
  assert.equal(cal.noteLinkedItems(null, "note-1").length, 0);
});

// The store is the truth for the three sources. Each case logs its own `ok -` line: an assertion that only runs
// inside this async block must never be silent, and the summary waits for `beforeExit`.
process.on("beforeExit", () => {
  console.log(`\nPASS notes-linked-items (${passed} tests)`);
  if (failed) process.exitCode = 1;
});

async function caseAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log("ok -", name);
  } catch (err) {
    failed++;
    console.error("FAIL " + name + "\n", err);
    process.exitCode = 1;
  }
}

(async () => {
  await caseAsync("a dated list line unlinks through the real store", async () => {
    const st = mk(fakeIO());
    await st.open();
    // The marker is what makes a list line a calendar line; without it the note carries no items at all.
    const note = st.create("# Day\n\n%%calendar%%\n- [ ] 2026-11-20 09:00 Lunch %%zn-item-id:aaaa1%%\n");
    await st.flush();
    const linked = st.items.list({ noteId: note.id });
    assert.equal(linked.length, 1, "the dated line became an item");
    assert.deepEqual(plain(st.unlinkCalendarItem(linked[0].id)), { ok: true, noteId: note.id, kind: "reminder" });
    assert.equal(st.get(note.id).body.includes("Lunch"), true, "the word stays");
    assert.equal(st.get(note.id).body.includes("2026-11-20"), false, "the date is gone");
    assert.equal(st.items.list({ noteId: note.id }).length, 0, "and the item with it");
  });

  await caseAsync("an item with no note text is refused and left alone", async () => {
    const st = mk(fakeIO());
    await st.open();
    const made = st.items.upsert({ id: "manual-1", summary: "Made here", start: { date: "2026-11-20" }, x: { kind: "event", src: "manual" } });
    assert.ok(made);
    assert.deepEqual(plain(st.unlinkCalendarItem("manual-1")), { ok: false, reason: "no-note-text" });
    assert.ok(st.items.get("manual-1"), "and it is untouched");
    assert.deepEqual(plain(st.unlinkCalendarItem("nope")), { ok: false, reason: "missing" });
  });

  await caseAsync("an item whose note is gone is refused, not reported as unknown", async () => {
    const st = mk(fakeIO());
    await st.open();
    // `items.get` cannot see this one (its note is not visible); the unlink still has to name the real reason.
    st.items.upsert({ id: "orphan-1", summary: "Orphan", start: { date: "2026-11-20" }, x: { kind: "event", src: "list", noteId: "gone", key: "k1" } });
    assert.deepEqual(plain(st.unlinkCalendarItem("orphan-1")), { ok: false, reason: "missing-note" });
  });

  await caseAsync("a mirror unlinks its Agenda line and the item", async () => {
    const st = mk(fakeIO());
    await st.open();
    const day = st.create("# 2026-11-20\n\n## Agenda\n", "Daily");
    await st.flush();
    const manual = st.items.upsert({ id: "manual-9", summary: "Standalone", start: { date: "2026-11-20", time: "09:00" }, x: { kind: "reminder", src: "manual" } });
    assert.ok(manual);
    assert.ok(st.mirrorItemToAgendaNote("manual-9"), "the item gains an Agenda line");
    const mirrored = st.items.list({ noteId: day.id }).find((it) => cal.isMirroredAgendaItem(it));
    assert.ok(mirrored, "and reads back as a mirror");
    assert.equal(st.get(day.id).body.includes("Standalone"), true, "the line is in the note");
    assert.equal(st.unlinkCalendarItem(mirrored.id).ok, true);
    assert.equal(st.get(day.id).body.includes("Standalone"), false, "the line went with it");
    assert.equal(cal.isMirroredAgendaItem(st.items.list({ includeHidden: true }).find((it) => it.id === mirrored.id) || {}), false, "no mirror is left behind");
  });
})();
