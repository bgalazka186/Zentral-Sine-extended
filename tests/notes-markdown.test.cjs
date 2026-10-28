"use strict";
/* Markdown fixtures for additional/notes/ZentralNotes.uc.js: parser (tables, images, quotes, rules,
 * strike, task lists), incremental-preview diff, HTML / text export and file naming.
 * Pure functions only; it does NOT prove how anything renders inside Zen. */
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const seam = {};
const win = { __zentralNotesTestSeam: seam, ZentralRuntime: { register() {} } };
win.window = win;
vm.runInNewContext(source, { window: win, globalThis: { Services: {} }, ChromeUtils: {}, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, console });
const c = seam.core;
const same = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m); // objects come from another realm
const text = (nodes) => nodes.map((n) => n.s ?? text(n.c || [])).join("");
let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok -", name);
}

test("tables: header, alignment, escaped pipe, ragged rows padded, extra cells cut", () => {
  const [t] = c.parseBlocks("| A | B | C |\n|:--|:-:|--:|\n| 1 | a\\|b | 3 |\n| only one |\n| 1 | 2 | 3 | 4 |");
  assert.equal(t.type, "table");
  same(t.align, ["left", "center", "right"]);
  same(t.head.map(text), ["A", "B", "C"]);
  assert.equal(t.rows.length, 3);
  assert.equal(text(t.rows[0][1]), "a|b");
  same(t.rows[1].map(text), ["only one", "", ""]);
  assert.equal(t.rows[2].length, 3);
});

test("tables: pipes without a delimiter row stay a paragraph; a lone --- is still a rule", () => {
  assert.equal(c.parseBlocks("a | b\nc | d")[0].type, "p");
  const blocks = c.parseBlocks("text with | pipe\n---");
  same(blocks.map((b) => b.type), ["p", "hr"]);
  assert.equal(c.parseBlocks("| a | b |\n|---|---|")[0].type, "table", "header-only table");
});

test("tables: a table ends a paragraph and is followed by normal blocks; size is capped", () => {
  const blocks = c.parseBlocks("intro\n| a | b |\n|---|---|\n| 1 | 2 |\n\nafter");
  same(blocks.map((b) => b.type), ["p", "table", "p"]);
  const many = "| a |\n|---|\n" + Array.from({ length: 500 }, () => "| x |").join("\n");
  assert.equal(c.parseBlocks(many)[0].rows.length, 200);
  const wide = "|" + "a|".repeat(30) + "\n|" + "-|".repeat(30);
  assert.equal(c.parseBlocks(wide)[0].head.length, 12);
});

test("images: http(s) only, alt kept, link text stays a link", () => {
  const p = c.parseBlocks("![a cat](https://example.org/c.png) ![](http://x.org/y.png) ![bad](javascript:alert(1)) [t](https://e.org)")[0].c;
  const imgs = p.filter((n) => n.t === "img");
  same(imgs.map((n) => [n.alt, n.href]), [["a cat", "https://example.org/c.png"], ["", "http://x.org/y.png"]]);
  assert.ok(text(p.filter((n) => n.t === "text")).includes("![bad](javascript:alert(1))"), "unsafe image stays literal text");
  assert.equal(p.filter((n) => n.t === "a").length, 1);
  assert.equal(c.parseInline("![x](file:///etc/passwd)").some((n) => n.t === "img"), false);
});

test("quotes nest, rules, strike and task lists", () => {
  const [q, hr, list] = c.parseBlocks("> outer\n> > inner **b**\n\n***\n- [x] ~~done~~\n- [ ] open\n  - [ ] sub");
  assert.equal(q.type, "quote");
  assert.equal(q.blocks[1].type, "quote");
  assert.equal(hr.type, "hr");
  same(list.items.map((i) => i.checked), [true, false, false]);
  assert.equal(list.items[0].c[0].t, "s");
  assert.equal(list.items[2].level, 1);
});

test("insertRule: blank lines around, or fills an empty line", () => {
  same(c.insertRule("abc", 1, 1), { start: 3, end: 3, text: "\n\n---\n\n", selStart: 10, selEnd: 10 });
  assert.equal(c.insertRule("a\n\nb", 2, 2).text, "---\n");
});

test("diffSigs finds the unchanged head and tail", () => {
  same(c.diffSigs(["a", "b", "c"], ["a", "x", "c"]), { prefix: 1, suffix: 1 });
  same(c.diffSigs(["a", "b"], ["a", "b"]), { prefix: 2, suffix: 0 });
  same(c.diffSigs([], ["a"]), { prefix: 0, suffix: 0 });
  same(c.diffSigs(["a", "b", "c"], ["c"]), { prefix: 0, suffix: 1 });
  const p = c.parseBlocks("one\n\ntwo\n\nthree").map(c.blockSig);
  const n = c.parseBlocks("one\n\ntwo!\n\nthree").map(c.blockSig);
  same(c.diffSigs(p, n), { prefix: 1, suffix: 1 }, "editing the middle paragraph touches one block");
});

test("HTML export escapes everything and keeps structure", () => {
  const html = c.exportHtml('# <script>alert(1)</script>\n\n[x](https://e.org/?a=1&b="2") ![i](https://e.org/i.png "t")\n\n- [x] done\n  - nested\n\n| a |\n|---|\n| <b> |\n\n```\n<code> & more\n```\n\n=={red}hot==');
  assert.ok(!html.includes("<script>alert"), "title and text are escaped");
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes('href="https://e.org/?a=1&amp;b=%22'), "attribute values are escaped");
  assert.ok(html.includes('<input type="checkbox" disabled checked>'));
  assert.ok(html.includes("<ul><li>") && html.includes("<ul><li>nested"), "nested list");
  assert.ok(html.includes("<td>&lt;b&gt;</td>"));
  assert.ok(html.includes("&lt;code&gt; &amp; more"));
  assert.ok(html.includes('<mark data-color="red">hot</mark>'));
  assert.ok(!/<script/i.test(html), "no script in a normal export");
  assert.ok(/<script>addEventListener\('load'/.test(c.exportHtml("x", {}, { print: true })), "only the print variant opens the print dialog");
  assert.ok(c.exportHtml("# Hi").includes("<title>Hi</title>"));
});

test("plain-text export drops formatting and keeps content", () => {
  const out = c.exportText("# Title\n\n**bold** and [site](https://e.org) ![cat](https://e.org/c.png)\n\n- [x] a\n- b\n  1. c\n\n| h1 | h2 |\n|---|---|\n| 1 | 2 |\n\n> quote\n\n---");
  assert.ok(out.startsWith("Title\n\nbold and site (https://e.org/) [image: cat]"));
  assert.ok(out.includes("[x] a\n- b\n  1. c"));
  assert.ok(out.includes("h1 | h2\n1 | 2"));
  assert.ok(out.includes("> quote"));
  assert.ok(out.includes("----------"));
  assert.ok(!out.includes("**") && !out.includes("=="));
});

test("every export format has a visible \"what is lost\" notice", () => {
  for (const k of ["md", "html", "txt", "pdf", "zip"]) {
    const f = c.EXPORT_FORMATS[k];
    assert.ok(f && f.label && f.ext && f.loses.length > 40, k);
  }
  assert.ok(Object.isFrozen(c.EXPORT_FORMATS));
});

test("file names for folder and zip export are unique and safe", () => {
  const names = c.uniqueFileNames([{ body: "Plan" }, { body: "plan" }, { body: "a/b:c" }, { body: "" }, { body: "" }]);
  same(names, ["Plan.md", "plan 2.md", "a_b_c.md", "note.md", "note 2.md"]);
  assert.ok(names.every((n) => c.FILE_RE.test(n)));
});

// ---- items that failed the live test of the Markdown dialect (unchecked in the test note) ----------
const kinds = (nodes) => nodes.map((n) => (n.t === "text" ? "text:" + n.s : n.t + "(" + kinds(n.c || []).join(",") + ")"));

test("inline: __bold__, ***bold italic***, mixed ** and _, triple with strikethrough", () => {
  same(kinds(c.parseInline("__x__")), ["b(text:x)"]);
  same(kinds(c.parseInline("***i***")), ["b(i(text:i))"]);
  same(kinds(c.parseInline("___i___")), ["b(i(text:i))"]);
  same(kinds(c.parseInline("**_m1_** and *__m2__*")), ["b(i(text:m1))", "text: and ", "i(b(text:m2))"]);
  same(kinds(c.parseInline("***~~all~~***")), ["b(i(s(text:all)))"]);
  same(kinds(c.parseInline("super**x**word zmienna_w_kodzie_123_test")), ["text:super", "b(text:x)", "text:word zmienna_w_kodzie_123_test"]);
});

test("inline: empty highlights stay literal text instead of pairing with a later marker", () => {
  const nodes = c.parseInline("==== and =={red}== x ==real==");
  assert.equal(text(nodes.filter((n) => n.t === "text")), "==== and =={red}== x ");
  assert.equal(nodes.filter((n) => n.t === "hl").length, 1);
});

test("headings H1-H6; seven hashes and hashtags are plain text", () => {
  const blocks = c.parseBlocks("# a\n## b\n### c\n#### d\n##### e\n###### f\n####### g\n\n#tag ###Was");
  same(blocks.slice(0, 6).map((b) => [b.type, b.level]), [["h", 1], ["h", 2], ["h", 3], ["h", 4], ["h", 5], ["h", 6]]);
  assert.equal(blocks[6].type, "p");
  assert.ok(text(blocks[6].c).startsWith("####### g"));
  assert.equal(blocks[7].type, "p");
});

test("ordered lists number themselves (1. 2. 1. shows 3.), keep a start such as 42, and restart after a bullet", () => {
  const markers = (t) => c.parseBlocks(t)[0].items.map((i) => i.marker);
  same(markers("1. a\n2. b\n1. c"), ["1.", "2.", "3."]);
  same(markers("42. a\n43. b"), ["42.", "43."]);
  same(markers("5) a\n1) b"), ["5)", "6)"]);
  same(markers("1. a\n- x\n1. b"), ["1.", "\u2022", "1."]);
  same(markers("1. a\n  1. n1\n  1. n2\n1. b"), ["1.", "1.", "2.", "2."]);
});

test("a list item can have further paragraphs (blank line, then indented text)", () => {
  const blocks = c.parseBlocks("- first\n\n  second para\n  same para\n- next\n\nplain");
  same(blocks.map((b) => b.type), ["list", "p"]);
  assert.equal(blocks[0].items.length, 2);
  assert.equal(blocks[0].items[0].more.length, 1);
  assert.equal(text(blocks[0].items[0].more[0].filter((n) => n.t === "text")), "second parasame para");
  const html = c.exportHtml("- first\n\n  second\n- next");
  assert.ok(html.includes("<li>first<p>second</p></li><li>next"));
  assert.ok(c.exportText("- first\n\n  second").includes("- first\n\n  second"));
  same(c.parseBlocks("- a\n\nunindented")[1].type, "p");
});

test("nestLines: quotes gain or lose a level, other lines move two spaces", () => {
  assert.equal(c.nestLines("> a\n> > b", 0, 9, 1).text, "> > a\n> > > b");
  assert.equal(c.nestLines("> > a", 0, 5, -1).text, "> a");
  assert.equal(c.nestLines("> a", 0, 3, -1).text, "a");
  assert.equal(c.nestLines("- a\n  - b", 0, 9, 1).text, "  - a\n    - b");
  assert.equal(c.nestLines("  - a\n- b", 0, 9, -1).text, "- a\n- b");
  assert.equal(c.nestLines("x\n\ny", 0, 4, 1).text, "  x\n\n  y", "blank lines stay blank");
  const [q] = c.parseBlocks(c.nestLines("> a", 0, 3, 1).text);
  assert.equal(q.blocks[0].type, "quote", "result parses as a nested quote");
});

// ---- second live test (Cycle B): what was missing or wrong ------------------------------------------
test("links: an optional \"title\", <autolinks>, and an image inside a link", () => {
  same(kinds(c.parseInline('[Ex](https://example.com "Title text")')), ["a(text:Ex)"]);
  const [auto] = c.parseInline("<https://example.com/p?a=1&b=2>");
  assert.equal(auto.t, "a");
  assert.equal(auto.href, "https://example.com/p?a=1&b=2");
  const [link] = c.parseInline("[![pic](https://p.example/i.png)](https://example.com)");
  assert.equal(link.t, "a");
  assert.equal(link.href, "https://example.com/");
  assert.equal(link.c[0].t, "img");
  assert.equal(c.parseInline('![t](https://p.example/i.png "Title")')[0].t, "img");
  assert.equal(c.parseInline("[x](javascript:alert(1))").some((n) => n.t === "a"), false, "unsafe link stays text");
  assert.equal(c.parseInline("<javascript:alert(1)>").some((n) => n.t === "a"), false);
});

test("spaces next to ** or ~~ do not make bold or strikethrough; empty markers stay text", () => {
  same(kinds(c.parseInline("* not * and ** not bold **")), ["text:* not * and ** not bold **"]);
  assert.equal(text(c.parseInline("**** ~~~~ ====")), "**** ~~~~ ====");
  same(kinds(c.parseInline("**ok** ~~ok~~")), ["b(text:ok)", "text: ", "s(text:ok)"]);
});

test("backslash escapes: the character shows, nothing starts; code keeps its backslash", () => {
  same(kinds(c.parseInline("\\*not italic\\* \\*\\*not bold\\*\\*")), ["text:*not italic* **not bold**"]);
  same(kinds(c.parseInline("\\=={red}not highlighted\\==")), ["text:=={red}not highlighted=="]);
  same(kinds(c.parseInline("\\[not a link\\](https://example.com)")), ["text:[not a link](", "a(text:https://example.com)", "text:)"]);
  same(kinds(c.parseInline("`a\\*b` and a \\\\ slash")), ["code()", "text: and a \\ slash"]);
  assert.equal(c.parseInline("`a\\*b`")[0].s, "a\\*b");
  assert.equal(c.parseBlocks("\\# not a heading")[0].type, "p");
  assert.equal(text(c.parseBlocks("\\# not a heading")[0].c), "# not a heading");
  assert.equal(c.parseInline("plain \\ backslash and \\q")[0].s, "plain \\ backslash and \\q");
});

test("callouts: > [!NOTE] Title becomes a labelled quote, unknown kinds stay quotes", () => {
  const [n, w, plain] = c.parseBlocks("> [!NOTE] Heads up\n> body text\n\n> [!warning]\n> careful\n\n> [!bogus] x\n> y");
  assert.equal(n.callout.kind, "note");
  assert.equal(n.callout.title, "Heads up");
  assert.equal(text(n.blocks[0].c), "body text");
  assert.equal(w.callout.kind, "warning");
  assert.equal(w.callout.title, "");
  assert.equal(plain.callout, undefined);
  const html = c.exportHtml("> [!TIP] Try this\n> do it");
  assert.ok(html.includes('<blockquote class="callout" data-kind="tip">') && html.includes("<strong>Try this</strong>"));
  assert.ok(c.exportText("> [!NOTE]\n> hi").includes("> NOTE"));
});

console.log(`\n${passed} markdown tests passed`);
