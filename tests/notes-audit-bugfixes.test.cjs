"use strict";
/* Owner audit regression set for bugs BUG-01 through BUG-11 from v3.3.46. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const cal = require(path.join(__dirname, "..", "additional/notes/calendar/ZentralNotesCalendar.js"));
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const seam = {};
const win = { __zentralNotesTestSeam: seam, ZentralRuntime: { register() {} } };
win.window = win;
vm.runInNewContext(source, { window: win, globalThis: { Services: {} }, ChromeUtils: {}, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, console });
const c = seam.core;
const paste = require(path.resolve(__dirname, "../additional/notes/paste/ZentralNotesPasteHtml.js"));
const plain = (x) => JSON.parse(JSON.stringify(x));
let passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok -", name); }
const ms = (s) => new Date(s).getTime();
const day = (s) => new Date(s + "T00:00:00").getTime();
const item = (id, start, end, x = {}, recurrence = ["RRULE:FREQ=DAILY;COUNT=6"]) => cal.makeItem({
  id, summary: "Recurring", start: { dateTime: new Date(start).toISOString() },
  ...(end ? { end: { dateTime: new Date(end).toISOString() } } : {}), recurrence, x: { kind: "event", ...x },
}, ms("2026-01-01T00:00:00Z"));

// BUG-01: converting a moved one-off occurrence into a following/series rule must not leave a competing this exception.
test("BUG-01 following move consumes selected this-override and preserves its visible shift", () => {
  const master = item("move-1", "2026-11-02T10:00:00Z", "2026-11-02T11:00:00Z");
  const selected = cal.expandItem(master, ms("2026-11-03T00:00:00Z"), ms("2026-11-04T00:00:00Z"))[0];
  const movedThis = cal.moveOccurrence(master, selected, { dateTime: "2026-11-03T12:00:00Z" }, "this", ms("2026-11-01T00:00:00Z"));
  const movedOccurrence = cal.expandItem(movedThis, ms("2026-11-03T00:00:00Z"), ms("2026-11-04T00:00:00Z"))[0];
  const following = cal.moveOccurrence(movedThis, movedOccurrence, { dateTime: "2026-11-03T13:00:00Z" }, "following", ms("2026-11-01T00:00:01Z"));
  const exceptions = following.x.recurrenceExceptions;
  assert.equal(exceptions.filter((e) => e.scope === "this" && ms(e.recurrenceId.dateTime) === ms("2026-11-03T10:00:00Z")).length, 0);
  const shift = exceptions.find((e) => e.scope === "following");
  assert.equal(shift.shiftMs, 3 * 60 * 60 * 1000);
  const starts = ["2026-11-03", "2026-11-04"].map((d) => cal.expandItem(following, ms(d + "T00:00:00Z"), ms(d + "T23:59:59Z"))[0]?.start.dateTime);
  assert.deepEqual(starts, ["2026-11-03T13:00:00.000Z", "2026-11-04T13:00:00.000Z"]);
});

test("BUG-01 series move composes with the selected occurrence's effective position", () => {
  const master = item("move-series", "2026-11-02T10:00:00Z", "2026-11-02T11:00:00Z");
  const selected = cal.expandItem(master, ms("2026-11-04T00:00:00Z"), ms("2026-11-05T00:00:00Z"))[0];
  const thisMoved = cal.moveOccurrence(master, selected, { dateTime: "2026-11-04T12:00:00Z" }, "this", ms("2026-11-01T00:00:00Z"));
  const occurrence = cal.expandItem(thisMoved, ms("2026-11-04T00:00:00Z"), ms("2026-11-05T00:00:00Z"))[0];
  const series = cal.moveOccurrence(thisMoved, occurrence, { dateTime: "2026-11-04T13:00:00Z" }, "series", ms("2026-11-01T00:00:01Z"));
  assert.equal(series.x.recurrenceExceptions.some((e) => e.scope === "this" && ms(e.recurrenceId.dateTime) === ms("2026-11-04T10:00:00Z") && !e.cancelled), false);
  assert.equal(series.x.recurrenceExceptions.find((e) => e.scope === "series").shiftMs, 3 * 60 * 60 * 1000);
});

// BUG-02
test("BUG-02 a moved then cancelled occurrence can be restored using its prior visible object", () => {
  const master = item("cancel-1", "2026-11-02T10:00:00Z", "2026-11-02T11:00:00Z");
  const base = cal.expandItem(master, ms("2026-11-03T00:00:00Z"), ms("2026-11-04T00:00:00Z"))[0];
  const moved = cal.moveOccurrence(master, base, { dateTime: "2026-11-03T14:00:00Z" }, "this", ms("2026-11-01T00:00:00Z"));
  const movedOccurrence = cal.expandItem(moved, ms("2026-11-03T00:00:00Z"), ms("2026-11-04T00:00:00Z"))[0];
  const cancelled = cal.cancelOccurrence(moved, movedOccurrence, ms("2026-11-01T00:00:01Z"));
  const restored = cal.clearOccurrenceException(cancelled, movedOccurrence, ms("2026-11-01T00:00:02Z"));
  assert.ok(restored, "clear returns an updated master");
  assert.equal(restored.x.recurrenceExceptions.length, 0);
});

// BUG-03
test("BUG-03 IANA-zoned monthly recurrence uses the zone's civil DTSTART day and wall clock", () => {
  const master = item("zone-month", "2026-03-31T16:00:00Z", "2026-03-31T17:00:00Z", { tz: "Asia/Tokyo" }, ["RRULE:FREQ=MONTHLY;COUNT=3"]);
  const hits = cal.expandItem(master, ms("2026-03-31T00:00:00Z"), ms("2026-07-02T00:00:00Z"));
  assert.deepEqual(hits.map((x) => cal.zonedDateKey(ms(x.start.dateTime), "Asia/Tokyo")), ["2026-04-01", "2026-05-01", "2026-06-01"]);
  assert.deepEqual(hits.map((x) => cal.clockIn(ms(x.start.dateTime), "Asia/Tokyo")), ["01:00", "01:00", "01:00"]);
});

test("BUG-03 IANA recurrence keeps wall time across a zone DST boundary", () => {
  const master = item("zone-dst", "2026-03-07T15:00:00Z", "2026-03-07T16:00:00Z", { tz: "America/New_York" }, ["RRULE:FREQ=DAILY;COUNT=4"]);
  const hits = cal.expandItem(master, ms("2026-03-07T00:00:00Z"), ms("2026-03-12T00:00:00Z"));
  assert.deepEqual(hits.map((x) => cal.clockIn(ms(x.start.dateTime), "America/New_York")), ["10:00", "10:00", "10:00", "10:00"]);
});

// BUG-04 fence tracking and BUG-05 front matter heading/ToC handling.
test("BUG-04 reference definitions inside mixed, indented and longer Markdown fences are preserved", () => {
  const lines = [
    "   ````md", "[one]: https://one.test", "   ```", "[two]: https://two.test", "   ````",
    "~~~markdown", "[three]: https://three.test", "```", "[four]: https://four.test", "~~~",
    "[five]: https://five.test",
  ];
  const refs = c.collectRefs(lines);
  assert.deepEqual([...refs.keys()], ["five"]);
  assert.equal(lines[1], "[one]: https://one.test");
  assert.equal(lines[3], "[two]: https://two.test");
  assert.equal(lines[6], "[three]: https://three.test");
  assert.equal(lines[8], "[four]: https://four.test");
  assert.equal(lines[10], "");
});

test("BUG-04 headings and ToC operations ignore inner shorter fences", () => {
  const body = ["# Visible", "````md", "```", "# Code heading", "[TOC]", "```", "````", "## Also visible"].join("\n");
  assert.deepEqual(plain(c.headingsOf(body).map((x) => x.text)), ["Visible", "Also visible"]);
  assert.equal(c.findToc(body), null);
  const updated = c.updateToc(body);
  assert.equal(updated.changed, false, "[TOC] inside a code block is not expanded");
});

test("BUG-05 foreign front matter is excluded from heading index and title ToC skip", () => {
  const body = ["---", "# YAML comment (not a heading)", "custom: value", "other: flag", "---", "# Actual title", "## Section"].join("\n");
  assert.deepEqual(plain(c.headingsOf(body).map((x) => [x.text, x.line])), [["Actual title", 5], ["Section", 6]]);
  assert.equal(c.tocList(body), "1. [Section](#section)");
});

// BUG-06
test("BUG-06 trailing block ID on a quote list belongs to the quote only", () => {
  const innerItem = { c: [{ t: "text", s: "item" }], blockId: "q-id" };
  const quote = { type: "quote", blocks: [{ type: "list", items: [innerItem] }] };
  assert.equal(c.attachTrailingBlockId(quote, "q-id"), true);
  assert.equal(innerItem.blockId, undefined);
  assert.equal(quote.blockId, "q-id");
});

test("BUG-06 rejected nested block ID does not become a false quote ID", () => {
  const quote = { type: "quote", blocks: [{ type: "code", text: "code" }] };
  assert.equal(c.attachTrailingBlockId(quote, "nope"), false);
  assert.equal(quote.blockId, undefined);
});

// BUG-07
test("BUG-07 all Obsidian task states are recognized by clean/toggle/continue operations", () => {
  const states = [" ", "x", "X", "-", "/", "?", "!", ">", "<", "*", "i", "b", '"', "l", "p", "c", "f", "I", "S", "n"];
  for (const state of states) {
    const line = `- [${state}] task`;
    const heading = c.toggleLinePrefix(line, 0, line.length, "heading");
    assert.equal(heading.text, "## task", `heading strips [${state}]`);
    const continuation = c.continueList(line, line.length);
    assert.ok(continuation?.text.endsWith("- [ ] "), `continuation from [${state}] creates a clean task`);
    const toggled = c.toggleCheckboxLine(line, 0);
    assert.equal(toggled, `- [${state === "x" || state === "X" ? " " : "x"}] task`);
  }
  assert.equal(c.toggleCheckboxLine("- [f] Fix [?]", 0), "- [x] Fix [?]", "only the task prefix is toggled");
  assert.equal(c.toggleCheckboxLine("Narrative [f] token", 0), "Narrative [f] token", "a mid-sentence token is not a task checkbox");
});

// BUG-08
test("BUG-08 inequalities and hidden comments do not erase/index inline tags", () => {
  assert.deepEqual(plain(c.inlineTags("if a < 5 #urgent and b > 2")), ["urgent"]);
  assert.deepEqual(plain(c.inlineTags("Visible #ok %% #draft %% <!-- #html-hidden -->")), ["ok"]);
  assert.deepEqual(plain(c.inlineTags("Start <!-- #hidden\nmore #hidden-too --> still #visible")), ["visible"]);
});

// BUG-11 / T1.14: the inline/YAML tag index is unified and the list-view chip is wired to it.
test("BUG-11 T1.14 merges front-matter and inline tags once per note and filters trash", () => {
  const one = { id: "one", body: ["---", "tags: [Alpha, Beta]", "other: flag", "---", "# Title", "Visible #alpha #nested/Deep"].join("\n") };
  const two = { id: "two", body: "# Another\n\n#beta #Alpha" };
  const trashed = { id: "trash", trashed: true, body: "#alpha #ghost" };
  assert.deepEqual(plain(c.noteTags(one)).sort(), ["Alpha", "Beta", "nested/Deep"].sort());
  assert.deepEqual(plain(c.tagSummary([one, two, trashed]).map((x) => [x.tag.toLowerCase(), x.count])), [["alpha", 2], ["beta", 2], ["nested/deep", 1]]);
});

// BUG-09
test("BUG-09 transclusion is not mistaken for a reciprocal wiki backlink", () => {
  const result = c.addBacklink("## Intro\n\n![[Source note]]", "intro", "Source note", "Source note");
  assert.equal(result.added, true);
  assert.match(result.body, /\[Source note\]\(Source%20note\.md\)/);
});

// BUG-10
test("BUG-10 code blocks at the start of list items are indented as child blocks", () => {
  const html = '<ul><li><pre><code class="language-js">const x = 1;</code></pre></li><li>after</li></ul>';
  const md = paste.htmlToMarkdown(html).markdown;
  assert.match(md, /^- \n  ```js\n  const x = 1;\n  ```\n- after$/);
  const parsed = plain(c.parseBlocks(md, false, {}));
  assert.equal(parsed[0].type, "list");
  assert.equal(parsed[0].items[0].more?.[0]?.[0]?.type || parsed[0].items[0].more?.[0]?.type, "code");
});

test("BUG-10 large code spans and fences avoid spread-argument limits", () => {
  const ticks = "`".repeat(70000);
  const span = paste.htmlToMarkdown("<p><code>" + ticks + "</code></p>");
  assert.ok(span && span.markdown.length > ticks.length);
  const fence = paste.htmlToMarkdown("<pre><code>" + ticks + "</code></pre>");
  assert.ok(fence && fence.markdown.length > ticks.length);
});

test("BUG-10 wide/tall table aggregation is bounded without spread calls", () => {
  const html = "<table><tr>" + Array.from({ length: 80 }, (_, i) => `<td>${i}</td>`).join("") + "</tr></table>";
  const result = paste.htmlToMarkdown(html);
  assert.ok(result && result.markdown.includes("| 0 |"));
  assert.equal(result.lossy, true);
});

console.log(`${passed} owner-audit regression tests passed`);
