"use strict";
/* T1.13: Obsidian-style local embeds, block IDs and bounded section selection. */
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const seam = {};
const win = { __zentralNotesTestSeam: seam, ZentralRuntime: { register() {} } };
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
const plain = (nodes) => nodes.map((node) => node.s ?? plain(node.c || [])).join("");
let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok -", name);
}

test("inline parser recognises note, section, block and image transclusions", () => {
  const cases = [
    ["![[Project Notes]]", { t: "embed", target: "Project Notes", width: 0 }],
    ["![[Project Notes#Design]]", { t: "embed", target: "Project Notes#Design", width: 0 }],
    ["![[Project Notes#^spec-1]]", { t: "embed", target: "Project Notes#^spec-1", width: 0 }],
    ["![[diagram.webp|450]]", { t: "embed", target: "diagram.webp", width: 450 }],
  ];
  for (const [input, expected] of cases) assert.deepEqual(JSON.parse(JSON.stringify(c.parseInline(input)[0])), expected, input);
  const code = c.parseInline("`![[not an embed]]`");
  assert.deepEqual(JSON.parse(JSON.stringify(code)), [{ t: "code", s: "![[not an embed]]" }]);
  assert.ok(c.parseInline("\\![[escaped]]").every((n) => n.t !== "embed"));
});

test("embed targets validate input and clamp image widths", () => {
  assert.equal(c.parseEmbedTarget("  "), null);
  assert.equal(c.parseEmbedTarget("../escape.png" ).image, "");
  assert.equal(c.parseEmbedTarget("javascript:alert(1)").image, "");
  assert.equal(c.parseEmbedTarget("bad\nname"), null);
  assert.equal(c.parseEmbedTarget("image.png|9").width, 32);
  assert.equal(c.parseEmbedTarget("image.png|9999").width, 1600);
  const heading = c.parseEmbedTarget("Folder/Project#Architecture#Decision");
  assert.equal(heading.parts.whole, "Folder/Project");
  assert.deepEqual(JSON.parse(JSON.stringify(heading.parts.path)), ["Folder"]);
  assert.equal(heading.parts.heading, "Decision");
  const block = c.parseEmbedTarget("Project#^spec-1");
  assert.equal(block.blockId, "spec-1");
  assert.equal(block.parts.heading, "");
  const self = c.parseEmbedTarget("#^here");
  assert.equal(self.parts.self, true);
  assert.equal(self.blockId, "here");
});

test("paragraph, list-item and callout block IDs are metadata, not visible prose", () => {
  const [paragraph, list, quote, code] = c.parseBlocks(
    "A paragraph with a marker ^para-1\n\n- one ^item-1\n- two\n\n> [!NOTE] A callout\n> Body ^callout-1\n\n```\ncode ^not-an-id\n```",
  );
  assert.equal(paragraph.blockId, "para-1");
  assert.equal(plain(paragraph.c), "A paragraph with a marker");
  assert.equal(list.items[0].blockId, "item-1");
  assert.equal(plain(list.items[0].c), "one");
  assert.equal(quote.blockId, "callout-1");
  assert.equal(quote.blocks.at(-1).blockId, undefined, "the callout owns the block ID rather than its child paragraph");
  assert.equal(plain(quote.blocks.at(-1).c), "Body");
  assert.equal(code.text, "code ^not-an-id");
});

test("block ID lookup finds top-level, nested callout and individual list blocks", () => {
  const blocks = c.parseBlocks(
    "A paragraph ^p1\n\n- first ^li1\n- second\n\n> [!TIP] Tip\n> nested ^q1",
  );
  assert.equal(c.findBlockById(blocks, "p1").type, "p");
  const item = c.findBlockById(blocks, "li1");
  assert.equal(item.type, "list");
  assert.equal(item.items.length, 1);
  assert.equal(item.items[0].blockId, "li1");
  assert.equal(c.findBlockById(blocks, "q1").type, "quote");
  assert.equal(c.findBlockById(blocks, "missing"), null);
});

test("section transclusion contains its heading and descendants, stopping at the next peer", () => {
  const body = [
    "# Project",
    "",
    "intro",
    "",
    "## Design",
    "",
    "decision ^decision-1",
    "",
    "### Details",
    "",
    "fine print",
    "",
    "## Delivery",
    "",
    "release plan",
  ].join("\n");
  const blocks = c.parseBlocks(body);
  const selected = c.selectTransclusionBlocks(body, blocks, c.parseEmbedTarget("Project#Design"));
  assert.deepEqual(JSON.parse(JSON.stringify(selected.map((block) => block.type))), ["h", "p", "h", "p"]);
  assert.deepEqual(JSON.parse(JSON.stringify(selected.map((block) => block.c ? plain(block.c) : ""))), ["Design", "decision", "Details", "fine print"]);
  assert.deepEqual(JSON.parse(JSON.stringify(c.selectTransclusionBlocks(body, blocks, c.parseEmbedTarget("Project#^decision-1")).map((b) => plain(b.c)))), ["decision"]);
  assert.deepEqual(JSON.parse(JSON.stringify(c.selectTransclusionBlocks(body, blocks, c.parseEmbedTarget("Project#Missing")))), []);
});

test("transclusion grammar survives exports and does not get expanded as a normal wiki-link", () => {
  const body = "![[Project Notes#Design]] and ![[diagram.png|420]]\n\nA paragraph ^block-a";
  assert.ok(c.exportText(body).includes("![[Project Notes#Design]]"));
  assert.ok(c.exportText(body).includes("![[diagram.png|420]]"));
  assert.ok(c.exportText(body).includes("A paragraph ^block-a"));
  const html = c.exportHtml(body);
  assert.ok(html.includes("![[Project Notes#Design]]"));
  assert.ok(html.includes('data-block-id="block-a"'));
  const unchanged = c.expandWikiLinks("![[Project Notes]]", () => ({ id: "note-id" }));
  assert.equal(unchanged, "![[Project Notes]]");
});

test("read renderer uses local store resolution, cycle detection and a strict depth bound", () => {
  const render = source.slice(source.indexOf("function renderEmbed(parent, embed"), source.indexOf("// Link support for the read pane", source.indexOf("function renderEmbed(parent, embed")));
  assert.ok(render.includes("resolveWikiTarget("));
  assert.ok(render.includes("store.list()"));
  assert.ok(render.includes("stack[stack.length - 1]"), "nested embeds resolve relative to the embedded note");
  assert.ok(render.includes("ancestry.includes(target.id)"));
  assert.ok(render.includes("ancestry.length >= 6"));
  assert.ok(render.includes("env.loadAsset"));
  assert.ok(source.includes("(?<!!)\\[\\["), "embed target is excluded from ordinary wiki-link expansion");
});

console.log(`${passed} T1.13 transclusion tests passed`);
