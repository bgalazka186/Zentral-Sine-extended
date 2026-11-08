"use strict";
/* Markdown flavor modes (docs/MARKDOWN_FLAVORS.md), the typing shortcuts and the parser rules that hang on them.
 * One case per feature id of the table. Pure functions only: nothing here proves how a note LOOKS inside Zen. */
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const flavors = require(path.join(root, "additional/notes/flavors/ZentralNotesFlavors.js"));
const shortcuts = require(path.join(root, "additional/notes/flavors/ZentralNotesShortcuts.js"));
const source = fs.readFileSync(path.join(root, "additional/notes/ZentralNotes.uc.js"), "utf8");
const seam = {};
const win = { __zentralNotesTestSeam: seam, __zentralNotesParts: { "notes-flavors": flavors, "notes-shortcuts": shortcuts }, ZentralRuntime: { register() {} } };
win.window = win;
vm.runInNewContext(source, { window: win, globalThis: { Services: {} }, ChromeUtils: {}, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, console });
const c = seam.core;
let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok -", name);
}
const flat = (nodes) => nodes.map((n) => n.s ?? flat(n.c || [])).join("");
const blocks = (t, o) => JSON.parse(JSON.stringify(c.parseBlocks(t, false, o || {})));
const inl = (t, o) => blocks(t, o)[0].c;
const types = (nodes) => nodes.map((n) => n.t);
const deep = (nodes, t) => nodes.some((n) => n.t === t || deep(n.c || [], t));

test("modes: seven of them, junk falls back to mixed, the doc table and the data block agree", () => {
  assert.deepEqual([...flavors.MODES], ["mixed", "mixed+obsidian", "mixed+github", "mixed+reddit", "obsidian", "github", "reddit"]);
  assert.equal(flavors.cleanMode("nonsense"), "mixed");
  assert.ok(Object.keys(flavors.FEATURES).length >= 236, "every row of the doc is in the data block");
  assert.equal(require("node:child_process").spawnSync(process.execPath, [path.join(root, "tools/build-flavors-data.cjs"), "--check"]).status, 0);
});

test("modes: PICK rows follow the chosen flavor, plugin-only syntax is off in the only modes", () => {
  const on = (m, id, o) => flavors.gate(m, o).on(id);
  assert.equal(on("mixed", "A09"), false);
  assert.equal(on("mixed+github", "A09"), true);
  assert.equal(on("mixed+github", "A13"), false);
  assert.equal(on("mixed", "A13"), true);
  assert.equal(on("mixed", "A09", { tilde: "strike" }), true, "the setting flips ~a~ to strike");
  assert.equal(on("mixed", "A13", { tilde: "strike" }), false);
  assert.equal(on("mixed+reddit", "A17"), true);
  assert.equal(on("mixed+reddit", "A15"), false, "X^2^ and ^word cannot both be superscript");
  assert.equal(on("mixed", "A27"), true);
  assert.equal(on("obsidian", "A13"), false, "needs a plugin in Obsidian");
  assert.equal(on("obsidian", "A10"), true);
  assert.equal(on("github", "A10"), false);
  assert.equal(on("reddit", "E08"), false);
  assert.equal(on("github", "L07"), true, "our own date recognition stays on");
  assert.equal(on("mixed", "Z99"), true, "an id that is not in the table is never gated");
  assert.equal(flavors.enabledIds("reddit").length < flavors.enabledIds("github").length, true);
  assert.equal(flavors.enabledIds("github").length < flavors.enabledIds("mixed").length, true);
});

test("A05 a*b*c is italic inside a word", () => assert.ok(types(inl("a*b*c")).includes("i")));
test("A09/A13 one tilde: subscript by default, strike with the setting or in a GitHub mode", () => {
  assert.ok(deep(inl("H~2~O"), "sub"));
  assert.ok(deep(inl("~a~", { tilde: "strike" }), "s"));
  assert.ok(deep(inl("~a~", { flavor: "mixed+github" }), "s"));
  assert.ok(deep(inl("~a~", { flavor: "github" }), "s"));
  assert.equal(deep(inl("~a~", { flavor: "obsidian" }), "sub") || deep(inl("~a~", { flavor: "obsidian" }), "s"), false, "literal in Obsidian");
});
test("A10/A11 highlight is not read by the GitHub and Reddit only modes", () => {
  assert.ok(deep(inl("==a=="), "hl"));
  assert.equal(deep(inl("==a==", { flavor: "github" }), "hl"), false);
  assert.equal(flat(inl("==a==", { flavor: "reddit" })), "==a==");
});
test("A17 Reddit superscript only in the Reddit modes", () => {
  assert.equal(deep(inl("a^(b c) d^e"), "sup"), false);
  const n = inl("a^(b c) d^e", { flavor: "mixed+reddit" });
  assert.equal(n.filter((x) => x.t === "sup").length, 2);
  assert.equal(flat(inl("a^(b c)", { flavor: "reddit" })), "ab c");
});
test("A19/A20/A25/A26 <ins>, ++a++, and presentational tags keep their text", () => {
  assert.ok(deep(inl("<ins>x</ins>"), "u"));
  assert.ok(deep(inl("++x++"), "u"));
  assert.equal(flat(inl('a <span style="color:red">b</span> <abbr title="t">c</abbr> <big>d</big>')), "a b c d");
  assert.equal(flat(inl("a <small>b</small>")), "a b");
});
test("A27/A29 spoilers: >!a!< and ||a||, not at the start of a line, not in the GitHub modes", () => {
  assert.ok(deep(inl("x >!secret!< y"), "spoiler"));
  assert.ok(deep(inl("x ||secret|| y"), "spoiler"));
  assert.equal(deep(inl("x >!secret!< y", { flavor: "github" }), "spoiler"), false);
  assert.equal(blocks(">!not a spoiler")[0].type, "quote");
  assert.equal(deep(inl("x ||| y"), "spoiler"), false);
});
test("A31/A32 comments are in the file, not on the screen; an unclosed %% is text", () => {
  assert.equal(flat(inl("a %%hidden%% b <!-- also hidden --> c")), "a  b  c");
  assert.equal(flat(inl("100%% sure")), "100%% sure");
  assert.equal(flat(inl("a %%x%% b", { flavor: "github" })), "a %%x%% b");
});
test("B03/B04 links with <angle brackets> and parentheses in the address", () => {
  const a = inl("[w](https://x.y/a_(b)) and [n](<my note.md>)");
  assert.equal(a[0].href, "https://x.y/a_(b)");
  assert.equal(a.find((x) => x.t === "nl").id, "my note");
  assert.equal(inl("[w](<https://x.y/a b>)")[0].href, "https://x.y/a%20b");
});
test("B09/B18 shortcut reference and image reference, only with a definition", () => {
  assert.equal(inl("see [a]\n\n[a]: https://x.y")[0].t, "text");
  const b = blocks("see [a] now\n\n[a]: https://x.y");
  assert.ok(types(b[0].c).includes("a"));
  assert.equal(flat(inl("see [nothing here] now")), "see [nothing here] now");
  const i = blocks("![pic][p]\n\n[p]: https://x.y/i.png");
  assert.equal(i[0].c[0].t, "img");
});
test("B12 www. links; B17 image size; text after a dot is not in the link", () => {
  const a = inl("go www.example.com.");
  assert.equal(a[1].href, "https://www.example.com/");
  assert.equal(a[2].s, ".");
  const img = inl("![pic|100](https://x.y/a.png)")[0];
  assert.equal(img.alt, "pic");
  assert.equal(img.width, 100);
  assert.equal(inl("![pic|100x50](https://x.y/a.png)")[0].width, 100);
});
test("C01 note links by [[ ]] are not read in the Reddit only mode; C14 #tag; D02 #a heading is Reddit only", () => {
  assert.equal(flavors.gate("reddit").on("C01"), false);
  assert.equal(flavors.gate("obsidian").on("C01"), true);
  assert.ok(types(inl("work #project-x now")).includes("tag"));
  assert.equal(types(inl("issue #123 and C# and a#b")).includes("tag"), false);
  assert.equal(blocks("#a")[0].type, "p");
  assert.equal(blocks("#a", { flavor: "reddit" })[0].type, "h");
  assert.equal(blocks("#a", { flavor: "mixed+reddit" })[0].type, "h");
  assert.equal(blocks("# real", { flavor: "reddit" })[0].type, "h");
});
test("D03 closing hashes are dropped, C# stays", () => {
  assert.equal(flat(blocks("## Title ##")[0].c), "Title");
  assert.equal(flat(blocks("# C#")[0].c), "C#");
  assert.equal(flat(blocks("# a #")[0].c), "a");
});
test("E08/E09/E10 tasks and states by mode; E12 [ ] without a marker; E19 pasted bullets", () => {
  const it = (t, o) => blocks(t, o)[0].items[0];
  assert.equal(it("- [>] a").status, ">");
  assert.equal(it("- [I] a").status, "I");
  assert.equal(it("- [-] a", { flavor: "github" }).checked, null, "four extra states are not GitHub");
  assert.equal(flat(it("- [-] a", { flavor: "github" }).c), "[-] a");
  assert.equal(it("- [x] a", { flavor: "github" }).checked, true);
  assert.equal(it("- [x] a", { flavor: "reddit" }).checked, null);
  assert.equal(it("[ ] a").checked, false);
  assert.equal(it("[x] a").checked, true);
  assert.equal(it("• a").marker, "\u2022");
  assert.equal(blocks("• a\n• b")[0].items.length, 2);
  assert.equal(blocks("```\n• a\n[ ] b\n```")[0].type, "code", "code is never rewritten");
});
test("F05-F20 callout kinds and aliases; F22 fold; F24 unknown kind", () => {
  const kind = (t, o) => blocks("> [!" + t + "]\n> x", o)[0].callout;
  for (const [alias, want] of [["summary", "abstract"], ["tldr", "abstract"], ["done", "success"], ["check", "success"], ["help", "question"], ["faq", "question"], ["fail", "failure"], ["missing", "failure"], ["error", "danger"], ["cite", "quote"], ["hint", "tip"], ["attention", "warning"], ["todo", "todo"], ["bug", "bug"], ["example", "example"]]) {
    assert.equal(kind(alias).kind, want, alias);
  }
  assert.equal(kind("NOTE").title, "");
  assert.equal(kind("summary").title, "Summary");
  assert.deepEqual(kind("bingo"), { kind: "note", title: "Bingo" });
  const f = blocks("> [!tip]- Closed one\n> hidden")[0].callout;
  assert.equal(f.fold, "closed");
  assert.equal(f.title, "Closed one");
  assert.equal(blocks("> [!tip]+ Open\n> shown")[0].callout.fold, "open");
  assert.equal(kind("info", { flavor: "github" }), undefined, "GitHub has five alerts only");
  assert.equal(kind("warning", { flavor: "github" }).kind, "warning");
  assert.equal(kind("note", { flavor: "reddit" }), undefined);
  assert.equal(kind("bingo", { flavor: "github" }), undefined);
  assert.equal(kind("bingo", { flavor: "obsidian" }).kind, "note");
});
test("G02/G03/G04 fences: four backticks, tildes, extras after the language; G05 indented code is Reddit only", () => {
  assert.deepEqual(blocks("````md\n```js\nx\n```\n````")[0], { type: "code", text: "```js\nx\n```", lang: "md" });
  assert.deepEqual(blocks("~~~py\nx\n~~~")[0], { type: "code", text: "x", lang: "py" });
  assert.deepEqual(blocks('```js title="a" {1,3}\nx\n```')[0], { type: "code", text: "x", lang: "js" });
  assert.equal(blocks("~~~py\nx\n~~~", { flavor: "reddit" })[0].type, "p");
  assert.equal(blocks("text\n\n    indented")[0].type, "p");
  const r = blocks("text\n\n    one\n    two", { flavor: "reddit" });
  assert.deepEqual(r[1], { type: "code", text: "one\ntwo" });
});
test("G08 math fence; unsupported diagram fences get an error callout and stay readable as code", () => {
  assert.equal(blocks("```math\nx^2\n```")[0].type, "math");
  const b = blocks("```mermaid\ngraph TD\n```");
  assert.equal(b[0].callout.kind, "danger");
  assert.equal(b[0].callout.title, "Mermaid is not supported");
  assert.deepEqual(b[1], { type: "code", text: "graph TD", lang: "mermaid" });
});
test("I03/I04/I05 math written the ChatGPT way", () => {
  assert.ok(deep(inl("a $$x^2$$ b"), "math"));
  assert.ok(deep(inl("so \\(x^2\\) holds"), "math"));
  assert.equal(flat(inl("costs $5 and $10")), "costs $5 and $10");
  assert.equal(blocks("\\[ x^2 \\]")[0].type, "math");
  assert.equal(blocks("\\[\nx^2\n\\]")[0].type, "math");
  assert.equal(deep(inl("a \\(x\\) b", { flavor: "reddit" }), "math"), false);
});
test("J09/J13 backslash line break and HTML entities", () => {
  assert.deepEqual(types(inl("a\\\nb", { joinLines: true })), ["text", "br", "text"]);
  assert.equal(flat(inl("a\\\\")), "a\\");
  assert.equal(flat(inl("Tom &amp; Jerry &copy; &#169; &#x41; &nbsp;x &unknown;")), "Tom & Jerry © © A \u00a0x &unknown;");
  assert.equal(flat(inl("`&amp;`")), "&amp;");
});
test("L04/L05/L07 u/name, :emoji:, dates", () => {
  assert.equal(deep(inl("see r/zen"), "a"), false);
  assert.equal(inl("see r/zen and /u/bob", { flavor: "mixed+reddit" }).filter((x) => x.t === "a").length, 2);
  assert.equal(flat(inl("go :rocket: :+1: and :notanemoji: at 10:30:45")), "go 🚀 👍 and :notanemoji: at 10:30:45");
  const d = inl("due 2026-11-07 14:30 ok")[1];
  assert.deepEqual({ t: d.t, ymd: d.ymd, time: d.time }, { t: "date", ymd: "2026-11-07", time: "14:30" });
  assert.equal(inl("on 2026-11-07.")[1].ymd, "2026-11-07");
  assert.equal(types(inl("2026-13-45 and 1234-56-789 and v2026-11-07")).includes("date"), false);
  assert.equal(inl("x 2026-11-07", { flavor: "github" })[1].t, "date");
});
test("ignore syntax: a literal piece is shown as typed, a rule id switches the rule off", () => {
  assert.equal(blocks("> [!info] hi", { ignore: ">[!info]" })[0].type, "p");
  assert.equal(flat(blocks("> [!info] hi", { ignore: ">[!info]" })[0].c), "> [!info] hi");
  assert.equal(flat(inl("a <mark>b</mark>", { ignore: "<mark>" })), "a <mark>b</mark>");
  assert.equal(flat(inl("a ==b==", { ignore: "A10" })), "a ==b==");
  assert.equal(deep(inl("a **b** ==c==", { ignore: "A10" }), "b"), true, "other rules keep working");
  assert.equal(flat(inl("`<mark>`", { ignore: "<mark>" })), "<mark>", "code is not touched");
  const p = flavors.parseIgnore(">[!info], A10 == <mark>");
  assert.deepEqual([...p.ids], ["A10"]);
  assert.deepEqual(p.literals, [">[!info]", "<mark>", "=="]);
  assert.equal(c.parseBlocks("a", false, { ignore: "" }).length, 1);
});
test("per-note mode: `flavor:` in the front matter round-trips; junk is dropped", () => {
  const n = c.noteFromFile("n1", "---\nid: n1\ncreated: 2026-01-01T00:00:00.000Z\nupdated: 2026-01-01T00:00:00.000Z\nflavor: github\n---\n==a==", 0);
  assert.equal(n.flavor, "github");
  assert.ok(c.serializeNote(n).includes("\nflavor: github\n"));
  assert.equal(c.noteFromFile("n2", "---\nid: n2\nflavor: nonsense\n---\nx", 0).flavor, "");
  assert.equal(c.serializeNote({ ...n, flavor: "" }).includes("flavor:"), false);
});
test("E05/E07 nested lists by any indent of two or more spaces, a tab included", () => {
  const lv = (t) => blocks(t)[0].items.map((i) => i.level);
  assert.deepEqual(lv("- a\n    - b\n        - c\n- d"), [0, 1, 2, 0]);
  assert.deepEqual(lv("- a\n  - b\n    - c\n  - d"), [0, 1, 2, 1]);
  assert.deepEqual(lv("1. a\n    1. b\n2. c"), [0, 1, 0]);
  assert.deepEqual(lv("- a\n\t- b"), [0, 1]);
  assert.deepEqual(lv("- a\n - b"), [0, 0], "one space is not a new level");
});
test("G07 diff colours, O01 -# small print, O04 ::: containers", () => {
  const b = blocks("```diff\n@@ -1 +1 @@\n-old\n+new\n same\n```")[0];
  assert.equal(b.lang, "diff");
  assert.deepEqual(JSON.parse(JSON.stringify(c.highlightCode(b.text, "diff"))), [{ k: "com", s: "@@ -1 +1 @@\n" }, { k: "del", s: "-old\n" }, { k: "add", s: "+new\n" }, { k: "", s: " same" }]);
  assert.equal(blocks("-# tiny")[0].c[0].t, "small");
  assert.equal(blocks("- # not small")[0].type, "list");
  const w = blocks("::: warning Careful\nbody\n:::")[0];
  assert.deepEqual([w.callout.kind, w.callout.title, w.blocks[0].c[0].s], ["warning", "Careful", "body"]);
  assert.equal(blocks("::: details More\nhidden\n:::")[0].callout.fold, "closed");
  assert.equal(blocks(":::\nplain\n:::")[0].type, "p");
  assert.equal(blocks("-# tiny", { flavor: "github" })[0].c[0].t, "text");
});
test("the old behaviour is the default: no opts means mixed", () => {
  assert.ok(deep(inl("==a== H~2~O"), "hl"));
  assert.equal(blocks("> [!NOTE]\n> a")[0].callout.kind, "note");
  assert.equal(c.flavorGate("mixed").on("A10"), true);
});

// ---- typing shortcuts ---------------------------------------------------------------------------------------------
const NOW = new Date(2026, 10, 7, 14, 5, 9).getTime(); // Saturday 7 November 2026
const typed = (value, ch, extra = {}, families) => shortcuts.expandTyped(value, value.length, ch, { now: NOW, title: "My note", ...extra }, families);
test("shortcuts: {{date}} {{time}} {{title}} and formats expand when the closing braces are typed", () => {
  assert.equal(typed("a {{date}}", "}").text, "2026-11-07");
  assert.equal(typed("{{time}}", "}").text, "14:05");
  assert.equal(typed("{{title}}", "}").text, "My note");
  assert.equal(typed("{{date:DD.MM.YYYY}}", "}").text, "07.11.2026");
  assert.equal(typed("{{ time : hh:mm A }}", "}").text, "02:05 PM");
  assert.equal(typed("{{datetime}}", "}").text, "2026-11-07 14:05");
  assert.equal(typed("{{tomorrow}}", "}").text, "2026-11-08");
  assert.equal(typed("{{weekday}}", "}").text, "Saturday");
  assert.equal(typed("{{date}}", "}", { dateFormat: "D MMM YYYY" }).text, "7 Nov 2026");
  const e = typed("x {{date}}", "}");
  assert.deepEqual([e.start, e.end], [2, 10]);
  assert.equal(typed("{{nonsense}}", "}"), null);
  assert.equal(typed("{{date}}", "x"), null, "only the closing brace triggers it");
});
test("shortcuts: @today, /tomorrow, @+3d, @monday expand on Space or Enter, only as a whole word", () => {
  assert.equal(typed("see @today ", " ").text, "2026-11-07");
  assert.equal(typed("@now\n", "\n").text, "2026-11-07 14:05");
  assert.equal(typed("/tomorrow ", " ").text, "2026-11-08");
  assert.equal(typed("/yesterday ", " ").text, "2026-11-06");
  assert.equal(typed("go @+3d ", " ").text, "2026-11-10");
  assert.equal(typed("go @-1w ", " ").text, "2026-10-31");
  assert.equal(typed("go @+1m ", " ").text, "2026-12-07");
  assert.equal(typed("meet @monday ", " ").text, "2026-11-09");
  assert.equal(typed("meet @sat ", " ").text, "2026-11-14", "never today: the next one");
  const e = typed("see @today ", " ");
  assert.deepEqual([e.start, e.end, e.selStart], [4, 10, 15]);
  assert.equal(typed("me@today ", " "), null, "an e-mail address is not a shortcut");
  assert.equal(typed("https://a.com/today ", " "), null);
  assert.equal(typed("a/today ", " "), null);
  assert.equal(typed("@todays ", " "), null);
});
test("shortcuts: never in code, off and braces-only settings, formatDate tokens", () => {
  assert.equal(typed("`@today ", " "), null);
  assert.equal(typed("```\n@today ", " "), null);
  assert.equal(typed("```\ncode\n```\n@today ", " ").text, "2026-11-07");
  assert.equal(typed("{{date}}", "}", {}, "off"), null);
  assert.equal(typed("@today ", " ", {}, "braces"), null);
  assert.equal(typed("{{date}}", "}", {}, "braces").text, "2026-11-07");
  assert.equal(shortcuts.formatDate(NOW, "dddd, D MMMM YYYY [at] HH:mm"), "Saturday, 7 November 2026 at 14:05");
  assert.equal(shortcuts.formatDate(NOW, "YY/M/D h:m:s a"), "26/11/7 2:5:9 pm");
  assert.ok(shortcuts.SHORTCUTS.length >= 10);
});
test("GUI: every callout kind of the toolbar menu is read back as itself, and the new insert actions are real actions", () => {
  for (const [kind] of c.CALLOUT_KINDS) {
    const q = blocks(c.insertCallout("body", 0, 4, kind).text)[0];
    assert.equal(q.callout.kind, kind, "callout " + kind);
  }
  const ids = new Set(c.SHORTCUT_ACTIONS.map((a) => a.id));
  for (const id of ["underline", "spoiler", "comment", "mathInline", "mathBlock", "details", "insertDate", "insertTime", "outline"]) {
    assert.ok(ids.has(id), id + " is an action");
    assert.ok(c.HIDEABLE_TOOLS.some((t) => t[0] === id), id + " can be hidden");
  }
  // What the entries write is read by the parser of the same mode.
  assert.ok(deep(inl("a ||secret|| b"), "spoiler"), "spoiler");
  assert.ok(!flat(inl("a %%hidden%% b")).includes("hidden"), "hidden comment");
  assert.ok(deep(inl("a <u>x</u> b"), "u"), "underline");
  assert.ok(deep(inl("a $x^2$ b"), "math"), "inline math");
  assert.equal(blocks("$$\nx^2\n$$")[0].type, "math", "math block");
  assert.equal(blocks("<details>\n<summary>Title</summary>\n\ntext\n\n</details>")[0].type, "details", "collapsible section");
});

test("GUI: foldable callouts and the extra task states can be made from the toolbar", () => {
  assert.equal(c.insertCallout("body", 0, 4, "note", "-").text, "> [!NOTE]-\n> body");
  assert.equal(c.insertCallout("body", 0, 4, "tip", "+").text, "> [!TIP]+\n> body");
  assert.equal(c.insertCallout("> [!NOTE]-\n> hi", 3, 3, "tip").text, "> [!TIP]-", "a kind change keeps the fold (only the first line is replaced)");
  assert.equal(c.insertCallout("> [!NOTE]-\n> hi", 3, 3, "note", "+").text, "> [!NOTE]+", "a fold request replaces the fold");
  assert.equal(c.setTaskStatus("- [ ] a", 0, 0, ">").text, "- [>] a");
  assert.equal(c.setTaskStatus("- [>] a", 0, 0, "x").text, "- [x] a", "an extended state can be left again");
  assert.equal(c.setTaskStatus("- [ ] a", 0, 7, "Z").text, "- [ ] a", "unknown states are refused");
  assert.ok(c.TASK_PICKER.length >= 19, "classic six plus the Obsidian set");
});

test("demo notes: the flavors showcase is read as callouts, math, details and a table", () => {
  const showcase = c.DEMO_NOTES.find((d) => d.id === "zn-demo-flavors");
  const bl = blocks(showcase.body);
  assert.ok(bl.filter((b) => b.type === "callout" || b.callout).length >= 3, "callouts are read");
  assert.ok(bl.some((b) => b.type === "math") && bl.some((b) => b.type === "details") && bl.some((b) => b.type === "table"), "math, details and table blocks");
});

console.log(`\n${passed} flavor tests passed`);
