"use strict";
/* T4.3b: parser / wiki-graph / import-export decisions live in their own Notes part.
 *
 * The monolith keeps every old core-seam name; when the part is loaded each name delegates to the module,
 * and when it is missing the original inline body still answers. RED on the pre-T4.3b tree.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const PART_PATH = "additional/notes/parser/ZentralNotesParserGraph.js";
const MAIN = read("additional/notes/ZentralNotes.uc.js");
const MANIFEST = JSON.parse(read("additional/notes/standalone.json"));
const CURRENT_VERSION = JSON.parse(read("theme.json")).version;
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const UI = require("../additional/notes/calendar/ZentralNotesCalendarUI.js");
const PARSER = require("../additional/notes/parser/ZentralNotesParserGraph.js");
const dom = require("./helpers/fake-dom.cjs")();

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("ok -", name); };

test("the parser part exports pure decisions and a host-helper factory", () => {
  assert.ok(fs.existsSync(path.join(ROOT, PART_PATH)), PART_PATH + " exists");
  assert.equal(typeof PARSER.createParserGraph, "function");
  for (const name of ["noteLinkTarget", "cleanLinkLabel", "buildNoteLink", "insertNoteLink", "nextMarkdownFence",
    "mapOutsideCode", "resolveNoteTitle", "parseWikiTarget", "folderLabels", "labelsEndWith",
    "folderPathMatchesNote", "noteLinksIn", "rewriteNoteLinks", "uniqueFileNames", "exportText",
    "markdownExportSnapshot", "cleanBackupZipPath", "buildBackupManifest", "unlinkBroken", "findBacklinks"]) {
    assert.equal(typeof PARSER[name], "function", name + " is exported");
  }
  assert.equal(PARSER.noteLinkTarget("Some%20Note.md#head"), "Some Note");
  assert.equal(PARSER.noteLinkTarget("https://example.com/x.md"), null);
  assert.deepEqual(PARSER.parseWikiTarget("Folder/Title#Heading"), {
    whole: "Folder/Title", path: ["Folder"], title: "Title", heading: "Heading", self: false,
  });
  assert.equal(PARSER.cleanBackupZipPath("notes/A.md"), "notes/A.md");
  assert.equal(PARSER.cleanBackupZipPath("../notes/A.md"), "");
  assert.equal(PARSER.mapOutsideCode("a `x` b", (seg) => seg.toUpperCase()), "A `x` B");
  const graph = PARSER.createParserGraph({
    cleanAnchor: (value) => String(value || ""),
    titleOf: (body) => String(body).split("\n")[0].replace(/^#\s*/, ""),
    cleanFolder: (value) => String(value || ""),
    safeFileName: (name) => String(name || "note"),
    parseBlocks: () => [{ text: "text" }],
    hideFrontMatter: (text) => String(text),
    blocksText: (blocks) => blocks.map((b) => b.text).join(" "),
    cleanSpaceMode: (value) => value,
    wikiResolver: () => () => null,
    expandWikiLinks: (text) => String(text),
    mentionRe: () => null,
    hasMention: () => false,
    noteLinksIn: () => new Set(),
    format: "zentral-notes-backup",
    version: 1,
  });
  assert.equal(graph.noteLinkTarget("Note.md"), "Note");
  assert.equal(graph.buildNoteLink("A B", "Label", "Head"), "[Label](A%20B.md#Head)");
  assert.equal(graph.exportText("# Title"), "text\n");
  assert.deepEqual(graph.uniqueFileNames([{ body: "# One" }, { body: "# One" }]), ["One.md", "One 2.md"]);
  assert.equal(graph.cleanBackupZipPath("notes/A.md"), "notes/A.md");
  assert.equal(graph.buildBackupManifest({ notes: [{}, { trashed: true }], assets: [1] }).counts.notes, 1);
});

test("the standalone manifest embeds the parser part after the calendar UI part", () => {
  const include = MANIFEST.include;
  const ui = include.indexOf("calendar/ZentralNotesCalendarUI.js");
  const parser = include.indexOf("parser/ZentralNotesParserGraph.js");
  assert.ok(ui >= 0 && parser > ui, "the parser part loads after calendar UI");
  assert.equal(MANIFEST.version, CURRENT_VERSION);
});

test("the monolith loads the part and every extracted name delegates to it", () => {
  assert.ok(MAIN.includes(`loadPart("${PART_PATH}", "notes-parser")`));
  assert.ok(MAIN.includes("PARSER_PART.createParserGraph(PARSER_DEPS)"));
  assert.ok(MAIN.includes("PARSER_PART, PARSER_UI"), "the test seam publishes the parts");
  for (const name of ["noteLinkTarget", "cleanLinkLabel", "buildNoteLink", "insertNoteLink", "nextMarkdownFence",
    "mapOutsideCode", "resolveNoteTitle", "parseWikiTarget", "folderLabels", "labelsEndWith",
    "folderPathMatchesNote", "noteLinksIn", "rewriteNoteLinks", "findBacklinks", "uniqueFileNames", "exportText",
    "unlinkBroken", "markdownExportSnapshot", "cleanBackupZipPath", "buildBackupManifest"]) {
    assert.ok(MAIN.includes("if (PARSER_PART) return PARSER_UI." + name), name + " delegates through the part");
  }
});

function boot(withPart) {
  const seam = {};
  const parts = { "notes-calendar": C, "notes-calendar-ui": UI };
  if (withPart) parts["notes-parser"] = PARSER;
  const win = {
    __zentralNotesParts: parts, __zentralNotesTestSeam: seam, ZentralRuntime: { register() {} },
    document: dom.document, innerWidth: 1000, innerHeight: 700,
    requestAnimationFrame: (fn) => { dom.raf.push(fn); return dom.raf.length; }, cancelAnimationFrame() {},
    setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {},
  };
  win.window = win;
  vm.runInNewContext(MAIN, {
    window: win, document: dom.document, globalThis: { Services: {} }, ChromeUtils: {}, console,
    URL, Date, JSON, Math, Promise, RegExp, Number, String, Array, Object, Map, Set,
    setTimeout, clearTimeout, queueMicrotask, navigator: { platform: "Linux" },
  });
  return seam.core;
}

test("the core seam is unchanged and uses the part when present", () => {
  const core = boot(true);
  assert.equal(core.PARSER_PART, PARSER);
  assert.ok(core.PARSER_UI && typeof core.PARSER_UI === "object", "the bound graph is published");
  assert.equal(typeof core.noteLinkTarget, "function");
  assert.equal(core.noteLinkTarget("Some%20Note.md#head"), "Some Note");
  assert.equal(core.buildNoteLink("Note", "Label", ""), "[Label](Note.md)");
  assert.equal(core.mapOutsideCode("a `x` b", (seg) => seg.toUpperCase()), "A `x` B");
  assert.equal(core.cleanBackupZipPath("notes/A.md"), "notes/A.md");
  assert.deepEqual(core.markdownExportSnapshot([{ id: "a" }, null]), [{ id: "a" }]);
});

test("a host without the part keeps the old inline answers", () => {
  const core = boot(false);
  assert.equal(core.PARSER_PART, null);
  assert.equal(core.PARSER_UI, null);
  assert.equal(core.noteLinkTarget("Some%20Note.md#head"), "Some Note");
  assert.equal(core.buildNoteLink("Note", "Label", ""), "[Label](Note.md)");
  assert.equal(core.mapOutsideCode("a `x` b", (seg) => seg.toUpperCase()), "A `x` B");
  assert.equal(core.cleanBackupZipPath("../notes/A.md"), "");
});

console.log(`\nnotes-parser-graph-part (${passed} passed)`);
