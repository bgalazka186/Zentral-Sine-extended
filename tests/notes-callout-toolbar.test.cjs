"use strict";
/* T3.5: the callout toolbar button. Two things were LEFT from the audit:
 *   1. a primary click must insert the LAST-USED callout (remembered per window, never stored), and
 *   2. the picker must offer the extended kinds the old spec named — `[!faq]-` (a foldable question), `[!bingo]`,
 *      `[!poll]` — which the parser already read but the toolbar never listed.
 * The rule this file pins: the menu and the parser must agree. Every kind the picker offers has to read back as
 * itself, so adding a kind to one list without the other is a failure here, not a surprise in a note. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(root, "additional/notes/ZentralNotes.uc.js"), "utf8");
const flavors = require(path.join(root, "additional/notes/flavors/ZentralNotesFlavors.js"));

const seam = {};
const win = {
  __zentralNotesTestSeam: seam,
  ZentralRuntime: { register() {} },
  document: {},
  requestAnimationFrame() {},
  cancelAnimationFrame() {},
  setTimeout,
  clearTimeout,
};
win.window = win;
vm.runInNewContext(SRC, {
  window: win,
  document: {},
  globalThis: { Services: {} },
  chrome: {},
  console,
  URL,
  Date,
  JSON,
  Math,
  Promise,
  RegExp,
  Number,
  String,
  Array,
  Object,
  Map,
  Set,
  setTimeout,
  clearTimeout,
});
const c = seam.core;
const plain = (v) => JSON.parse(JSON.stringify(v));

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok -", name);
}

// The parser's view of a body, through the same entry point a note uses (the flavors part owns calloutKind).
const blocksOf = (body) => c.parseMarkdown ? c.parseMarkdown(body, {}) : null;

test("every kind the picker offers reads back as itself", () => {
  assert.ok(c.CALLOUT_KINDS.length >= 15, "the classic set is still there");
  const kinds = c.CALLOUT_KINDS.map(([k]) => k);
  // The three the old spec named and the toolbar did not offer.
  for (const kind of ["bingo", "poll"]) {
    assert.ok(kinds.includes(kind), kind + " is offered by the picker");
    const inserted = c.insertCallout("body", 0, 4, kind);
    assert.equal(inserted.text, "> [!" + kind.toUpperCase() + "]\n> body", kind + " writes the marker the parser reads");
    assert.deepEqual(plain(flavors.calloutKind(kind, null)), { kind, type: kind, known: true },
      kind + " is a kind the parser knows, not an unknown type wearing a note's look");
  }
  // Every kind must be a kind, not an alias that parses back as something else (that is why `faq` is not in this list:
  // it is `question` with a fold marker, and is offered that way instead).
  for (const [kind] of c.CALLOUT_KINDS) {
    const back = flavors.calloutKind(kind, null);
    assert.ok(back, kind + " is readable");
    assert.equal(back.kind, kind, kind + " parses back as itself, not as " + back.kind);
  }
});

test("the fold is offered on every kind that reads one, and on no kind that does not", () => {
  for (const kind of ["note", "tip", "important", "warning", "caution", "info", "question"]) {
    assert.ok(c.CALLOUT_FOLDABLE.includes(kind), kind + " is foldable");
    const closed = c.insertCallout("body", 0, 4, kind, "-");
    assert.equal(closed.text, "> [!" + kind.toUpperCase() + "]-\n> body", kind + " closes");
    const open = c.insertCallout("body", 0, 4, kind, "+");
    assert.equal(open.text, "> [!" + kind.toUpperCase() + "]+\n> body", kind + " opens");
  }
  assert.equal(c.CALLOUT_FOLDABLE.includes("bingo"), false, "a kind with no fold is not offered one");
  // The old spec's `[!faq]-` spelling is the question kind folded, which is what the flavors table says.
  assert.equal(flavors.calloutKind("faq", null).kind, "question", "faq is question with its own name kept");
  assert.equal(c.insertCallout("body", 0, 4, "question", "-").text, "> [!QUESTION]-\n> body",
    "so the menu's foldable entry for Question is exactly the [!faq]- the spec asked for");
});

test("a plain click inserts the last-used callout, per window and never stored", () => {
  // A habit, not a setting: nothing in this file may write a preference for it.
  assert.ok(/const calloutMemory = \{ kind: "note", fold: "" \};/.test(SRC), "the memory is a plain object in the window");
  assert.ok(!/setStringPref\([^)]*callout/i.test(SRC), "and it is never written to prefs");
  // Reset for this case: the module object is shared by every test in this file (one vm), so a previous case that
  // inserted a kind already moved the memory. A FRESH window starts on Note — that is what DEFAULTS says.
  c.calloutMemory.kind = "note";
  c.calloutMemory.fold = "";
  assert.match(SRC, /const calloutMemory = \{ kind: "note", fold: "" \};/, "and that is the declared initial value");
  // Inserting one kind moves what the next plain click will use.
  c.insertCallout("body", 0, 4, "warning");
  assert.equal(c.calloutMemory.kind, "warning", "the last-used kind is remembered");
  c.insertCallout("body", 0, 4, "bingo");
  assert.equal(c.calloutMemory.kind, "bingo", "including the extended kinds");
  // A kind change on an existing callout counts too: it is what the person last chose.
  c.insertCallout("> [!NOTE]\n> hi", 3, 3, "tip");
  assert.equal(c.calloutMemory.kind, "tip");
  // A fold is remembered with it, so a tap after "Foldable, closed" folds again.
  c.insertCallout("body", 0, 4, "question", "-");
  assert.equal(c.calloutMemory.kind, "question");
  assert.equal(c.calloutMemory.fold, "-", "the fold travels with the kind");
});

test("the toolbar's tap uses the callout under the caret before the remembered one", () => {
  // The handler is real UI, so the contract is read from the source: one function, one decision, in that order.
  const start = SRC.indexOf("const insertCalloutFromToolbar = () => {");
  assert.ok(start > 0, "the tap handler exists");
  const body = SRC.slice(start, SRC.indexOf("};", start) + 2);
  assert.match(body, /calloutAtCaret\(\)/, "it looks at the caret first");
  assert.match(body, /at\.kind/, "and uses what is there");
  assert.match(body, /insertLastCallout\(\)/, "only falling back to the remembered kind");
  // The caret reader understands a marker with and without a fold, and refuses anything else.
  const caret = SRC.slice(SRC.indexOf("const calloutAtCaret = () => {"));
  const reader = caret.slice(0, caret.indexOf("};") + 2);
  // Source-slice assertions search the declaration text, never an escaped regex of a regex (that trap cost a cycle).
  assert.ok(reader.includes("[!([a-z][\\w-]*)"), "it reads a callout marker of any kind name");
  assert.ok(reader.includes('m[2] === "-"'), "and the fold marker after it");
  // Where the one-click callout lives. NOT on the Quote button: a toolbar button and its shortcut must always give
  // the same text (tests/notes-writing-ui.test.cjs enforces it), so Quote stays a quote and the click gets its own
  // More-menu entry, with the picker right below it.
  assert.ok(/\[tQuote, fmt\.quote, calloutVariants\]/.test(SRC), "the Quote button keeps its plain-quote meaning");
  // The picker keeps the name other menus and tests reach it by; the one-click entry is the line below it and
  // names the kind, so the person knows what a click will insert before clicking.
  assert.match(SRC, /label: "Callout\\u2026", action: \(\) => queueMicrotask\(showCalloutMenu\)/, "the picker keeps its old entry");
  assert.match(SRC, /label: "Callout " \+ calloutLabel\(calloutMemory\.kind\)\.toLowerCase\(\).* \+ " \(last used\)", action: needEdit\(insertCalloutFromToolbar\)/, "and the last-used click sits beside it, naming its kind");
  assert.match(SRC, /action: needEdit\(insertCalloutFromToolbar\)/, "and that click runs the last-used callout");
  assert.ok(/onHold: \(\) => \{ const items = variants\(\);/.test(SRC), "and the Quote long press still lists the kinds");
});

test("the picker lists every kind, hiding the ones the person hid", () => {
  const start = SRC.indexOf("function showCalloutMenu() {");
  const menu = SRC.slice(start, SRC.indexOf("listen(tSettings", start));
  assert.match(menu, /CALLOUT_KINDS\.filter\(\(\[k\]\) => !hiddenTools\(\)\.has\(calloutId\(k\)\)\)/, "every kind, minus hidden ones");
  assert.match(menu, /CALLOUT_FOLDABLE\.filter/, "the fold entries follow the same hiding rule");
  assert.match(menu, /flatMap\(\(k\) => \{/, "two entries per foldable kind: closed and open");
  // The `[!note]-`/`[!note]+` pair that used to be hard-coded is gone: it is now one case of the general list.
  assert.ok(!/label: "Foldable, closed  \[!note\]-"/.test(menu), "the hard-coded note-only fold rows are gone");
});

test("the extended kinds are hideable like every other tool", () => {
  for (const kind of ["bingo", "poll"]) {
    assert.ok(c.HIDEABLE_TOOLS.some(([id]) => id === c.calloutId(kind)),
      kind + " can be hidden from the toolbar, because the hideable list is derived from the same set");
  }
});

console.log("\nPASS notes-callout-toolbar (" + passed + " tests)");
