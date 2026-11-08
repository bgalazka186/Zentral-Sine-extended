"use strict";
/* Cycle F (cheap and fast) regression tests for Zentral Notes.
 * Pure helpers added in Cycle F of TODO_notes_roadmap.md (counter, ...). Fake DOM only: nothing here proves live Zen behaviour.
 * UI assertions use the shared fake DOM; actual Zen/Gecko layout and filesystem permissions still need live testing. */
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const dom = require("./helpers/fake-dom.cjs")();
const { El, Ev, document, raf } = dom;
const win = {
  document,
  ZentralRuntime: { register() {} },
  __zentralNotesTestSeam: {},
  requestAnimationFrame: (fn) => raf.push(fn),
  cancelAnimationFrame() {},
  setTimeout,
  clearTimeout,
  innerWidth: 1200,
  innerHeight: 800,
  addEventListener() {},
  removeEventListener() {},
};
win.window = win;
vm.runInNewContext(source, {
  window: win,
  document,
  Event: Ev,
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
  navigator: { platform: "Linux" },
});

const c = win.__zentralNotesTestSeam.core;
const CSS = require("fs").readFileSync(require("path").join(__dirname, "..", "additional", "notes", "ZentralNotes.css"), "utf8");
let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("ok -", name);
}
(async () => {
  await test("counterText: plain mode keeps the old 'N words' text", () => {
    assert.equal(c.counterText("one two three"), "3 words");
    assert.equal(c.counterText("solo"), "1 word");
    assert.equal(c.counterText(""), "0 words");
    // plain mode ignores a selection (old behaviour)
    assert.equal(c.counterText("one two three", "one", false), "3 words");
  });
  await test("counterText: extended mode adds characters and reading time, selection is counted and labelled", () => {
    assert.equal(c.counterText("one two three", "", true), "3 words \u00b7 13 chars \u00b7 ~1 min read");
    assert.equal(c.counterText("", "", true), "0 words \u00b7 0 chars");
    const long = Array.from({ length: 401 }, () => "w").join(" ");
    assert.match(c.counterText(long, "", true), /401 words .* ~3 min read$/);
    assert.equal(c.counterText("one two three", "two", true), "Selected: 1 word \u00b7 3 chars \u00b7 ~1 min read");
    // astral characters count once
    assert.match(c.counterText("a\u{1F600}", "", true), /2 chars/);
  });
  await test("print stylesheet (#32): always in the HTML export, light colours, no split blocks, URLs shown except for bare links", () => {
    const html = c.exportHtml("# T\n\n[site](https://example.com) and <https://bare.example.org>\n\n```\ncode\n```\n");
    const css = html.slice(html.indexOf("@media print"));
    assert.match(css, /color-scheme:light/);
    assert.match(css, /pre,blockquote,table,tr,img,details\{break-inside:avoid\}/);
    assert.match(css, /a\[href\^="http"\]:not\(\[data-bare\]\)::after\{content:" \(" attr\(href\) "\)"/);
    assert.match(html, /<a href="https:\/\/example.com\/" rel=/, "labelled links stay unmarked so the print CSS adds the address");
    assert.match(html, /<a href="https:\/\/bare.example.org\/" data-bare /, "a link whose text is the address is marked bare");
  });
  await test("reminders (#15): whole minutes are kept as typed and the preview says when it will ring", () => {
    const now = new Date(2026, 10, 3, 16, 31, 20).getTime();
    const at = c.parseRemindInput("2026-11-03", "16:43");
    assert.equal(at, new Date(2026, 10, 3, 16, 43).getTime());
    assert.equal(c.remindPreview(at, now), "Will ring at 16:43 (in 12 min)");
    assert.equal(c.remindPreview(c.parseRemindInput("2026-11-03", "18:36"), now), "Will ring at 18:36 (in 2 h 5 min)");
    assert.equal(c.remindPreview(c.parseRemindInput("2026-11-05", "09:00"), now), "Will ring at 2026-11-05 09:00 (in 40 h 29 min)");
    assert.equal(c.remindPreview(c.parseRemindInput("2026-11-20", "09:00"), now), "Will ring at 2026-11-20 09:00 (in 17 days)");
    assert.equal(c.remindPreview(c.parseRemindInput("2026-11-03", "16:00"), now), "That time has already passed");
    assert.match(c.remindPreview(0, now), /YYYY-MM-DD/);
    assert.equal(c.REMIND_STEP_MS, 60000);
    assert.equal(c.cleanRemind(at + 4000), at, "seconds are dropped");
  });
  await test("find highlight (#8): highlightSegments splits text around matches and skips overlaps", () => {
    const text = "a Needle b needle c";
    const m = c.findMatches(text, "needle");
    assert.deepEqual(Array.from(c.highlightSegments(text, m), (x) => [x.text, x.hit]), [["a ", false], ["Needle", 0], [" b ", false], ["needle", 1], [" c", false]]);
    assert.deepEqual(Array.from(c.highlightSegments("abc", []), (x) => [x.text, x.hit]), [["abc", false]]);
    assert.deepEqual(Array.from(c.highlightSegments("aaa", [{ start: 0, end: 2 }, { start: 1, end: 3 }]), (x) => [x.text, x.hit]), [["aa", 0], ["a", false]]);
    assert.equal(Array.from(c.highlightSegments(text, m), (x) => x.text).join(""), text, "nothing is lost or duplicated");
  });
  await test("trash auto-empty (#30): trashPlan, trashBanner and cleanTrashDays", () => {
    const D = 86400000, now = 100 * D;
    const notes = [{ id: "old", trashed: now - 40 * D }, { id: "mid", trashed: now - 10 * D }, { id: "live", trashed: 0 }];
    assert.deepEqual(JSON.parse(JSON.stringify(c.trashPlan(notes, 30, now))), { days: 30, total: 2, expired: ["old"], nextMs: now + 20 * D });
    assert.deepEqual(JSON.parse(JSON.stringify(c.trashPlan(notes, 7, now))).expired, ["old", "mid"]);
    assert.deepEqual(JSON.parse(JSON.stringify(c.trashPlan(notes, 0, now))), { days: 0, total: 2, expired: [], nextMs: 0 });
    assert.match(c.trashBanner(c.trashPlan(notes, 0, now), now), /Auto-empty is off/);
    assert.match(c.trashBanner(c.trashPlan(notes, 30, now), now), /1 note is past that and will be deleted at the next start/);
    assert.match(c.trashBanner(c.trashPlan([notes[1]], 30, now), now), /next one expires in 20 days/);
    assert.match(c.trashBanner(c.trashPlan([], 14, now), now), /^Notes are deleted 14 days after they were trashed, when Notes starts\.$/);
    assert.deepEqual([c.cleanTrashDays("7"), c.cleanTrashDays(0), c.cleanTrashDays("x"), c.cleanTrashDays(""), c.cleanTrashDays(undefined), c.cleanTrashDays(45), c.cleanTrashDays(3651), c.cleanTrashDays(-1)], [7, 0, 30, 30, 30, 45, 30, 30]);
  });
  await test("spell-check (#31): on by default, off by pref, and off above the length limit", () => {
    assert.equal(c.spellcheckOn(true, 100000, 500), true);
    assert.equal(c.spellcheckOn(undefined, 100000, 500), true, "unset = on");
    assert.equal(c.spellcheckOn(false, 100000, 500), false);
    assert.equal(c.spellcheckOn(true, 100000, 100001), false, "too long");
    assert.equal(c.spellcheckOn(true, 100000, 100000), true, "exactly at the limit is still fine");
    assert.equal(c.spellcheckOn(true, 0, 5000000), true, "0 = no limit");
  });
  await test("outline (#27): headings with levels shifted to the shallowest, current heading marked, long lists capped, code fences ignored", () => {
    const body = "intro\n## Alpha\ntext\n### Beta\n```\n# not a heading\n```\n## Gamma\n";
    const o = c.outlineItems(body, 3);
    assert.deepEqual(Array.from(o.items, (x) => [x.level, x.text, x.current]), [[1, "Alpha", false], [2, "Beta", true], [1, "Gamma", false]]);
    assert.equal(o.more, 0);
    assert.deepEqual(Array.from(c.outlineItems(body, 0).items, (x) => x.current), [false, false, false], "caret above every heading: none current");
    assert.deepEqual(Array.from(c.outlineItems(body, -1).items, (x) => x.current), [false, false, false], "no caret (read view)");
    const many = Array.from({ length: 70 }, (_, i) => "# H" + i).join("\n");
    const m = c.outlineItems(many, -1, 60);
    assert.equal(m.items.length, 60);
    assert.equal(m.more, 10);
    assert.deepEqual(JSON.parse(JSON.stringify(c.outlineItems("no headings", 0))), { items: [], more: 0 });
  });
  await test("pinned strip (#29): stripModel lists pinned notes and recents without the open note, skips trash", () => {
    const notes = [
      { id: "a", body: "# Alpha\nx", pinned: true },
      { id: "b", body: "Beta", pinned: true, trashed: 5 },
      { id: "c", body: "Gamma" },
      { id: "d", body: "", label: "Labelled", pinned: true },
    ];
    const m = JSON.parse(JSON.stringify(c.stripModel(notes, ["c", "a", "b", "zzz"], "a")));
    assert.deepEqual(m.pinned, [{ id: "a", title: "Alpha" }, { id: "d", title: "Labelled" }]);
    assert.deepEqual(m.recent, [{ id: "c", title: "Gamma" }], "open note, trashed and unknown ids are left out");
    assert.deepEqual(JSON.parse(JSON.stringify(c.stripModel([], [], ""))), { pinned: [], recent: [] });
  });
  await test("colours (#24): every note and highlight colour has all the CSS it needs; unknown highlight names stay yellow", () => {
    const has = (re) => assert.ok(re.test(CSS), "missing CSS: " + re);
    const notes = Array.from(c.NOTE_COLORS).filter((x) => x !== "none");
    assert.ok(notes.length >= 9 && notes.includes("gray") && notes.includes("teal"));
    for (const k of notes) {
      has(new RegExp(`\\.zentral-notes-sheet\\[data-color="${k}"\\] \\{ --zn-note`));
      has(new RegExp(`\\.zn-dot\\[data-color="${k}"\\]`));
      has(new RegExp(`\\.zn-swatch\\[data-color="${k}"\\]`));
    }
    const html = c.exportHtml("x");
    for (const k of Array.from(c.HIGHLIGHT_COLORS)) {
      if (k !== "yellow") { // yellow is the base style, it needs no data-color rule
        has(new RegExp(`\\.zn-hl-dot\\[data-color="${k}"\\]`));
        has(new RegExp(`\\.zn-hl\\[data-color="${k}"\\]`));
      }
      has(new RegExp(`\\.zn-swatch\\[data-color="${k}"\\]`));
      if (k !== "yellow") assert.ok(html.includes(`mark[data-color=${k}]`), "export CSS lacks " + k);
    }
    const hl = (src) => c.parseInline(src).find((x) => x.t === "hl");
    assert.equal(hl("=={gray}a==").color, "gray");
    assert.equal(hl("=={brown}a==").color, "brown");
    assert.equal(hl("=={nope}a==").color, "yellow");
  });
  await test("labels (#19): labelSummary groups case-insensitively, counts live notes, most used first", () => {
    const notes = [{ label: "Work" }, { label: "work" }, { label: " Ideas " }, { label: "" }, { label: "work", trashed: 3 }, { label: "Zed" }, {}];
    assert.deepEqual(JSON.parse(JSON.stringify(c.labelSummary(notes))), [{ label: "Work", count: 2 }, { label: "Ideas", count: 1 }, { label: "Zed", count: 1 }]);
    assert.deepEqual(JSON.parse(JSON.stringify(c.labelSummary([]))), []);
  });
  await test("demo notes (#3): valid fixed ids, every [[link]] points at another demo note, all render and export", () => {
    const demos = Array.from(c.DEMO_NOTES);
    assert.equal(demos.length, 6);
    assert.equal(new Set(demos.map((d) => d.id)).size, 6, "ids are unique");
    const titles = demos.map((d) => c.demoTitle(d));
    assert.deepEqual(titles, ["Notes syntax tour", "Linking notes demo", "Callouts and reminders", "Markdown flavors showcase", "Typing shortcuts and where things are", "Torture test (placeholder)"]);
    for (const d of demos) {
      assert.match(d.id, /^[A-Za-z0-9_][A-Za-z0-9_ .-]{0,120}$/, d.id + " passes the note id rule");
      for (const m of d.body.replace(/`[^`\n]*`/g, "").matchAll(/\[\[([^\]\n]+)\]\]/g)) assert.ok(titles.includes(m[1]) || /^embed$/.test(m[1]) || /^Note#Heading$/.test(m[1]), `${d.id}: [[${m[1]}]] has no demo target`);
      assert.doesNotThrow(() => c.parseBlocks(d.body), d.id);
      assert.match(c.exportHtml(d.body), /<h1[ >]/, d.id + " exports");
    }
    assert.equal(c.DEMO_FOLDER, "help");
    assert.equal(c.cleanFolder(c.DEMO_FOLDER), "help", "a valid folder id");
  });
  console.log(`\n${passed} notes cycle F tests passed`);
})().catch((error) => { console.error("FAIL", error); process.exit(1); });
