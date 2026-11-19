"use strict";
/* T1.4: pasted HTML from web pages and AI chats becomes clean Markdown. Pure converter + the editor's richPaste gate.
 * Nothing here proves what the clipboard really holds in Zen; it proves the conversion rules and the safety filter. */
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const paste = require(path.join(root, "additional/notes/paste/ZentralNotesPasteHtml.js"));
const flavors = require(path.join(root, "additional/notes/flavors/ZentralNotesFlavors.js"));
const shortcuts = require(path.join(root, "additional/notes/flavors/ZentralNotesShortcuts.js"));
const source = fs.readFileSync(path.join(root, "additional/notes/ZentralNotes.uc.js"), "utf8");
const seam = {};
const win = { __zentralNotesTestSeam: seam, __zentralNotesParts: { "notes-flavors": flavors, "notes-shortcuts": shortcuts, "notes-paste-html": paste }, ZentralRuntime: { register() {} } };
win.window = win;
vm.runInNewContext(source, { window: win, globalThis: { Services: {} }, ChromeUtils: {}, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, console });
const c = seam.core;
let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok -", name);
}
const md = (h) => paste.htmlToMarkdown(h)?.markdown ?? null;
const blocks = (t) => JSON.parse(JSON.stringify(c.parseBlocks(t, false, {})));
const types = (nodes) => nodes.map((n) => n.type || n.t);

test("headings, paragraphs, emphasis, strike, mark, inline code, links with title", () => {
  assert.equal(md("<h2>Title</h2><p>a <b>bold</b> <i>it</i> <del>x</del> <mark>m</mark> <code>c</code> <a href=\"https://x.org/p\" title=\"T\">link</a></p>"),
    '## Title\n\na **bold** *it* ~~x~~ ==m== `c` [link](https://x.org/p "T")');
  assert.equal(md("<p><strong> padded </strong>text</p>"), " **padded** text".trim());
  assert.equal(md("<p><b><strong>once</strong></b> <em><i>x</i></em></p>"), "**once** *x*");
  assert.equal(md("<p>a<br>b</p>"), "a  \nb");
});

test("inline code survives backticks; code block fence grows; language from class; chat toolbar text is dropped", () => {
  assert.equal(md("<p><code>a`b</code></p>"), "``a`b``");
  assert.equal(md("<p><code>`x`</code></p>"), "`` `x` ``");
  const out = md('<pre><div class="bar">Copy code</div><code class="hljs language-js">const a = `x`;\n```\n</code></pre>');
  assert.equal(out, "````js\nconst a = `x`;\n```\n````");
  assert.equal(md("<pre>plain\n  indented</pre>"), "```\nplain\n  indented\n```");
  assert.equal(md('<pre><code class="language-text">t</code></pre>'), "```\nt\n```");
});

test("lists: nesting, ordered start, task boxes, tight and loose", () => {
  assert.equal(md("<ul><li>one<ul><li>deep</li></ul></li><li>two</li></ul>"), "- one\n  - deep\n- two");
  assert.equal(md("<ol start=3><li>a<li>b</ol>"), "3. a\n4. b");
  assert.equal(md('<ul><li><input type="checkbox" checked disabled> done</li><li><input type="checkbox"> todo</li></ul>'), "- [x] done\n- [ ] todo");
  assert.equal(md("<ul><li><p>p1</p><p>p2</p></li><li><p>q</p></li></ul>"), "- p1\n\n  p2\n\n- q");
  assert.equal(md("<ul><li>a</li></ul><ol><li>b</li></ol>"), "- a\n\n1. b");
});

test("tables: header row, alignment row, cell <br>, pipes escaped, colspan, caps", () => {
  assert.equal(md("<table><thead><tr><th>A</th><th>B|c</th></tr></thead><tbody><tr><td>1<br>2</td><td><code>x</code></td></tr></tbody></table>"),
    "| A | B\\|c |\n| --- | --- |\n| 1<br>2 | `x` |");
  assert.equal(md("<table><tr><td>a</td><td>b</td></tr></table>"), "|   |   |\n| --- | --- |\n| a | b |");
  assert.equal(md('<table><tr><th colspan=2>H</th></tr><tr><td>1</td><td>2</td></tr></table>'), "| H |   |\n| --- | --- |\n| 1 | 2 |");
  const wide = "<table><tr>" + Array.from({ length: 20 }, (_, i) => "<th>c" + i + "</th>").join("") + "</tr></table>";
  const r = paste.htmlToMarkdown(wide);
  assert.equal(r.lossy, true);
  assert.equal(r.markdown.split("\n")[0].split("|").length - 2, 12);
  const tall = "<table>" + Array.from({ length: 260 }, (_, i) => "<tr><td>r" + i + "</td></tr>").join("") + "</table>";
  const t = paste.htmlToMarkdown(tall);
  assert.equal(t.lossy, true);
  assert.ok(t.markdown.split("\n").length <= 203);
});

test("blockquote, rule, details/summary, kbd, sub/sup, definition lists", () => {
  assert.equal(md("<blockquote><p>q</p><p>r</p></blockquote>"), "> q\n>\n> r");
  assert.equal(md("<p>a</p><hr><p>b</p>"), "a\n\n---\n\nb");
  assert.equal(md("<details open><summary>Sum</summary><p>Body</p></details>"), "<details open>\n<summary>Sum</summary>\n\nBody\n\n</details>");
  assert.equal(md("<p>Press <kbd>Ctrl</kbd>+<kbd>&lt;</kbd></p>"), "Press <kbd>Ctrl</kbd>+<kbd>&lt;</kbd>");
  assert.equal(md("<p>H<sub>2</sub>O x<sup>2</sup> y<sup>a b</sup></p>"), "H~2~O x^2^ y a b");
  assert.equal(md("<dl><dt>Term</dt><dd>Meaning</dd></dl>"), "**Term**\n\nMeaning");
});

test("text that looks like Markdown is escaped, line-start markers too", () => {
  assert.equal(md("<p>2 * 3 = 6, a_b, _x_, [x], ~y~, ^z^, ==w==</p>"), "2 \\* 3 = 6, a_b, \\_x\\_, \\[x\\], \\~y\\~, \\^z\\^, \\=\\=w\\=\\=");
  assert.equal(md("<p># not heading</p><p>- not list</p><p>1. not ordered</p><p>&gt; not quote</p><p>---</p>"), "\\# not heading\n\n\\- not list\n\n1\\. not ordered\n\n\\> not quote\n\n\\---");
  assert.equal(md("<p>cost $5 and $6</p>"), "cost \\$5 and \\$6");
  assert.equal(md("<p>cost $5 only</p>"), "cost $5 only");
  assert.equal(md("<p>a &lt;b&gt; &lt;/i&gt; 1 &lt; 2</p>"), "a \\<b> \\</i> 1 < 2");
  assert.equal(md("<p>x || y</p>"), "x \\|\\| y");
});

test("entities and whitespace: named, numeric, nbsp, zero-width, collapsed runs", () => {
  assert.equal(md("<p>Tom &amp; Jerry &mdash; &#8364;5 &#x41; &bogus; &nbsp;x\u200b\n\n   y</p>"), "Tom & Jerry — €5 A &bogus;  x y".replace("  x", " x"));
  assert.equal(md("<p>&#0; &#1114112; &#xD800; ok</p>"), "ok".replace("ok", " ok").trim());
});

test("images and links keep only safe addresses", () => {
  assert.equal(md('<p><img src="https://a.org/i.png" alt="pic [1]" title="t"></p>'), '![pic 1](https://a.org/i.png "t")');
  assert.equal(md('<p><img src="javascript:alert(1)" alt="no"> <img src="data:image/png;base64,AAAA" alt="d"> <img src="//cdn/x.png" alt="rel"></p>'), "no d rel");
  assert.equal(md('<p><a href="javascript:alert(1)">bad</a> <a href=" JaVaScRiPt:x">bad2</a> <a href="/relative">rel</a> <a href="mailto:me@x.org">mail</a> <a href="https://x.org/a b">sp</a></p>'),
    "bad bad2 rel [mail](mailto:me@x.org) [sp](https://x.org/ab)");
  assert.equal(md('<p><a href="https://x.org/a(b)">p</a></p>'), "[p](https://x.org/a%28b%29)");
  assert.equal(md('<a href="https://x.org"><img src="https://x.org/i.png" alt="i"></a>'), "[![i](https://x.org/i.png)](https://x.org)");
  assert.equal(md('<p><a href="https://x.org"></a>after</p>'), "after");
});

test("dangerous markup never reaches the result", () => {
  const evil = '<p onclick="x()">hi</p><script>alert(1)</script><style>p{}</style><iframe src="https://e"></iframe><object data="x"><p>inner</p></object><embed src="x"><svg><text>svg</text></svg><button>Copy</button><form><input type="text" value="v"></form><video src="v.mp4"></video><noscript>ns</noscript><template><b>t</b></template><img src="https://a/b.png" onerror="alert(1)" alt="ok">';
  const out = md(evil);
  assert.equal(out, "hi\n\n![ok](https://a/b.png)");
  assert.ok(!/script|alert|onclick|onerror|iframe|svg|object|embed/i.test(out.replace(/!\[ok\]/, "")));
  assert.equal(md("<p>a<!-- <script>x</script> -->b</p>"), "ab");
  assert.equal(md("<p>a<![CDATA[ <b>x</b> ]]>b</p>"), "ab");
  assert.equal(md("<div><script>if (a < b) {}</script>text</div>"), "text");
});

test("only tags the Notes renderer understands are written as raw HTML", () => {
  const all = md('<div><p><u>u</u> <span style="x">s</span> <font color=red>f</font> <abbr title="t">A</abbr> <b>b</b></p><details><summary><i>S</i></summary>x</details><p>k<kbd>K</kbd></p></div>');
  const tags = [...all.matchAll(/<\/?([a-z0-9]+)/gi)].map((m) => m[1].toLowerCase());
  assert.ok(tags.every((t) => ["details", "summary", "kbd", "br"].includes(t)), tags.join());
  assert.ok(!/style=|color=|title=/.test(all));
});

test("KaTeX and MathML from chat answers become $...$ / $$...$$", () => {
  const k = '<span class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>E</mi></mrow><annotation encoding="application/x-tex">E=mc^2</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><span>E=mc2</span></span></span>';
  assert.equal(md("<p>Energy " + k + " done</p>"), "Energy $E=mc^2$ done");
  const d = '<span class="katex-display">' + k + "</span>";
  assert.equal(md("<p>before</p>" + d + "<p>after</p>"), "before\n\n$$\nE=mc^2\n$$\n\nafter");
  assert.equal(md("<p><math><mi>x</mi><mo>+</mo><mn>1</mn></math></p>"), "x+1");
});

test("clipboard wrappers: StartFragment markers, <html>/<body>, malformed and unclosed markup", () => {
  assert.equal(md("<html><body><!--StartFragment--><p>in</p><!--EndFragment--></body></html>"), "in");
  assert.equal(md("<html><head><title>T</title><meta charset=utf-8></head><body>junk<!--StartFragment--><b>x</b><!--EndFragment-->more</body></html>"), "**x**");
  assert.equal(md("<p>one<p>two<b>bold"), "one\n\ntwo**bold**");
  assert.equal(md("</div></b><p>ok</p>"), "ok");
  assert.equal(md("<p>a <b>b <i>c</b> d</i></p>"), "a **b *c*** d");
  assert.equal(md("<div><div><div><p>deep</p></div></div></div>"), "deep");
  assert.equal(md("<<<>>>"), "<<<>>>");
  assert.equal(md("<div></div><p> </p>"), null);
});

test("bounds: huge or empty input, deep nesting and long lists stay safe", () => {
  assert.equal(paste.htmlToMarkdown(""), null);
  assert.equal(paste.htmlToMarkdown("   "), null);
  assert.equal(paste.htmlToMarkdown(null), null);
  assert.equal(paste.htmlToMarkdown({}), null);
  assert.equal(paste.htmlToMarkdown("<p>" + "a".repeat(paste.MAX_HTML + 1) + "</p>"), null);
  const deep = "<div>".repeat(5000) + "<p>core</p>" + "</div>".repeat(5000);
  assert.equal(md(deep), "core");
  let nest = "x";
  for (let i = 0; i < 40; i++) nest = "<ul><li>" + nest + "</li></ul>";
  const out = md(nest);
  assert.ok(out && out.length < 5000 && out.includes("x"));
  const many = "<ul>" + "<li>i</li>".repeat(20000) + "</ul>";
  assert.equal(md(many).split("\n").length, 20000);
  const t0 = Date.now();
  md("<p>" + "<b>".repeat(20000) + "x</p>");
  assert.ok(Date.now() - t0 < 3000, "pathological nesting is not quadratic");
});

test("round trip: the Notes parser reads the converted Markdown as the same structure", () => {
  const html = '<h2>Plan</h2><p>Use <b>bold</b>, <a href="https://x.org">a link</a> and <code>code</code>.</p><ul><li>one</li><li><input type=checkbox checked> two</li></ul><blockquote><p>quote</p></blockquote><pre><code class="language-js">let a = 1;</code></pre><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table><details><summary>More</summary><p>hidden</p></details>';
  const b = blocks(md(html));
  assert.deepEqual(b.map((x) => x.type), ["h", "p", "list", "quote", "code", "table", "details"]);
  assert.equal(b[0].level, 2);
  const table = b[5];
  assert.equal(table.head.length, 2);
  assert.equal(table.rows.length, 1);
  assert.equal(table.rows[0][1][0].s, "2");
  assert.equal(b[4].lang || b[4].language || "js", "js");
  assert.equal(b[6].summary && JSON.stringify(b[6].summary).includes("More"), true);
});

test("round trip: escaped text parses back to the literal characters", () => {
  const flat = (nodes) => nodes.map((n) => n.s ?? flat(n.c || [])).join("");
  const text = "2 * 3 _x_ [y] ~z~ ==w== a || b <b>";
  const out = md("<p>" + text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</p>");
  const para = blocks(out);
  assert.equal(para.length, 1);
  assert.equal(para[0].type, "p");
  assert.equal(flat(para[0].c), text);
  for (const line of ["# h", "- x", "1. x", "> q", "---"]) {
    const o = blocks(md("<p>" + line.replace(/>/g, "&gt;") + "</p>"));
    assert.deepEqual(o.map((x) => x.type), ["p"], line);
    assert.equal(flat(o[0].c), line, line);
  }
});

test("table cell with a pipe parses back as one cell", () => {
  const t = blocks(md("<table><tr><th>A</th><th>B</th></tr><tr><td>x|y</td><td>z</td></tr></table>"))[0];
  assert.equal(t.type, "table");
  assert.equal(t.rows[0].length, 2);
  assert.equal(t.rows[0][0][0].s, "x|y");
});

test("richPaste gate: structure converts, plain/one-link/oversized/no-html do not", () => {
  assert.equal(c.richPaste("<p>just text</p>", "just text"), "");
  assert.equal(c.richPaste("", "x"), "");
  assert.equal(c.richPaste(null, "x"), "");
  assert.equal(c.richPaste('<a href="https://x.org/a">https://x.org/a</a>', "https://x.org/a"), "");
  assert.equal(c.richPaste("<b>bold</b>", "bold"), "**bold**");
  assert.equal(c.richPaste("<h1>T</h1><p>b</p>", "T\nb"), "# T\n\nb");
  assert.equal(c.richPaste("<p>a</p><p>b</p>", "a\n\nb"), "a\n\nb");
  assert.equal(c.richPaste("<p>" + "a".repeat(paste.MAX_HTML + 1) + "</p>", "x"), "");
  assert.equal(c.richPaste("<script>x</script>", "x"), "");
  assert.equal(c.richPaste("a\r\nb<b>c</b>", ""), "a b**c**");
  assert.equal(c.richPaste("<pre>x\r\ny\rz</pre><p>t</p>", ""), "```\nx\ny\nz\n```\n\nt");
});

test("wiring: standalone bundle lists the module, editor calls richPaste after the link branch", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "additional/notes/standalone.json"), "utf8"));
  assert.ok(manifest.include.includes("paste/ZentralNotesPasteHtml.js"));
  assert.ok(/loadPart\("additional\/notes\/paste\/ZentralNotesPasteHtml\.js", "notes-paste-html"\)/.test(source));
  const iLink = source.indexOf("askLink({ pasted: text.trim()");
  const iRich = source.indexOf("richPaste(e.clipboardData");
  assert.ok(iLink > 0 && iRich > iLink, "link dialog keeps priority over rich paste");
  assert.ok(/text\/html/.test(source.slice(iRich - 200, iRich + 200)));
});

console.log(passed + " paste-html tests passed");
