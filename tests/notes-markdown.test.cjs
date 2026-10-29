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

test("B2 inline: sub/superscript, keys, link tooltip, mail links, escapes", () => {
  const n = c.parseInline("H~2~O X^2^ <kbd>Ctrl</kbd> ~~gone~~ a~b \\^not\\^");
  assert.ok(n.some((x) => x.t === "sub" && text(x.c) === "2"));
  assert.ok(n.some((x) => x.t === "sup" && text(x.c) === "2"));
  assert.ok(n.some((x) => x.t === "kbd" && x.s === "Ctrl"));
  assert.ok(n.some((x) => x.t === "s"), "strike still wins over subscript");
  assert.ok(!n.some((x) => x.t === "sup" && text(x.c) === "not"), "escaped carets stay text");
  const [a] = c.parseInline('[x](https://e.org "Tip")');
  assert.equal(a.title, "Tip");
  const mail = c.parseInline("<me@x.org> and mailto:y@z.com");
  assert.equal(mail.filter((x) => x.t === "a").map((x) => x.href).join(), "mailto:me@x.org,mailto:y@z.com");
  assert.equal(c.safeHref("mailto:a@b.co"), "mailto:a@b.co");
  assert.equal(c.safeHref("mailto:a@b.co", false), null, "images never take mailto");
  assert.equal(c.safeHref("javascript:alert(1)"), null);
});

test("B2 reference links: definitions anywhere, hidden, case-insensitive; unknown stays text", () => {
  const blocks = c.parseBlocks('See [docs][D] and [d][].\n\n[d]: https://e.org/d "Docs"\n\n[x][nope]');
  const links = blocks[0].c.filter((x) => x.t === "a");
  assert.equal(links.length, 2);
  assert.equal(links[0].href, "https://e.org/d");
  assert.equal(links[0].title, "Docs");
  assert.ok(!blocks.some((b) => b.type === "p" && text(b.c).includes("e.org/d")), "the definition line is not shown");
  assert.equal(text(blocks[blocks.length - 1].c), "[x][nope]");
  assert.equal(c.parseInline("[a][d]").filter((x) => x.t === "a").length, 0, "no document, no references");
});

test("B2 Setext headings are opt-in; sources keep their line numbers", () => {
  same(c.parseBlocks("Title\n=====\n\nSub\n---", false, { setext: true }).map((b) => [b.type, b.level]), [["h", 1], ["h", 2]]);
  same(c.parseBlocks("Title\n=====\n\ntext\n---").map((b) => b.type), ["p", "p", "hr"], "off: === is text, --- a rule");
  const blocks = c.parseBlocks("a\n\n\n# H\n\n- x\n- y");
  assert.equal(blocks.find((b) => b.type === "h").src, 3);
  assert.ok(!JSON.stringify(blocks).includes('"src"'), "src is not part of the block signature");
});

test("B2 code blocks keep their language and are coloured by a small offline tokenizer", () => {
  const [code] = c.parseBlocks("```JS\nconst x = 1;\n```");
  assert.equal(code.lang, "js");
  assert.equal(c.parseBlocks("```\nplain\n```")[0].lang, undefined);
  const kinds = (src, lang) => c.highlightCode(src, lang).map((t) => t.k + ":" + t.s);
  assert.ok(kinds('const x = foo("a\\"b", 12); // hi', "javascript").join("|").includes("kw:const"));
  const js = c.highlightCode('const x = foo("a\\"b", 12); // hi', "ts");
  assert.ok(js.some((t) => t.k === "str" && t.s === '"a\\"b"') && js.some((t) => t.k === "num" && t.s === "12") && js.some((t) => t.k === "fn" && t.s === "foo") && js.some((t) => t.k === "com"));
  assert.ok(c.highlightCode('{"a": [1, true]}', "json").some((t) => t.k === "prop" && t.s === '"a"'));
  assert.ok(c.highlightCode("<div class=\"a\"></div>", "html").some((t) => t.k === "tag") );
  assert.ok(c.highlightCode("SELECT a FROM t -- c", "sql").some((t) => t.k === "kw" && t.s === "SELECT"));
  assert.ok(c.highlightCode('echo "$HOME" # c', "bash").some((t) => t.k === "prop" || t.k === "str"));
  same(c.highlightCode("x < y", "unknown-lang"), [{ k: "", s: "x < y" }]);
  assert.equal(c.highlightCode("a".repeat(30000), "js").length, 1, "huge blocks stay plain");
  assert.equal(c.highlightCode('const s = "never closed\nlet x', "js").map((t) => t.s).join(""), 'const s = "never closed\nlet x', "tokens always add back up to the text");
});

test("B2 exports: sub/sup/kbd/title survive in HTML and fall back in text", () => {
  const html = c.exportHtml('H~2~O X^2^ <kbd>Esc</kbd> [t](https://e.org "tip")');
  assert.ok(html.includes("<sub>2</sub>") && html.includes("<sup>2</sup>") && html.includes("<kbd>Esc</kbd>") && html.includes('title="tip"'));
  assert.ok(c.exportText("H~2~O <kbd>Esc</kbd>").includes("H2 Esc") || c.exportText("H~2~O <kbd>Esc</kbd>").includes("H2O Esc"));
});

test("B2 insert helpers: code block, link, image, table, numbered list", () => {
  const cb = c.insertCodeBlock("ab", 1, 1);
  assert.equal(cb.text, "\n```\n\n```\n");
  const un = c.insertCodeBlock("```js\nx\n```", 0, 11);
  assert.equal(un.text, "x");
  assert.equal(c.buildLink("a]b", "https://x.org/a b(1)"), "[a\\]b](https://x.org/a%20b%281%29)");
  const round = c.parseInline(c.buildLink("a]b", "https://x.org/a b(1)")).find((x) => x.t === "a");
  assert.equal(text(round.c), "a]b");
  const img = c.insertImage("alt", 0, 3);
  assert.equal(img.text, "![alt](https://)");
  assert.equal(img.text.slice(img.selStart, img.selEnd), "https://");
  const t = c.makeTable(3, 2);
  const [tb] = c.parseBlocks(t);
  assert.equal(tb.type, "table");
  assert.equal(tb.head.length, 2);
  assert.equal(tb.rows.length, 2);
  assert.equal(c.makeTable(999, 999).split("\n").length <= 202, true, "table size is capped");
  const ins = c.insertTable("abc", 1, 1, 3, 3);
  assert.ok(ins.text.startsWith("\n\n| Column 1"));
  assert.equal(c.toggleLinePrefix("a\nb\n\nc", 0, 6, "ordered").text, "1. a\n2. b\n\n3. c");
  assert.equal(c.toggleLinePrefix("1. a\n2. b", 0, 9, "ordered").text, "a\nb");
});

test("B2 pasted addresses and 'copy link to highlight' labels", () => {
  assert.ok(c.pastedLink(" https://e.org/a?b=1 "));
  assert.equal(c.pastedLink("https://e.org two words"), null);
  assert.equal(c.pastedLink("javascript:alert(1)"), null);
  assert.equal(c.pastedLink("just text"), null);
  assert.equal(c.fragmentLabel("https://e.org/p#:~:text=hello%20wor,ld"), "hello wor\u2026ld");
  assert.equal(c.fragmentLabel("https://e.org/p"), "");
});

test("B2 linked scrolling maps by source line, both ways, and clamps at the ends", () => {
  const a = [{ line: 0, y: 0 }, { line: 10, y: 100 }, { line: 20, y: 400 }];
  assert.equal(c.mapPosition(a, 15, "line", "y"), 250);
  assert.equal(c.mapPosition(a, 250, "y", "line"), 15);
  assert.equal(c.mapPosition(a, -5, "line", "y"), 0);
  assert.equal(c.mapPosition(a, 999, "y", "line"), 20);
  same(c.mergeAnchors([{ line: 2, y: 20 }, { line: 2, y: 25 }, { line: 5, y: 50 }], 10, 200).map((x) => x.line), [0, 2, 5, 10]);
  assert.equal(c.mapPosition([], 5, "y", "line"), 0);
});

test("B2 shortcuts: defaults, overrides, conflicts, layout-independent digits", () => {
  const list = c.effectiveShortcuts({});
  assert.equal(list.find((x) => x.id === "bold").combo, "Ctrl+B");
  assert.equal(new Set(list.map((x) => x.combo)).size, list.length, "no two defaults share a combination");
  assert.equal(c.matchShortcutAction({ key: "!", code: "Digit1", ctrlKey: true, shiftKey: true }, list), "heading");
  const mine = c.effectiveShortcuts(c.parseShortcutMap('{"bold":"","link":"ctrl+alt+k","nope":"Ctrl+Q","code":"K"}'));
  assert.equal(mine.find((x) => x.id === "bold"), undefined, "empty = unassigned");
  assert.equal(mine.find((x) => x.id === "link").combo, "Ctrl+Alt+K");
  assert.equal(mine.find((x) => x.id === "code").combo, "Ctrl+Shift+C", "a combination without a modifier is ignored");
  assert.equal(c.findShortcutConflict(mine, "bold", "Ctrl+I"), "italic");
  assert.equal(c.findShortcutConflict(mine, "bold", "Ctrl+Alt+Q"), "");
  same(c.assignShortcut({}, "bold", "Ctrl+B"), {}, "a default is not stored");
  same(c.assignShortcut({}, "bold", ""), { bold: "" });
  assert.equal(c.comboFromEvent({ key: "K", code: "KeyK", ctrlKey: true, shiftKey: true }), "Ctrl+Shift+K");
  assert.equal(c.comboFromEvent({ key: "Control", ctrlKey: true }), "");
  same(c.parseShortcutMap("not json"), {});
});

test("B2 quick settings table points at real preferences and clamps steps", () => {
  const prefs = new Set(Object.values(c.PREF));
  for (const o of c.QUICK_OPTIONS) assert.ok(o.meta || prefs.has(o.pref), o.id);
  const font = c.QUICK_OPTIONS.find((o) => o.id === "font");
  assert.equal(c.stepOption(font, 40, 1), 40);
  assert.equal(c.stepOption(font, 8, -1), 8);
  assert.equal(c.stepOption(font, 13, 1), 14);
});

test("C2.2 table alignment, image + link, code languages, callouts, hidden tools", () => {
  const [tb] = c.parseBlocks(c.makeTable(2, 4, ["left", "center", "right"]));
  assert.equal(JSON.stringify(tb.align), JSON.stringify(["left", "center", "right", ""]));
  assert.equal(c.makeTable(2, 2), c.makeTable(2, 2, []), "no alignment keeps the old table");
  assert.equal(c.buildImage("a [b]\nc", "https://x.org/a b(1).png"), "![a  b  c](https://x.org/a%20b%281%29.png)");
  const linked = c.buildImage("pic", "https://x.org/p.png", "https://x.org/page");
  assert.equal(linked, "[![pic](https://x.org/p.png)](https://x.org/page)");
  const a = c.parseInline(linked)[0];
  assert.equal(a.t, "a");
  assert.equal(a.c[0].t, "img");
  assert.equal(c.buildImage("pic", "https://x.org/p.png", "javascript:alert(1)"), "![pic](https://x.org/p.png)", "an unsafe link is dropped");
  assert.equal(c.pastedWebAddress("mailto:a@b.org"), null);
  assert.ok(c.pastedWebAddress(" https://x.org/p.png "));
  for (const [id] of c.CODE_LANGS) assert.ok(id === "" || c.codeLangKey(id), "every listed language is highlighted: " + id);
  assert.equal(c.insertCodeBlock("x", 0, 1, "py").text, "```py\nx\n```");
  const note = c.insertCallout("hello", 0, 5, "note");
  assert.equal(note.text, "> [!NOTE]\n> hello");
  assert.equal(c.insertCallout("a\nb", 0, 3, "warning").text, "> [!WARNING]\n> a\n> b");
  assert.equal(c.insertCallout("", 0, 0, "tip").text, "> [!TIP]\n> ");
  const swap = c.insertCallout("> [!NOTE]\n> hi", 3, 3, "caution");
  assert.equal("> [!NOTE]\n> hi".slice(0, swap.start) + swap.text + "> [!NOTE]\n> hi".slice(swap.end), "> [!CAUTION]\n> hi", "only the kind changes");
  assert.equal(c.insertCallout("x", 0, 1, "nonsense").text.split("\n")[0], "> [!NOTE]");
  for (const [kind] of c.CALLOUT_KINDS) {
    const [q] = c.parseBlocks(c.insertCallout("body", 0, 4, kind).text);
    assert.equal(q.callout.kind, kind);
    assert.ok(c.SHORTCUT_ACTIONS.some((s) => s.id === c.calloutId(kind) && s.edit), "shortcut action for " + kind);
  }
  assert.equal(c.SHORTCUT_ACTIONS.find((s) => s.id === "calloutNote").def, "Ctrl+Shift+2");
  assert.equal(c.SHORTCUT_ACTIONS.find((s) => s.id === "calloutWarning").def, "Ctrl+Shift+3");
  const hidden = c.parseHidden("bold, nonsense;calloutInfo sup");
  assert.equal(c.serializeHidden(hidden), "bold,calloutInfo,sup");
  assert.ok(!c.parseHidden("settings").size, "Quick settings can never be hidden");
  for (const [id] of c.HIDEABLE_TOOLS) assert.ok(c.SHORTCUT_ACTIONS.some((s) => s.id === id), "hideable id is a real action: " + id);
});

const flat = (nodes) => nodes.map((n) => n.s ?? flat(n.c || [])).join("");
const tex = (src) => c.texNodes(src);

test("details: summary, markdown body, open flag, nesting, export", () => {
  const [d] = c.parseBlocks("<details>\n<summary>More **info**</summary>\n\nBody *text*\n\n- a\n- b\n\n</details>");
  assert.equal(d.type, "details");
  assert.equal(d.open, false);
  assert.equal(flat(d.summary), "More info");
  same(d.blocks.map((b) => b.type), ["p", "list"]);
  assert.equal(c.parseBlocks("<details open>\n<summary>x</summary>\ny\n</details>")[0].open, true);
  const [o] = c.parseBlocks("<details>\n<summary>outer</summary>\n<details>\n<summary>inner</summary>\ndeep\n</details>\nafter\n</details>\n\nnext");
  assert.equal(o.blocks[0].type, "details");
  assert.equal(flat(o.blocks[0].summary), "inner");
  assert.equal(flat(o.blocks[1].c), "after");
  const one = c.parseBlocks("<details><summary>s</summary>text</details>")[0];
  assert.equal(flat(one.summary), "s");
  assert.equal(flat(one.blocks[0].c), "text");
  assert.equal(c.parseBlocks("<details>\ntext")[0].type, "p", "no closing tag: stays text");
  assert.equal(c.parseBlocks("<details>\nx\n</details>")[0].summary.length, 0, "summary is optional");
  const html = c.exportHtml("<details>\n<summary>Sum</summary>\n\n<script>alert(1)</script>\n</details>");
  assert.ok(html.includes("<details>") && html.includes("<summary>Sum</summary>"));
  assert.ok(!html.includes("<script>alert"), "other tags are escaped, never passed through");
  assert.ok(c.exportText("<details>\n<summary>Sum</summary>\n\nBody\n</details>").includes("Sum\n\nBody"));
});

test("details: the paragraph before it ends and the blocks after it continue", () => {
  same(c.parseBlocks("before\n<details>\n<summary>s</summary>\nx\n</details>\nafter").map((b) => b.type), ["p", "details", "p"]);
});

test("math: LaTeX subset becomes text + sup/sub, unknown commands stay visible", () => {
  assert.equal(flat(tex("\\alpha + \\beta \\leq \\infty")), "α + β ≤ ∞");
  same(tex("x^2").map((n) => n.t), ["text", "sup"]);
  assert.equal(tex("x_{i+1}^{10}").map((n) => n.t).join(","), "text,sub,sup");
  assert.equal(flat(tex("\\frac{a}{b}")), "a/b");
  assert.equal(flat(tex("\\frac{a+b}{c}")), "(a+b)/c");
  assert.equal(flat(tex("\\sqrt{x}")), "√x");
  assert.equal(flat(tex("\\sqrt{x+1}")), "√(x+1)");
  assert.equal(flat(tex("\\mathbb{R}^n")), "ℝn");
  assert.equal(flat(tex("\\sum_{i=1}^{n} i")), "∑i=1n i");
  assert.equal(flat(tex("\\sin\\theta \\times \\text{ cm}")), "sinθ ×  cm");
  assert.equal(flat(tex("\\hat{x}")), "x\u0302");
  assert.equal(flat(tex("\\unknowncmd{x}")), "\\unknowncmd" + "x");
  assert.equal(flat(tex("a \\{ b \\}")), "a { b }");
  assert.equal(typeof flat(tex("}{ ^")), "string", "stray braces and carets do not throw");
  const deep = "{".repeat(50) + "x" + "}".repeat(50);
  assert.equal(flat(tex(deep)).includes("x"), true, "deep nesting is capped, not a hang");
  assert.ok(tex("x".repeat(5000)).length >= 1, "oversized input stays text");
});

test("math: $...$ inline and $$ block, prices are not math", () => {
  assert.equal(c.parseInline("area $\\pi r^2$ ok").some((n) => n.t === "math"), true);
  assert.equal(c.parseInline("costs $5 and $10 today").some((n) => n.t === "math"), false);
  assert.equal(c.parseInline("$5-$6").some((n) => n.t === "math"), false);
  assert.equal(c.parseInline("a $ b $ c").some((n) => n.t === "math"), false, "spaces inside: not math");
  assert.equal(c.parseInline("\\$x\\$").some((n) => n.t === "math"), false, "escaped dollars");
  assert.equal(flat(c.parseInline("\\$x\\$")), "$x$");
  assert.equal(flat(c.parseInline("**$\\alpha$**")), "α", "math inside bold");
  assert.equal(flat(c.parseInline("`$x$`")), "$x$", "code wins");
  const [m] = c.parseBlocks("$$\n\\frac{a}{b}\n$$");
  assert.equal(m.type, "math");
  assert.equal(flat(m.c), "a/b");
  assert.equal(c.parseBlocks("$$ E = mc^2 $$")[0].type, "math");
  assert.equal(c.parseBlocks("$$\nunclosed")[0].type, "p", "unclosed block stays text");
  assert.ok(c.exportHtml("$$ x^2 $$").includes('class="math-block"'));
  assert.equal(c.exportText("$$ \\alpha $$").trim(), "α");
});

console.log(`\n${passed} markdown tests passed`);
