"use strict";
/* T1.14: shared inline/front-matter tags, exclusions and per-note usage counts. */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const seam = {};
const win = { __zentralNotesTestSeam: seam, ZentralRuntime: { register() {} } };
win.window = win;
vm.runInNewContext(source, { window: win, globalThis: { Services: {} }, ChromeUtils: {}, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, console });
const c = seam.core;
const plain = (value) => JSON.parse(JSON.stringify(value));
let passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok -", name); }

test("inline tags support nested paths and de-duplicate case-insensitively", () => {
  assert.deepEqual(plain(c.inlineTags("A #Work and #work plus #project/phase-two/review.")), ["Work", "project/phase-two/review"]);
});

test("headings, fenced and inline code, URLs, link destinations, HTML and hex colours are excluded", () => {
  const body = [
    "# Heading #heading-only",
    "Visible #alpha",
    "`#inline-code` and `#another/code`",
    "```md",
    "#fenced #not-a-tag",
    "```",
    "https://example.test/path#urltag and www.example.test/#wwwtag",
    "[linked](https://example.test/#href-tag) and [#label](https://example.test)",
    "<span data-tag=\"#attribute\">#outside-html-element</span>",
    "Colours #fff #abcd #123456 #abcdef12 but #nothex remains",
  ].join("\n");
  assert.deepEqual(plain(c.inlineTags(body)), ["alpha", "label", "outside-html-element", "nothex"]);
});

test("front matter tags merge with inline tags and de-duplicate case-insensitively", () => {
  const note = { body: "---\ntags: [alpha, yaml-tag, '#Nested/Meta']\n---\nBody #Alpha #inline-tag" };
  assert.deepEqual(plain(c.noteTags(note)), ["alpha", "yaml-tag", "Nested/Meta", "inline-tag"]);
  const foreign = { body: "Body #body-tag", foreign: "tags:\n  - foreign-tag\n  - '#Path/Tag'" };
  assert.deepEqual(plain(c.noteTags(foreign)), ["foreign-tag", "Path/Tag", "body-tag"]);
});

test("tag summary counts each live note once and sorts by count then name", () => {
  const notes = [
    { body: "#Alpha #alpha #beta" },
    { body: "---\ntags: [alpha, gamma]\n---\n#beta" },
    { body: "#gamma #delta", trashed: 1 },
    { body: "#Beta #epsilon" },
  ];
  assert.deepEqual(plain(c.tagSummary(notes)), [
    { tag: "beta", count: 3 },
    { tag: "Alpha", count: 2 },
    { tag: "epsilon", count: 1 },
    { tag: "gamma", count: 1 },
  ]);
});

console.log(`${passed} T1.14 tag tests passed`);
