"use strict";
// Recovered subset of the P4 work visible in the Claude transcript.
// This test covers only heading anchors, note-link fragments, footnotes and unlinked mentions.
// It does not represent the missing P4 core (date notes, history, wiki autocomplete or Zen Sync).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const dom = require("./helpers/fake-dom.cjs")();
const { Ev, El, document, raf } = dom;
const win = { document, ZentralRuntime: { register() {} }, __zentralNotesTestSeam: {},
  requestAnimationFrame: (fn) => raf.push(fn), cancelAnimationFrame() {},
  setTimeout, clearTimeout, innerWidth: 1200, innerHeight: 800,
  addEventListener() {}, removeEventListener() {} };
win.window = win;
vm.runInNewContext(source, {
  window: win, document, Event: Ev, globalThis: { Services: {} }, ChromeUtils: {}, console,
  URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, Uint8Array,
  setTimeout, clearTimeout, queueMicrotask, navigator: { platform: "Linux" },
});
const c = win.__zentralNotesTestSeam.core;
const plain = (v) => JSON.parse(JSON.stringify(v));
let passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok -", name); }

// Heading anchors and canonical note links.
test("heading slugs ignore inline decoration, fold accents and suffix duplicate headings", () => {
  const body = "# Crème & Plan\n\n## Plan\n\n## Plan\n\n```md\n# not a heading\n```";
  assert.deepEqual(plain(c.headingsOf(body).map((h) => ({ level: h.level, slug: h.slug }))), [
    { level: 1, slug: "creme-plan" },
    { level: 2, slug: "plan" },
    { level: 2, slug: "plan-1" },
  ]);
  assert.equal(c.headingOffset(body, "plan-1"), body.indexOf("## Plan", body.indexOf("## Plan") + 1));
});

test("note-link fragments round-trip through parsing and link insertion", () => {
  assert.deepEqual(plain(c.noteLinkParts("My%20note.md#some-heading")), { id: "My note", heading: "some-heading" });
  assert.equal(c.buildNoteLink("My note", "Heading", "some-heading"), "[Heading](My%20note.md#some-heading)");
  const [p] = plain(c.parseBlocks("[Go](n1.md#second-section)"));
  assert.equal(p.c[0].t, "nl");
  assert.equal(p.c[0].id, "n1");
  assert.equal(p.c[0].heading, "second-section");
  assert.equal(c.insertNoteLink("", 0, 0, "n1", "Go", "second-section").text, "[Go](n1.md#second-section)");
});

// Footnotes: references need matching definitions; definition lines are removed from body blocks.
test("footnote references are numbered by first use and definitions render as a final block", () => {
  const body = "Intro[^b], then [^a], then [^b].\n\n[^a]: Alpha note\n[^b]: Beta **note**";
  const blocks = plain(c.parseBlocks(body));
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].type, "p");
  assert.deepEqual(blocks[0].c.filter((n) => n.t === "fn").map((n) => [n.label, n.n]), [["b", 1], ["a", 2], ["b", 1]]);
  assert.equal(blocks[1].type, "footnotes");
  assert.deepEqual(blocks[1].items.map((n) => [n.label, n.n]), [["b", 1], ["a", 2]]);
  assert.ok(!JSON.stringify(blocks).includes("[^a]:"));
});

test("undefined footnote labels remain literal and fenced definitions are ignored", () => {
  const body = "Keep [^missing].\n\n```md\n[^x]: not a definition\n```";
  const blocks = plain(c.parseBlocks(body));
  assert.ok(blocks.some((b) => b.type === "p" && b.c.some((n) => n.t === "text" && n.s.includes("[^missing]"))));
  assert.ok(!blocks.some((b) => b.type === "footnotes"));
});

test("HTML and plain-text exports include footnote references, definitions and return links", () => {
  const body = "Claim[^1].\n\n[^1]: Source text";
  const html = c.exportHtml(body);
  const text = c.exportText(body);
  assert.ok(html.includes('id="fnref-1"'));
  assert.ok(html.includes('id="fn-1"'));
  assert.ok(html.includes('href="#fnref-1"'));
  assert.ok(text.includes("Claim[1]"));
  assert.ok(text.includes("[1] Source text"));
});

test("unlinked mentions use whole-title boundaries, not substring matches", () => {
  const re = c.mentionRe("Plan");
  assert.ok(c.hasMention("The Plan is ready", re));
  assert.ok(!c.hasMention("Planning is ready", re));
  assert.ok(!c.hasMention("Planet earth", re));
  assert.ok(!c.hasMention("`Plan` is code\n```\nPlan\n```", re), "inline and fenced code are excluded");
  assert.equal(c.mentionRe("AI"), null);
});

async function runDomChecks() {
  const files = new Map();
  const io = {
    join: (...parts) => parts.join("/"), filename: (value) => value.split("/").pop(),
    readUTF8: async (value) => { if (!files.has(value)) throw new Error("nf"); return files.get(value).text; },
    writeUTF8: async (value, text) => files.set(value, { text, mtime: Date.now() }),
    remove: async (value) => files.delete(value), exists: async (value) => files.has(value),
    children: async (dir) => [...files.keys()].filter((value) => value.startsWith(dir + "/")),
    stat: async (value) => ({ lastModified: files.get(value)?.mtime || 0 }), restrict: async () => {},
  };
  const store = c.createStore({ io, notify() {}, windowId: "p4", getDir: async () => "/notes", getMaxSaveMs: () => 5000, setTimer: setTimeout, clearTimer: clearTimeout });
  const host = new El("div");
  const adapter = { position: "fixed", host, attach: (root) => host.appendChild(root), getArea: () => ({ left: 0, top: 0, width: 500, height: 700, anchor: "top" }), watch: () => () => {}, setActive() {}, rewatch() {} };
  const sheet = c.createSheet({ store, adapter, env: { openLink() {}, copyText() {}, getPref: (_k, d) => d, setPref() {} }, ensureStore: () => store.open() });
  const flushRaf = async () => { for (let i = 0; i < 4; i++) { raf.splice(0).forEach((fn) => fn()); await new Promise((resolve) => setImmediate(resolve)); } };
  await sheet.open(); await flushRaf();
  const target = store.create("Target note\nA useful description\n\n## Section\nText");
  const source = store.create(`Source\n\n- [Target note](${target.id}.md)\n\nJump to [section](${target.id}.md#section)\n\nClaim[^1].\n\n[^1]: A cited source`);
  store.setMeta({ mode: "read" });
  sheet.openNoteById(source.id); await flushRaf();
  const hub = sheet.root.querySelector(".zn-hubdesc");
  assert.ok(hub && hub.textContent.includes("A useful description"), "bare hub links display the linked note description");
  const footRef = sheet.root.querySelector(".zn-fnref");
  const footBlock = sheet.root.querySelector(".zn-footnote");
  assert.ok(footRef && footBlock, "footnote references and their target list are rendered");
  footRef.dispatchEvent(new Ev("click", { bubbles: true }));
  const noteLink = sheet.root.querySelector(".zn-notelink");
  assert.ok(noteLink, "note links render as interactive note links");
  noteLink.dispatchEvent(new Ev("click", { bubbles: true }));
  await flushRaf();
  const headings = sheet.root.querySelectorAll(".zn-h");
  assert.ok(headings.some((node) => node.dataset.slug === "section"), "linked-note headings carry stable slugs");
  sheet.destroy();
  passed++;
  console.log("ok - DOM: hub descriptions, footnote controls and heading-linked note rendering");
}

runDomChecks().then(() => console.log(`\n${passed} recovered P4 tests passed`)).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
