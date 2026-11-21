"use strict";
/* T4.3c: Zen sidebar UI decisions live in their own Notes part, and the monolith remains the single build/loader entry.
 *
 * The core seam keeps every old name; when the part is loaded each name delegates to the module, and when it is
 * missing the original inline body still answers. RED on the pre-T4.3c tree.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const PART_PATH = "additional/notes/zen/ZentralNotesZenSidebar.js";
const MAIN = read("additional/notes/ZentralNotes.uc.js");
const MANIFEST = JSON.parse(read("additional/notes/standalone.json"));
const THEME = JSON.parse(read("additional/notes/theme.json"));
const CURRENT_VERSION = JSON.parse(read("theme.json")).version;
const CATALOG = read("loader/ZentralCatalog.js");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const UI = require("../additional/notes/calendar/ZentralNotesCalendarUI.js");
const PARSER = require("../additional/notes/parser/ZentralNotesParserGraph.js");
const ZEN = require("../additional/notes/zen/ZentralNotesZenSidebar.js");
const dom = require("./helpers/fake-dom.cjs")();
const plain = (value) => JSON.parse(JSON.stringify(value)); // VM objects live in another realm

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("ok -", name); };
const NAMES = ["noteDropTarget", "noteTabDropPlan", "projectNotesFolder", "diffProjection", "notesSubId",
  "notesKeyFromId", "adoptNotesSubfolders", "folderZenVars", "noteFaviconUri", "agendaFaviconUri",
  "sharedProjectionPlan", "planRootDedupe", "planCleanup", "dropDecision", "urlNoteBody", "cleanZenMode",
  "zenNoteUrl", "zenNewUrl", "parseZenUrl", "pseudoTabCleanupKind", "filterSessionFilePayload"];

test("the Zen sidebar part exports pure decisions and a host-helper factory", () => {
  assert.ok(fs.existsSync(path.join(ROOT, PART_PATH)), PART_PATH + " exists");
  assert.equal(typeof ZEN.createZenSidebar, "function");
  for (const name of NAMES) assert.equal(typeof ZEN[name], "function", name + " is exported");
  assert.equal(ZEN.zenNoteUrl("A B"), "about:blank#zn-note:A%20B");
  assert.equal(ZEN.cleanZenMode("all"), "all");
  assert.equal(ZEN.cleanZenMode("other"), "off");
  assert.deepEqual(ZEN.parseZenUrl("about:blank#zn-note:Some%20Note"), { kind: "note", id: "Some Note" });
  assert.equal(ZEN.parseZenUrl("https://example.com"), null);
  assert.deepEqual(ZEN.planRootDedupe([{ foreign: 0 }, { foreign: 1 }]), { adopt: 0, remove: [], release: [1] });
  assert.deepEqual(ZEN.planCleanup([{ id: 1, attrs: {} }, { id: 2, attrs: { "bgalazka-notes-item": true } }]), [2]);
  assert.equal(ZEN.notesSubId("f:a/b"), "bgalazka-zentral-notes-sub_a_b");
  assert.equal(ZEN.notesKeyFromId("bgalazka-zentral-notes-sub_a_b"), "f:a/b");
  assert.equal(ZEN.sharedProjectionPlan({ active: "", targetReady: true }), "wait");
  assert.equal(ZEN.sharedProjectionPlan({ active: "w1", targetReady: true, alreadyThere: true }), "stay");
  assert.equal(ZEN.filterSessionFilePayload("plain text"), "plain text");
});

test("createZenSidebar binds host helpers and configuration without changing signatures", () => {
  const ui = ZEN.createZenSidebar({
    cleanFolder: (v) => String(v ?? ""),
    cleanLinkLabel: (v) => String(v || "note"),
    buildLink: (label, href) => `[${label}](${href})`,
    safeHref: (raw) => (/^https:/.test(String(raw)) ? String(raw) : ""),
    filterSessionStoreState: (state) => ({ ...state, filtered: true }),
    titleOf: (body) => String(body).replace(/^#\s*/, "").split("\n")[0],
    buildTree: () => ({ children: [{ id: "f", label: "Folder", zenSidebar: "", children: [] }], notes: [{ id: "n", body: "# Note" }] }),
    cleanFolderZenSidebar: (v) => v,
    serializeFolderParts: (v) => String(v || ""),
    serializeFolderOpacity: (v) => String(v || ""),
    cleanFolderParts: (v) => v || {},
    cleanFolderOpacity: (v) => v || {},
    colorHex: (name) => (name === "blue" ? "#00f" : ""),
    colorfulFolderDefaults: () => ({ b: "#ccc" }),
    noteOrderBetween: () => 7,
  }, {
    ZEN_URL_PREFIX: "about:blank#zn-",
    NOTES_ATTR: "bgalazka-notes-item",
    NOTES_ZEN_SUB_PREFIX: "bgalazka-zentral-notes-sub_",
    ZEN_MODES: ["off", "selected", "all"],
    TINT_HEX: { gray: "#999", orange: "#f80" },
    PSEUDO_PAYLOAD_HINT_RE: /hint/,
  });
  for (const name of NAMES) assert.equal(typeof ui[name], "function", name + " is bound");
  assert.equal(ui.zenNoteUrl("A B"), "about:blank#zn-note:A%20B");
  assert.equal(ui.cleanZenMode("all"), "all");
  assert.equal(ui.urlNoteBody("Title", "https://example.com"), "[Title](https://example.com)\n".replace(/^/, "Title\n\n"));
  assert.equal(ui.planCleanup([{ id: 2, attrs: { "bgalazka-notes-item": true } }])[0], 2);
  assert.deepEqual(ui.projectNotesFolder([], []), [
    { key: "f:f", kind: "folder", id: "f", label: "Folder", parent: "" },
    { key: "n:n", kind: "note", id: "n", label: "Note", parent: "" },
  ]);
  assert.equal(ui.filterSessionFilePayload('{"hint":1}'), '{"hint":1,"filtered":true}');
  assert.equal(ui.folderZenVars("blue")["--zen-folder-front-bgcolor"].includes("#00f"), true);
  assert.ok(ui.noteFaviconUri("blue").startsWith("data:image/svg+xml,"));
  const plan = ui.dropDecision({ tab: { attrs: {}, url: "https://example.com", title: "Example" }, intoNotes: true });
  assert.equal(plan.action, "capture-url");
  assert.ok(plan.body.includes("https://example.com"));
});

test("Notes keeps one build/loader entry and embeds the sidebar part exactly once", () => {
  assert.equal(MANIFEST.entry, "ZentralNotes.uc.js");
  assert.equal(MANIFEST.output, "ZentralNotes.standalone.uc.js");
  assert.equal(MANIFEST.version, CURRENT_VERSION);
  assert.equal(THEME.version, CURRENT_VERSION);
  assert.deepEqual(Object.keys(THEME.scripts), [MANIFEST.output], "one Sine script for the one entry");
  const rows = [...CATALOG.matchAll(/file:\s*"additional\/notes\/ZentralNotes\.uc\.js"/g)];
  assert.equal(rows.length, 1, "the full pack catalog has one Notes entry");
  const inManifest = MANIFEST.include.filter((file) => file === "zen/ZentralNotesZenSidebar.js");
  assert.equal(inManifest.length, 1, "the sidebar part is embedded exactly once");
  assert.ok(MANIFEST.include.indexOf("zen/ZentralNotesZenSidebar.js") > MANIFEST.include.indexOf("parser/ZentralNotesParserGraph.js"));
  const loads = [...MAIN.matchAll(/loadPart\("additional\/notes\/zen\/ZentralNotesZenSidebar\.js", "notes-zen-sidebar"\)/g)];
  assert.equal(loads.length, 1, "one loader entry for the part");
});

test("the monolith delegates every extracted name and publishes the parts", () => {
  assert.ok(MAIN.includes("ZEN_SIDEBAR_PART.createZenSidebar(ZEN_DEPS, ZEN_CONFIG)"));
  assert.ok(MAIN.includes("ZEN_SIDEBAR_PART, ZEN_UI"), "the test seam publishes the parts");
  for (const name of NAMES)
    assert.ok(MAIN.includes("if (ZEN_SIDEBAR_PART) return ZEN_UI." + name), name + " delegates through the part");
});

function boot(withPart) {
  const seam = {};
  const parts = { "notes-calendar": C, "notes-calendar-ui": UI, "notes-parser": PARSER };
  if (withPart) parts["notes-zen-sidebar"] = ZEN;
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

test("the core seam is unchanged and uses the sidebar part when present", () => {
  const core = boot(true);
  assert.equal(core.ZEN_SIDEBAR_PART, ZEN);
  assert.ok(core.ZEN_UI && typeof core.ZEN_UI === "object", "the bound sidebar UI is published");
  assert.equal(typeof core.parseZenUrl, "function");
  assert.deepEqual(plain(core.parseZenUrl("about:blank#zn-note:A%20B")), { kind: "note", id: "A B" });
  assert.equal(core.zenNoteUrl("A B"), "about:blank#zn-note:A%20B");
  assert.equal(core.cleanZenMode("all"), "all");
  assert.deepEqual(plain(core.planRootDedupe([{ foreign: 0 }, { foreign: 1 }])), { adopt: 0, remove: [], release: [1] });
  assert.equal(core.notesSubId("f:a/b"), "bgalazka-zentral-notes-sub_a_b");
  assert.equal(core.filterSessionFilePayload("plain text"), "plain text");
});

test("a host without the sidebar part keeps the old inline answers", () => {
  const core = boot(false);
  assert.equal(core.ZEN_SIDEBAR_PART, null);
  assert.equal(core.ZEN_UI, null);
  assert.deepEqual(plain(core.parseZenUrl("about:blank#zn-note:A%20B")), { kind: "note", id: "A B" });
  assert.equal(core.zenNoteUrl("A B"), "about:blank#zn-note:A%20B");
  assert.equal(core.cleanZenMode("all"), "all");
  assert.deepEqual(plain(core.planRootDedupe([{ foreign: 0 }, { foreign: 1 }])), { adopt: 0, remove: [], release: [1] });
  assert.equal(core.notesSubId("f:a/b"), "bgalazka-zentral-notes-sub_a_b");
  assert.equal(core.filterSessionFilePayload("plain text"), "plain text");
});

console.log(`\nnotes-zen-sidebar-part (${passed} passed)`);
