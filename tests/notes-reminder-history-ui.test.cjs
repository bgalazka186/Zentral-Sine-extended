"use strict";
/* ST7.5: reading, filtering, exporting and trimming the reminder history.
 *
 * The list, the count and the export must always agree, so one filter decides all three. Trimming is a preview first:
 * the confirmation names real numbers, and the archive file (never the bin) is where the old records go.
 */
const assert = require("node:assert/strict");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

const NOW = Date.parse("2026-11-17T12:00:00.000Z");
const ago = (days) => NOW - days * 86400000;
const rec = (id, action, days, extra = {}) => ({
  id, itemId: extra.itemId || "item-" + id, occurrenceId: extra.occurrenceId || "item-" + id,
  action, at: ago(days), seq: extra.seq || 1,
  summary: extra.summary || "", stage: extra.stage || "", start: extra.start || { dateTime: new Date(ago(days)).toISOString() },
});

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("ok - " + name); }

(async () => {
  await test("the filter cleans itself and never invents an action", () => {
    assert.deepEqual(C.cleanHistoryFilter(), { actions: [], days: 0, text: "" });
    assert.deepEqual(C.cleanHistoryFilter({ actions: ["done", "nonsense", "done"] }).actions, ["done"]);
    assert.deepEqual(C.cleanHistoryFilter({ action: "snoozed" }).actions, ["snoozed"], "one action is accepted too");
    assert.equal(C.cleanHistoryFilter({ days: -5 }).days, 0, "a negative window means everything");
    assert.equal(C.cleanHistoryFilter({ days: 99999 }).days, 3650, "the window is bounded");
    assert.equal(C.cleanHistoryFilter({ text: "   " }).text, "");
  });

  await test("actions, the look-back window and the search narrow the same list", () => {
    const list = [
      rec("1", "done", 1, { summary: "Pay rent" }),
      rec("2", "dismissed", 2, { summary: "Water plants" }),
      rec("3", "alerted", 40, { summary: "Pay rent again" }),
      rec("4", "snoozed", 400, { summary: "Old business" }),
    ];
    assert.equal(C.filterHistoryRecords(list, {}, NOW).length, 4);
    assert.deepEqual(C.filterHistoryRecords(list, { actions: ["done", "dismissed"] }, NOW).map((r) => r.id), ["1", "2"]);
    assert.deepEqual(C.filterHistoryRecords(list, { days: 30 }, NOW).map((r) => r.id), ["1", "2"]);
    assert.deepEqual(C.filterHistoryRecords(list, { text: "pay rent" }, NOW).map((r) => r.id), ["1", "3"], "the search is case-insensitive");
    assert.deepEqual(C.filterHistoryRecords(list, { actions: ["alerted"], text: "pay", days: 30 }, NOW), [], "filters combine");
    assert.deepEqual(C.filterHistoryRecords(list, { text: "nothing here" }, NOW), []);
    assert.deepEqual(C.filterHistoryRecords(null, {}, NOW), [], "junk in, empty out");
  });

  await test("the trim preview counts what the real trim would move", () => {
    const list = [
      rec("keep-transition", "done", 400), // the latest transition of its occurrence is always kept
      rec("old-alert", "alerted", 90),
      rec("fresh", "done", 1),
      rec("old-other", "snoozed", 60),
    ];
    const survey = C.historyPruneSurvey(list, NOW, { retentionDays: 30 });
    assert.equal(survey.total, 4);
    assert.equal(survey.archived, 2, "the old alert and the old snooze move; the transition stays");
    assert.equal(survey.kept, 2);
    assert.deepEqual(survey.byAction, { alerted: 1, snoozed: 1 });
    assert.equal(survey.retentionDays, 30);
    assert.equal(survey.cutoff, NOW - 30 * 86400000);

    // The same rule the store applies on every write, so the preview cannot drift from the real thing.
    const compacted = C.compactReminderHistory(list, NOW, { retentionDays: 30 });
    assert.equal(compacted.archived.length, survey.archived);

    assert.equal(C.historyPruneSurvey([], NOW, { retentionDays: 30 }).archived, 0);
  });

  await test("the export is one line per record, newest first, and readable without the app", () => {
    const list = [rec("a", "done", 2, { summary: "Pay rent" }), rec("b", "alerted", 1, { summary: "Standup", stage: "due" })];
    const text = C.exportHistoryLines(list);
    const lines = text.trimEnd().split("\n");
    assert.equal(lines.length, 2);
    assert.ok(lines[0].startsWith(new Date(ago(1)).toISOString()), "newest first");
    assert.match(lines[0], /\talerted\t/);
    assert.match(lines[0], /stage=due/);
    assert.match(lines[0], /item=item-b/);
    assert.match(lines[0], /Standup/);
    assert.match(lines[1], /done/);
    assert.match(lines[1], /Pay rent/);
    assert.match(lines[1], /start=/, "the scheduled instant is kept");
    assert.equal(C.exportHistoryLines([]), "", "nothing to export is an empty file, not junk");
    // A summary with a newline cannot break the line-per-record format.
    assert.equal(C.exportHistoryLines([rec("c", "done", 1, { summary: "two\nlines" })]).trimEnd().split("\n").length, 1);
  });

  await test("the summary line explains an empty list instead of leaving it blank", () => {
    const line = C.historySummaryLine({ total: 2, all: 9 }, { days: 7, actions: ["done"], text: "rent" });
    assert.match(line, /2 of 9 records/);
    assert.match(line, /last 7 days/);
    assert.match(line, /done/);
    assert.match(line, /"rent"/);
    assert.match(C.historySummaryLine({ total: 0, all: 0 }, {}), /0 of 0 records/);
  });

  console.log(`\n${passed} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
