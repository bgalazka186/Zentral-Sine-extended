"use strict";
/* T4.1 regression test: Owner's comprehensive 12-section Markdown & Extended Syntax Feature Showcase.
 * Verifies the bundled showcase note in DEMO_NOTES parses, links, transcludes, auto-updates its ToC,
 * highlights code, handles LaTeX, footnotes, <details>, and Mermaid notices cleanly across modes. */
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const flavors = require(path.join(root, "additional/notes/flavors/ZentralNotesFlavors.js"));
const shortcuts = require(path.join(root, "additional/notes/flavors/ZentralNotesShortcuts.js"));
const source = fs.readFileSync(path.join(root, "additional/notes/ZentralNotes.uc.js"), "utf8");
const seam = {};
const win = {
  __zentralNotesTestSeam: seam,
  __zentralNotesParts: { "notes-flavors": flavors, "notes-shortcuts": shortcuts },
  ZentralRuntime: { register() {} },
};
win.window = win;
vm.runInNewContext(source, {
  window: win,
  globalThis: { Services: {} },
  ChromeUtils: {},
  URL,
  Date,
  JSON,
  Math,
  Promise,
  RegExp,
  Number,
  Map,
  Set,
  console,
});

const c = seam.core;
let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok -", name);
}

function collectInline(blocks) {
  const out = [];
  const walkInline = (nodes) => {
    for (const n of nodes || []) {
      out.push(n);
      if (Array.isArray(n.c)) walkInline(n.c);
    }
  };
  const walkBlocks = (list) => {
    for (const b of list || []) {
      if (Array.isArray(b.c)) walkInline(b.c);
      if (Array.isArray(b.blocks)) walkBlocks(b.blocks);
      if (Array.isArray(b.summary)) walkInline(b.summary);
      if (Array.isArray(b.items)) {
        for (const it of b.items) {
          walkInline(it.c);
          for (const m of it.more || []) {
            if (Array.isArray(m)) walkInline(m);
          }
        }
      }
      if (Array.isArray(b.head)) for (const cell of b.head) walkInline(cell);
      if (Array.isArray(b.rows)) for (const row of b.rows) for (const cell of row) walkInline(cell);
      if (Array.isArray(b.notes)) for (const fn of b.notes) walkInline(fn.c);
    }
  };
  walkBlocks(blocks);
  return out;
}

function allBlocks(blocks) {
  const out = [];
  const walk = (list) => {
    for (const b of list || []) {
      out.push(b);
      if (Array.isArray(b.blocks)) walk(b.blocks);
    }
  };
  walk(blocks);
  return out;
}

test("T4.1: showcase note is exported and bundled in DEMO_NOTES with exact title", () => {
  assert.equal(c.SHOWCASE_NOTE_ID, "zn-demo-showcase");
  assert.equal(typeof c.buildShowcaseNote, "function");
  const entry = Array.from(c.DEMO_NOTES).find((d) => d.id === c.SHOWCASE_NOTE_ID);
  assert.ok(entry, "zn-demo-showcase is present in DEMO_NOTES");
  assert.equal(c.demoTitle(entry), "Markdown & Extended Syntax Feature Showcase");
  assert.equal(entry.body, c.buildShowcaseNote());
});

test("T4.1: section (1) inline styles, highlight, kbd, sub/sup, and dividers", () => {
  const body = c.buildShowcaseNote();
  const blocks = JSON.parse(JSON.stringify(c.parseBlocks(body, false, { flavor: "mixed" })));
  const flat = allBlocks(blocks);
  const inline = collectInline(blocks);
  const types = new Set(inline.map((n) => n.t));
  for (const kind of ["b", "i", "s", "hl", "kbd", "sub", "sup", "code", "u", "spoiler"]) {
    assert.ok(types.has(kind), "inline node kind present: " + kind);
  }
  assert.ok(flat.some((b) => b.type === "hr"), "divider present");
});

test("T4.1: section (2) H1-H6 hierarchy and auto-updated Table of Contents", () => {
  const body = c.buildShowcaseNote();
  const hs = c.headingsOf(body);
  for (let level = 1; level <= 6; level++) {
    assert.ok(hs.some((h) => h.level === level), `H${level} heading present`);
  }
  assert.ok(c.findToc(body), "auto-updated ## Table of Contents block present");
  const refreshed = c.updateToc(body);
  assert.equal(refreshed.found, true, "updateToc locates the ToC");
  assert.equal(refreshed.changed, false, "bundled ToC is already in sync with headings");
});

test("T4.1: sections (3)-(4) multi-paragraph/nested blockquotes and Obsidian callouts including foldable [!faq]-", () => {
  const body = c.buildShowcaseNote();
  const blocks = JSON.parse(JSON.stringify(c.parseBlocks(body, false, { flavor: "mixed" })));
  const quotes = allBlocks(blocks).filter((b) => b.type === "quote");
  const plainQuotes = quotes.filter((q) => !q.callout);
  assert.ok(
    plainQuotes.some((q) => q.blocks.filter((b) => b.type === "p").length >= 2),
    "multi-paragraph blockquote present",
  );
  assert.ok(
    plainQuotes.some((q) => q.blocks.some((b) => b.type === "quote" && !b.callout)),
    "nested blockquote present",
  );
  const callouts = quotes.filter((q) => q.callout);
  const faq = callouts.find((q) => q.callout.kind === "question" && q.callout.fold === "closed");
  assert.ok(faq, "foldable [!faq]- callout parsed as folded question callout");
  assert.ok(callouts.some((q) => q.callout.fold === "open"), "expanded foldable callout present");
  assert.ok(callouts.some((q) => q.callout.kind === "note"), "note callout present");
  assert.ok(callouts.some((q) => q.callout.kind === "tip"), "tip callout present");
  assert.ok(callouts.some((q) => q.callout.kind === "warning"), "warning callout present");
});

test("T4.1: section (5) unordered, ordered, and interactive task lists ([x], [?], [ ])", () => {
  const body = c.buildShowcaseNote();
  const blocks = JSON.parse(JSON.stringify(c.parseBlocks(body, false, { flavor: "mixed" })));
  const lists = allBlocks(blocks).filter((b) => b.type === "list");
  assert.ok(lists.some((l) => l.items.some((it) => it.marker === "\u2022" && it.checked === null)), "unordered list present");
  assert.ok(lists.some((l) => l.items.some((it) => /^\d+[.)]$/.test(it.marker))), "ordered list present");
  const taskItems = lists.flatMap((l) => l.items).filter((it) => it.checked !== null);
  assert.ok(taskItems.some((it) => it.checked === true), "[x] task present");
  assert.ok(taskItems.some((it) => it.checked === false && !it.status), "[ ] task present");
  assert.ok(taskItems.some((it) => it.status === "?"), "[?] task present");
});

test("T4.1: section (6) aligned GFM table with escaped pipes", () => {
  const body = c.buildShowcaseNote();
  const blocks = JSON.parse(JSON.stringify(c.parseBlocks(body, false, { flavor: "mixed" })));
  const tables = allBlocks(blocks).filter((b) => b.type === "table");
  assert.ok(tables.length >= 1, "GFM table present");
  const aligned = tables.find(
    (t) => t.align.includes("left") && t.align.includes("center") && t.align.includes("right"),
  );
  assert.ok(aligned, "table includes left, center, and right alignment");
  const cellText = aligned.rows
    .flat()
    .map((cell) => collectInline([{ c: cell }]).map((n) => n.s || "").join(""))
    .join(" ");
  assert.ok(cellText.includes("|"), "escaped pipe renders as literal pipe inside a table cell");
});

test("T4.1: section (7) highlighted code blocks (JS, Python, Rust, JSON)", () => {
  const body = c.buildShowcaseNote();
  const blocks = JSON.parse(JSON.stringify(c.parseBlocks(body, false, { flavor: "mixed" })));
  const codes = allBlocks(blocks).filter((b) => b.type === "code");
  const langs = new Set(codes.map((b) => c.codeLangKey(b.lang)));
  for (const key of ["js", "py", "rust", "json"]) {
    assert.ok(langs.has(key), "code block language present: " + key);
    const sample = codes.find((b) => c.codeLangKey(b.lang) === key);
    const tokens = c.highlightCode(sample.text, sample.lang);
    assert.ok(tokens.some((tok) => tok.k && tok.k !== ""), "code block highlights tokens for " + key);
  }
});

test("T4.1: section (8) inline and block LaTeX equations and matrices", () => {
  const body = c.buildShowcaseNote();
  const blocks = JSON.parse(JSON.stringify(c.parseBlocks(body, false, { flavor: "mixed" })));
  const inline = collectInline(blocks);
  assert.ok(inline.some((n) => n.t === "math"), "inline $...$ math present");
  const mathBlocks = allBlocks(blocks).filter((b) => b.type === "math");
  assert.ok(mathBlocks.length >= 2, "block equation and matrix $$...$$ present");
  assert.ok(
    mathBlocks.some((b) => b.c.some((n) => n.t === "br")),
    "matrix block preserves row line breaks",
  );
});

test("T4.1: section (9) wikilinks (alias, #Heading), ^block-id, nested #tags, and ![[embeds|450]]", () => {
  const body = c.buildShowcaseNote();
  const demos = Array.from(c.DEMO_NOTES).map((d, i) => ({ id: d.id, body: d.body, folder: c.DEMO_FOLDER, updated: 1000 + i }));
  const folders = [{ id: c.DEMO_FOLDER, label: "Help" }];
  assert.deepEqual(
    JSON.parse(JSON.stringify(c.findBrokenLinks(demos, folders))),
    [],
    "all showcase wikilinks resolve with zero broken links",
  );
  assert.match(body, /\[\[Notes syntax tour\|[^\]]+\]\]/, "wikilink with alias present");
  assert.match(body, /\[\[Linking notes demo#Section B\]\]/, "cross-note #Heading wikilink present");
  assert.match(body, /\[\[#[^\]]+\]\]/, "same-note #Heading wikilink present");
  const blocks = JSON.parse(JSON.stringify(c.parseBlocks(body, false, { flavor: "mixed" })));
  const blockTarget = c.findBlockById(blocks, "showcase-block");
  assert.ok(blockTarget, "^showcase-block block ID parses cleanly");
  const inline = collectInline(blocks);
  const embeds = inline.filter((n) => n.t === "embed");
  assert.ok(embeds.some((e) => e.width === 450), "![[embed|450]] parsed with width 450");
  assert.ok(
    embeds.some((e) => c.parseEmbedTarget(e.target)?.blockId === "showcase-block"),
    "![[#^showcase-block]] self block embed parsed",
  );
  const tags = Array.from(c.inlineTags(body));
  assert.ok(tags.some((t) => t.includes("/")), "nested #tag present");
  const linksNote = demos.find((d) => d.id === "zn-demo-links");
  const secSpec = c.parseEmbedTarget("Linking notes demo#Section B|450");
  const selected = c.selectTransclusionBlocks(linksNote.body, c.parseBlocks(linksNote.body), secSpec);
  assert.ok(selected && selected.length > 0, "embedded section resolves to live blocks");
});

test("T4.1: sections (10)-(12) standard & inline footnotes, <details> accordions, and Mermaid diagrams", () => {
  const body = c.buildShowcaseNote();
  const blocks = JSON.parse(JSON.stringify(c.parseBlocks(body, false, { flavor: "mixed" })));
  const flat = allBlocks(blocks);
  const fnBlock = flat.find((b) => b.type === "footnotes");
  assert.ok(fnBlock && fnBlock.items.length >= 2, "both standard [^1] and inline ^[…] footnotes collected");
  assert.ok(fnBlock.items.some((n) => n.label === "1"), "standard [^1] footnote present");
  assert.ok(fnBlock.items.some((n) => n.label.startsWith("inline ")), "inline ^[…] footnote present");

  const details = flat.filter((b) => b.type === "details");
  assert.ok(details.some((d) => !d.open), "closed <details> accordion present");
  assert.ok(details.some((d) => d.open), "open <details open> accordion present");

  const mermaidBlocks = flat.filter((b) => b.type === "code" && b.lang === "mermaid");
  assert.equal(mermaidBlocks.length, 2, "two Mermaid diagram blocks (flowchart and gitGraph)");
  assert.ok(mermaidBlocks.some((b) => /flowchart\b/.test(b.text)), "flowchart Mermaid diagram present");
  assert.ok(mermaidBlocks.some((b) => /gitGraph\b/.test(b.text)), "gitGraph Mermaid diagram present");
  const notices = flat.filter((b) => b.type === "quote" && b.callout && /Mermaid/i.test(b.callout.title));
  assert.equal(notices.length, 2, "each Mermaid block emits the unsupported-diagram notice");

  const html = c.exportHtml(body, { flavor: "mixed" });
  assert.match(html, /<h1[ >]/);
  assert.match(html, /<details[\s>]/);
  assert.match(html, /data-block-id="showcase-block"/);
  assert.ok(c.exportText(body).includes("Markdown & Extended Syntax Feature Showcase"));
});

console.log(`\n${passed} notes showcase tests passed`);
