"use strict";
/* T1.5: foreign YAML front matter. Pure core only (parse, keep byte for byte, hide in the read view, tags / aliases
 * as pills); nothing here proves the pill row looks right inside Zen. */
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const flavors = require(path.join(root, "additional/notes/flavors/ZentralNotesFlavors.js"));
const shortcuts = require(path.join(root, "additional/notes/flavors/ZentralNotesShortcuts.js"));
const source = fs.readFileSync(path.join(root, "additional/notes/ZentralNotes.uc.js"), "utf8");
const css = fs.readFileSync(path.join(root, "additional/notes/ZentralNotes.css"), "utf8");
const seam = {};
const win = { __zentralNotesTestSeam: seam, __zentralNotesParts: { "notes-flavors": flavors, "notes-shortcuts": shortcuts }, ZentralRuntime: { register() {} } };
win.window = win;
vm.runInNewContext(source, { window: win, globalThis: { Services: {} }, ChromeUtils: {}, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, console });
const c = seam.core;
let passed = 0;
const eq = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);
function test(name, fn) {
  fn();
  passed++;
  console.log("ok -", name);
}
const OURS = "id: n1\ncreated: 2026-01-01T00:00:00.000Z\nupdated: 2026-01-02T00:00:00.000Z";

test("our header + foreign properties: foreign entries are kept verbatim, ours are consumed", () => {
  const file = "---\n" + OURS + "\ntags:\n  - alpha\n  - beta\ncssclasses: wide\naliases: [One, \"Two words\"]\ncolor: yellow\n---\nBody text\n";
  const { meta, body } = c.parseNoteText(file);
  assert.equal(body, "Body text\n");
  assert.equal(meta.color, "yellow");
  assert.equal(meta.foreign, "tags:\n  - alpha\n  - beta\ncssclasses: wide\naliases: [One, \"Two words\"]");
});

test("save round trip: foreign block survives noteFromFile -> serializeNote -> noteFromFile unchanged", () => {
  const file = "---\n" + OURS + "\ncolor: blue\ntags: [a, b]\n# a comment kept with the entry above\nkey with space: value: with colon\nlist:\n- x\n- y\n---\nBody\n";
  const n = c.noteFromFile("n1", file, 1);
  assert.equal(n.color, "blue");
  assert.equal(n.body, "Body\n");
  const out = c.serializeNote(n);
  const again = c.noteFromFile("n1", out, 1);
  assert.equal(again.foreign, n.foreign);
  assert.equal(again.body, "Body\n");
  for (const line of ["tags: [a, b]", "key with space: value: with colon", "list:", "- x", "- y"]) assert.ok(out.includes(line), line);
  assert.ok(out.indexOf("updated:") < out.indexOf("tags:"), "our keys first");
  assert.equal(out.match(/^---$/gm).length, 2, "still exactly one front matter block");
});

test("editing the body or our keys never touches the foreign text; trash and colour round-trip", () => {
  const n = c.noteFromFile("n1", "---\n" + OURS + "\ntags: [keep]\n---\nOld\n", 1);
  n.body = "New body\n---\nmore";
  n.color = "green";
  n.trashed = 1700000000000;
  const back = c.noteFromFile("n1", c.serializeNote(n), 1);
  assert.equal(back.foreign, "tags: [keep]");
  assert.equal(back.body, "New body\n---\nmore");
  assert.equal(back.color, "green");
  assert.equal(back.trashed, 1700000000000);
});

test("a note without foreign properties serializes exactly as before", () => {
  const n = c.noteFromFile("n1", "---\n" + OURS + "\n---\nHi", 1);
  assert.equal(n.foreign, "");
  assert.equal(c.serializeNote(n), "---\n" + OURS + "\n---\nHi");
  const fresh = { id: "n2", body: "x", created: 0, updated: 0, color: "none", label: "", folder: "", pinned: false, trashed: 0, remind: 0, reminded: 0 };
  assert.ok(!/tags|foreign|undefined/.test(c.serializeNote(fresh)));
});

test("foreign-only front matter stays in the body (editable) but is recognised", () => {
  const file = "---\ntags: [x]\ntitle: Imported\n---\n# Heading\ntext";
  const { meta, body } = c.parseNoteText(file);
  eq(meta, {});
  assert.equal(body, file);
  const n = c.noteFromFile("n3", file, 1);
  assert.equal(n.body, file);
  assert.equal(c.serializeNote(n).endsWith("---\n" + file), true, "saved text keeps it as the first body lines");
});

test("leadingFrontMatter: accepts YAML-looking blocks, rejects prose between rules", () => {
  const ok = (t) => assert.ok(c.leadingFrontMatter(t), t);
  const no = (t) => assert.equal(c.leadingFrontMatter(t), null, t);
  ok("---\ntags: a\n---\nx");
  ok("---\ntitle: T\ndate: 2026-01-01\n---\n");
  ok("---\ntags:\n  - a\n---");
  ok("---\n# comment\nauthor: me\n---\nbody");
  ok("\uFEFF---\r\ntags: a\r\n---\r\nx");
  no("---\nNote: only one prose line\n---\nx");
  no("---\nHello world\nTodo: x\n---\nx");
  no("---\n\n---\nx");
  no("---\ntags: a\nno closing fence");
  no("text\n---\ntags: a\n---");
  no("----\ntags: a\n----");
  no("---\n" + Array.from({ length: 401 }, (_, i) => "k" + i + ": v").join("\n") + "\n---");
  no("");
  no(null);
  no(undefined);
});

test("hideFrontMatter keeps line numbers and leaves other text alone", () => {
  const t = "---\ntags: a\naliases: b\n---\n- [ ] task\n";
  const h = c.hideFrontMatter(t);
  assert.equal(h, "\n\n\n\n- [ ] task\n");
  assert.equal(h.split("\n").indexOf("- [ ] task"), t.split("\n").indexOf("- [ ] task"));
  assert.equal(c.hideFrontMatter("---\nNote: x\n---\nrest"), "---\nNote: x\n---\nrest");
  assert.equal(c.hideFrontMatter("plain"), "plain");
  assert.equal(c.hideFrontMatter("---\ntags: a\n---"), "\n\n\n".slice(0, 2) + "\n");
});

test("title and snippet skip foreign front matter; export hides it", () => {
  const t = "---\ntags: [a]\ntitle: Imported\n---\n# Real title\nfirst line\n";
  assert.equal(c.titleOf(t), "Real title");
  assert.equal(c.snippetOf(t), "first line");
  assert.equal(c.titleOf("plain title\nx"), "plain title");
  const html = c.exportHtml(t);
  assert.ok(html.includes("Real title") && !/tags: \[a\]|Imported/.test(html));
  assert.ok(!/tags:|Imported/.test(c.exportText(t)));
});

test("parseForeignMeta: inline, comma, block lists, quotes, # prefixes, caps and duplicates", () => {
  const P = (y) => c.parseForeignMeta(y);
  eq(P("tags: [a, b/c, \"d e\"]\naliases: [X, 'Y Z']"), { tags: ["a", "b/c", "d e"], aliases: ["X", "Y Z"] });
  eq(P("tags:\n  - one\n  - \"two\"\n  - #three\naliases:\n- Alt name\n- Other"), { tags: ["one", "two", "three"], aliases: ["Alt name", "Other"] });
  eq(P("tags: a, b c\nalias: Solo Name"), { tags: ["a", "b", "c"], aliases: ["Solo Name"] });
  eq(P("tag: \"#solo\""), { tags: ["solo"], aliases: [] });
  eq(P("tag: #solo"), { tags: [], aliases: [] }); // YAML: everything after " #" is a comment
  eq(P("Tags: [A, a, A]"), { tags: ["A"], aliases: [] });
  eq(P("tags:\n  - a # trailing comment\ntitle: x"), { tags: ["a"], aliases: [] });
  eq(P("tags:\n\n  # note\n  - a\n\ntitle: x"), { tags: ["a"], aliases: [] });
  eq(P("tags: [unclosed"), { tags: [], aliases: [] });
  eq(P("title: x\ndate: 1"), { tags: [], aliases: [] });
  eq(P(""), { tags: [], aliases: [] });
  eq(P(null), { tags: [], aliases: [] });
  const many = P("tags: [" + Array.from({ length: 120 }, (_, i) => "t" + i).join(",") + "]");
  assert.equal(many.tags.length, 50);
  assert.equal(P("tags: [" + "x".repeat(200) + "]").tags[0].length, 60);
  eq(P("tags: [a\u0000b, \u0007]").tags, ["a b"]);
});

test("frontPills reads our extracted foreign text first, then a block still in the body", () => {
  eq(c.frontPills({ foreign: "tags: [x]", body: "---\ntags: [y]\n---\n" }), { tags: ["x"], aliases: [] });
  eq(c.frontPills({ foreign: "", body: "---\naliases: [Al]\ntitle: t\n---\n" }), { tags: [], aliases: ["Al"] });
  eq(c.frontPills({ foreign: "", body: "no yaml" }), { tags: [], aliases: [] });
  eq(c.frontPills(null), { tags: [], aliases: [] });
});

test("size guard: an oversized foreign block is not stored or written back", () => {
  const big = "tags: [" + "a".repeat(c.MAX_FOREIGN_CHARS) + "]";
  const n = c.noteFromFile("n1", "---\n" + OURS + "\n" + big + "\n---\nB", 1);
  assert.equal(n.foreign, "");
  assert.equal(n.body, "B");
  const forced = { id: "n1", body: "B", created: 0, updated: 0, color: "none", label: "", folder: "", pinned: false, trashed: 0, remind: 0, reminded: 0, foreign: big };
  assert.ok(!c.serializeNote(forced).includes("aaaa"));
});

test("pill text is rendered as text only: renderFront builds spans through h() with textContent children", () => {
  const i = source.indexOf("function renderFront()");
  assert.ok(i > 0);
  const fn = source.slice(i, i + 1400);
  assert.ok(/h\("span", \{ class: "zn-pill zn-pill-tag"/.test(fn) && !/innerHTML|insertAdjacentHTML/.test(fn));
  assert.ok(/renderReadInner\(\);\s*renderFront\(\);/.test(source));
  assert.ok(/parseBlocks\(readBody\(hideFrontMatter\(n\.body\)/.test(source));
  assert.ok(/\.zn-front \.zn-pill\b/.test(css) && /\.zn-pill-alias/.test(css));
});

console.log(passed + " front-matter tests passed");
