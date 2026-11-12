"use strict";
/* Date display formats, local date keys, agenda buckets, blank date-note rule, LWW (roadmap T2.14-T2.17). */
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const cal = require("../additional/notes/calendar/ZentralNotesCalendar.js");
let passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok -", name); }

test("formatDateKey renders every format and never changes the key", () => {
  assert.equal(cal.formatDateKey("2026-11-14", "DD-MM-YYYY"), "14-11-2026");
  assert.equal(cal.formatDateKey("2026-11-14", "YYYY-MM-DD"), "2026-11-14");
  assert.equal(cal.formatDateKey("2026-11-14", "MM/DD/YYYY"), "11/14/2026");
  assert.equal(cal.formatDateKey("2026-11-14", "DD.MM.YYYY"), "14.11.2026");
  assert.equal(cal.formatDateKey("2026-11-14", "DD/MM/YYYY"), "14/11/2026");
  assert.match(cal.formatDateKey("2026-11-14", "long", "en-US"), /November 14, 2026/);
  assert.equal(cal.formatDateKey("2026-11-14", "nonsense"), "14-11-2026");
  assert.equal(cal.formatDateKey("2026-11-14"), "14-11-2026");
});
test("formatDateKey rejects invalid keys and calendar dates", () => {
  for (const bad of ["", null, undefined, "14-11-2026", "2026-13-01", "2026-02-30", "2026-1-1", "abc"]) assert.equal(cal.formatDateKey(bad, "YYYY-MM-DD"), "");
  assert.equal(cal.formatDateKey("2028-02-29", "DD-MM-YYYY"), "29-02-2028");
  assert.equal(cal.formatDateKey("2027-02-29", "DD-MM-YYYY"), "");
});
test("dateNoteTitle separates display title from the key", () => {
  assert.equal(cal.dateNoteTitle("2026-11-14", "DD-MM-YYYY"), "Reminders for 14-11-2026");
  assert.equal(cal.dateNoteTitle("2026-11-14", "MM/DD/YYYY", "Day "), "Day 11/14/2026");
  assert.equal(cal.dateNoteTitle("bad", "DD-MM-YYYY"), "");
});
test("cleanDateFormat falls back to the default", () => {
  assert.equal(cal.cleanDateFormat("YYYY-MM-DD"), "YYYY-MM-DD");
  assert.equal(cal.cleanDateFormat("x"), "DD-MM-YYYY");
  assert.equal(cal.cleanDateFormat(undefined), cal.DEFAULT_DATE_FORMAT);
});
test("localDateKey uses local fields, not UTC, near midnight", () => {
  assert.equal(cal.localDateKey(new Date(2026, 10, 14, 0, 5).getTime()), "2026-11-14");
  assert.equal(cal.localDateKey(new Date(2026, 10, 14, 23, 55).getTime()), "2026-11-14");
  assert.equal(cal.localDateKey(NaN), "");
  assert.equal(cal.localDateKey(undefined), "");
});
test("snoozeDays keeps wall-clock time across month ends and DST", () => {
  const t = new Date(2026, 9, 31, 9, 30).getTime();
  const r = new Date(cal.snoozeDays(t, 1));
  assert.deepEqual([r.getMonth(), r.getDate(), r.getHours(), r.getMinutes()], [10, 1, 9, 30]);
  const w = new Date(cal.snoozeDays(new Date(2026, 2, 28, 8, 0).getTime(), 3));
  assert.deepEqual([w.getDate(), w.getHours()], [31, 8]);
  assert.equal(cal.snoozeDays(t, 0), t);
  assert.equal(cal.snoozeDays(t, "x"), t);
});
const now = new Date(2026, 10, 12, 10, 0).getTime();
const mk = (summary, y, m, d, h, extra = {}) => cal.makeItem({ summary, start: { dateTime: new Date(y, m, d, h).toISOString() }, x: { kind: "reminder", src: "manual", ...extra } }, now);
test("agendaBuckets counts T..T+3 and skips done and cancelled items", () => {
  const items = [mk("a", 2026, 10, 12, 15), mk("b", 2026, 10, 12, 16), mk("c", 2026, 10, 13, 9), mk("d", 2026, 10, 15, 9), mk("e", 2026, 10, 16, 9)];
  const cancelled = mk("x", 2026, 10, 12, 18); cancelled.status = "cancelled"; items.push(cancelled);
  const b = cal.agendaBuckets(items, now, 4, (it) => it.summary === "b");
  assert.deepEqual(b.map((x) => x.label), ["Today", "Tomorrow", "Day 2", "Day 3"]);
  assert.deepEqual(b.map((x) => x.key), ["2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
  assert.deepEqual(b.map((x) => x.count), [1, 1, 0, 1]);
  assert.equal(b[0].items[0].summary, "a");
});
test("agendaBuckets clamps the day count and handles an empty list", () => {
  assert.equal(cal.agendaBuckets([], now, 0).length, 4);
  assert.equal(cal.agendaBuckets([], now, 2).length, 2);
  assert.equal(cal.agendaBuckets([], now, 999).length, 31);
  assert.equal(cal.agendaBuckets([], now, 6)[5].label, "Day 5");
});
test("agendaBuckets expands recurring items into each day", () => {
  const it = cal.makeItem({ summary: "daily", start: { dateTime: new Date(2026, 10, 1, 8).toISOString() }, recurrence: ["RRULE:FREQ=DAILY"], x: { kind: "reminder", src: "manual" } }, now);
  assert.deepEqual(cal.agendaBuckets([it], now).map((x) => x.count), [1, 1, 1, 1]);
});
test("isBlankDateNote purges only untouched generated notes", () => {
  assert.equal(cal.isBlankDateNote({ body: "# 2026-11-14 Saturday\n\n" }, "2026-11-14"), true);
  assert.equal(cal.isBlankDateNote({ body: "" }, "2026-11-14"), true);
  assert.equal(cal.isBlankDateNote({ body: "# 2026-11-14 Saturday\r\n" }, "2026-11-14"), true);
  assert.equal(cal.isBlankDateNote({ body: "# 2026-11-14 Saturday\n\ntext" }, "2026-11-14"), false);
  assert.equal(cal.isBlankDateNote({ body: "# 2026-11-14 Saturday" }, "2026-11-15"), false);
  assert.equal(cal.isBlankDateNote({ body: "# 2026-11-14 Saturday", tags: ["x"] }, "2026-11-14"), false);
  assert.equal(cal.isBlankDateNote({ body: "# 2026-11-14 Saturday", files: ["a.png"] }, "2026-11-14"), false);
  assert.equal(cal.isBlankDateNote({ body: "# 2026-11-14 Saturday", touched: true }, "2026-11-14"), false);
  assert.equal(cal.isBlankDateNote(null, "2026-11-14"), false);
  assert.equal(cal.isBlankDateNote({ body: "# 2026-11-14 Saturday" }), true);
  assert.equal(cal.isBlankDateNote({ body: "# Shopping" }), false);
});
test("lwwPick prefers newer updated, then higher rev, then remote", () => {
  const a = { id: 1, updated: 10, rev: 1 }, b = { id: 2, updated: 20, rev: 0 };
  assert.equal(cal.lwwPick(a, b), b);
  assert.equal(cal.lwwPick(b, a), b);
  assert.equal(cal.lwwPick({ updated: 5, rev: 2 }, { updated: 5, rev: 1 }).rev, 2);
  const l = { updated: 5, rev: 1 }, r = { updated: 5, rev: 1 };
  assert.equal(cal.lwwPick(l, r), r);
  assert.equal(cal.lwwPick(null, r), r);
  assert.equal(cal.lwwPick(l, null), l);
  assert.equal(cal.lwwPick(null, null), null);
});

test("lwwPick parses ISO timestamps and treats invalid revisions as zero", () => {
  const older = { updated: "2026-11-12T10:00:00.000Z", rev: 100 };
  const newer = { updated: "2026-11-12T10:00:01.000Z", rev: 0 };
  assert.equal(cal.lwwPick(older, newer), newer, "timestamp wins before revision");
  const sameTimeLowRev = { updated: "2026-11-12T10:00:01.000Z", rev: 2 };
  const sameTimeHighRev = { updated: "2026-11-12T10:00:01.000Z", rev: 3 };
  assert.equal(cal.lwwPick(sameTimeLowRev, sameTimeHighRev), sameTimeHighRev);
  assert.equal(cal.lwwPick(sameTimeHighRev, sameTimeLowRev), sameTimeHighRev);
  assert.equal(cal.lwwPick({ updated: "invalid", rev: -4 }, { updated: "also invalid", rev: 0 }).rev, 0, "invalid stamps and negative revisions normalize safely");
  assert.equal(cal.lwwPick({ updated: 100, rev: 99 }, { updated: "1970-01-01T00:01:40.000Z", rev: 0 }).rev, 0, "numeric and ISO timestamps compare consistently and exact ties prefer remote");
});


test("snoozedItemStart preserves timed reminder clock time across a DST boundary", () => {
  const script = `const cal = require(${JSON.stringify(path.resolve(__dirname, "../additional/notes/calendar/ZentralNotesCalendar.js"))});\n` +
    `const result = cal.snoozedItemStart({ start: { dateTime: "2026-03-07T14:30:00.000Z" } }, 1);\n` +
    `process.stdout.write(JSON.stringify(result));`;
  const result = JSON.parse(execFileSync(process.execPath, ["-e", script], {
    encoding: "utf8",
    env: { ...process.env, TZ: "America/New_York" },
  }));
  assert.deepEqual(result, { dateTime: "2026-03-08T13:30:00.000Z" }, "09:30 local remains 09:30 when the DST offset changes");
});
test("snoozedItemStart keeps all-day reminders date-only and rejects invalid values", () => {
  const start = cal.snoozedItemStart({ start: { date: "2026-11-12" } }, 3);
  assert.deepEqual(start, { date: cal.ymd(new Date(cal.addDays(cal.parseYmd("2026-11-12").getTime(), 3))) });
  assert.equal("dateTime" in start, false, "all-day reminders do not become timed events");
  assert.equal(cal.snoozedItemStart({ start: { dateTime: "not-a-date" } }, 1), null);
  assert.equal(cal.snoozedItemStart(null, 1), null);
});
test("zonedDateTimeToMs resolves DST overlaps and gaps deterministically", () => {
  assert.equal(cal.zonedDateTimeToMs("2026-11-01", "01:30", "America/New_York"), Date.parse("2026-11-01T05:30:00.000Z"), "fall-back overlap selects the earlier instant");
  assert.equal(cal.zonedDateTimeToMs("2026-03-08", "02:30", "America/New_York"), Date.parse("2026-03-08T07:00:00.000Z"), "spring-forward gap advances to the first valid wall minute");
});
test("zonedDateTimeToMs rejects malformed dates, times and zones", () => {
  for (const args of [
    ["2026-02-30", "09:00", "America/New_York"],
    ["2026-11-01", "24:00", "America/New_York"],
    ["2026-11-01", "09:60", "America/New_York"],
    ["2026-11-01", "09:00", "Not/A_Zone"],
    ["bad", "09:00", ""],
  ]) assert.equal(cal.zonedDateTimeToMs(...args), null);
});
test("T2.19 exposes quick snooze choices only for supported reminder occurrences", () => {
  const source = require("node:fs").readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
  const calendarSource = require("node:fs").readFileSync(path.resolve(__dirname, "../additional/notes/calendar/ZentralNotesCalendar.js"), "utf8");
  assert.match(calendarSource, /action\("snooze-1d",\s*"Snooze \+1 day",\s*writable && !recurring/);
  assert.match(calendarSource, /action\("snooze-3d",\s*"Snooze \+3 days",\s*writable && !recurring/);
  assert.match(calendarSource, /action\("snooze-monday",\s*"Snooze until next Monday",\s*writable && !recurring/);
  assert.match(calendarSource, /action\("snooze-custom",\s*"Custom date and time…",\s*writable && !recurring/);
  assert.match(source, /"snooze-1d":\s*\(\)\s*=>\s*snoozeReminderItem\(item,\s*1\)/);
  assert.match(source, /"snooze-3d":\s*\(\)\s*=>\s*snoozeReminderItem\(item,\s*3\)/);
  assert.match(source, /"snooze-monday":\s*\(\)\s*=>\s*snoozeReminderItem\(item,\s*nextMonday\)/);
  assert.match(source, /"snooze-custom":\s*\(\)\s*=>\s*queueMicrotask\(\(\)\s*=>\s*askCustomReminderSnooze\(item\)\)/);
  assert.match(source, /zonedDateTimeToMs\(day,\s*selectedTime,\s*item\.x\?\.tz\s*\|\|\s*["']["']\)/);
  assert.match(source, /button\.addEventListener\(["']contextmenu["'],\s*\(event\)\s*=>\s*showCalendarItemMenu\(event,\s*item,\s*button\)\)/);
});

test("parseDateKeyText resolves every displayed format to the immutable ISO key", () => {
  const fixtures = [
    ["2026-11-14 Saturday", "DD-MM-YYYY", "2026-11-14"],
    ["14-11-2026 Saturday", "DD-MM-YYYY", "2026-11-14"],
    ["2026/11/14", "DD-MM-YYYY", "2026-11-14"],
    ["11/14/2026", "MM/DD/YYYY", "2026-11-14"],
    ["14.11.2026", "DD.MM.YYYY", "2026-11-14"],
    ["14/11/2026", "DD/MM/YYYY", "2026-11-14"],
  ];
  for (const [text, fmt, expected] of fixtures) assert.equal(cal.parseDateKeyText(text, fmt), expected, text);
  assert.equal(cal.parseDateKeyText("04/05/2026", "DD/MM/YYYY"), "2026-05-04", "current setting disambiguates slash dates");
  assert.equal(cal.parseDateKeyText("04/05/2026", "MM/DD/YYYY"), "2026-04-05", "current setting disambiguates slash dates");
  assert.equal(cal.parseDateKeyText("30/02/2026", "DD/MM/YYYY"), "", "invalid dates are rejected");
  assert.equal(cal.parseDateKeyText("a date 2026-11-14"), "", "date is required at the start of the title");
});
test("parseDateKeyText recognizes localized long labels without changing their key", () => {
  const label = cal.formatDateKey("2026-11-14", "long", "en-US");
  assert.equal(cal.parseDateKeyText(label, "long", "en-US"), "2026-11-14");
  assert.equal(cal.parseDateKeyText("November 14, 2026", "long", "en-US"), "2026-11-14");
  assert.equal(cal.parseDateKeyText("not a date", "long", "en-US"), "");
});

console.log(passed + " passed");
