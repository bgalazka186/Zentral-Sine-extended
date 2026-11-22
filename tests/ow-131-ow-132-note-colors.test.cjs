"use strict";
/* OW-131 / OW-132 RED -> GREEN: a composer color override inherits the
 * category colour without mutating it, and every DEMO note gets a stable,
 * distinct colour only when it is first installed. Pure/store/source checks;
 * live composer and Help-folder colours remain an OWNER GATE. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const NOTES = read("additional/notes/ZentralNotes.uc.js");
const CAL = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const dom = require("./helpers/fake-dom.cjs")();
const win = { document: dom.document, ZentralRuntime: { register() {} }, __zentralNotesTestSeam: {} };
win.window = win;
vm.runInNewContext(NOTES, {
  window: win,
  document: dom.document,
  globalThis: { window: win, document: dom.document, Services: {} },
  ChromeUtils: {},
  console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, WeakMap, WeakSet, Symbol, Reflect,
  setTimeout, clearTimeout,
});
const c = win.__zentralNotesTestSeam.core;
const plain = (v) => JSON.parse(JSON.stringify(v));

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

try {
  test("1. a pure calendar-colour resolver keeps category inheritance and an item override separate", () => {
    assert.equal(typeof CAL.resolveCalendarItemColor, "function");
    const inherited = plain(CAL.resolveCalendarItemColor({ itemColor: "", noteColor: "", categoryColor: "blue" }));
    assert.equal(inherited.override, "");
    assert.equal(inherited.inherited, "blue");
    assert.equal(inherited.effective, "blue");
    assert.equal(inherited.effectiveHex, "#5aa9ff");
    assert.equal(inherited.source, "category");
    assert.equal(inherited.categoryPreserved, true);
    const custom = plain(CAL.resolveCalendarItemColor({ itemColor: "#ff0000", noteColor: "", categoryColor: "blue" }));
    assert.equal(custom.override, "#ff0000");
    assert.equal(custom.inherited, "blue");
    assert.equal(custom.effective, "#ff0000");
    assert.equal(custom.effectiveHex, "#ff0000");
    assert.equal(custom.source, "item");
    assert.equal(custom.categoryPreserved, true);
    const fallback = plain(CAL.resolveCalendarItemColor({ itemColor: "none", noteColor: "#123456", categoryColor: "blue" }));
    assert.equal(fallback.source, "note");
    assert.equal(fallback.inherited, "#123456");
  });

  test("2. composeCalendarItem stores the override while keeping the selected category", () => {
    const item = CAL.composeCalendarItem({
      kind: "reminder", startDate: "2026-11-18", startTime: "09:00", summary: "Color probe",
      category: "Work", color: "#ff0000", tz: "UTC",
    }, Date.UTC(2026, 10, 18, 8, 0, 0));
    assert.ok(item, "the composer produced an item");
    assert.equal(item.x.category, "Work");
    assert.equal(item.x.color, "#ff0000");
    const cleared = CAL.composeCalendarItem({
      item, id: item.id, kind: "reminder", startDate: "2026-11-18", startTime: "09:00",
      summary: "Color probe", category: "Work", color: "none", tz: "UTC",
    }, Date.UTC(2026, 10, 18, 8, 0, 0));
    assert.equal(cleared.x.category, "Work");
    assert.equal(cleared.x.color, undefined, "Inherit removes only the item override");
  });

  test("3. the composer exposes a colour well, an Inherit control and the resolved preview", () => {
    for (const term of [
      "zn-color-well",
      "zn-cal-compose-color-inherit",
      "customColor",
      "resolveCalendarItemColor",
      "color: customColor",
      "colorPreview",
      "colorLabel",
    ]) assert.ok(NOTES.includes(term), term + " is wired into the composer");
    // OW-133: the composer's override is chosen in the in-app well. A native `input[type=color]` is a platform
    // dialog anchored to the control: hiding the card underneath it lost the picked colour and left its grab
    // behind, so the composer must not use one (tests/ow-133-no-native-popups.test.cjs enforces this everywhere).
    assert.match(NOTES, /const colorWellCtl = colorWell\(/);
    assert.match(NOTES, /colorWellCtl\.sync\(/);
    assert.match(NOTES, /colorInheritBtn\.addEventListener\("click"/);
    assert.match(NOTES, /resolveCalendarItemColor\(\{[\s\S]{0,200}customColor/);
    assert.match(read("additional/notes/i18n/en.js"), /"compose\.color\.custom"/);
    assert.match(read("additional/notes/i18n/pl.js"), /"compose\.color\.custom"/);
    assert.match(read("additional/notes/i18n/en.js"), /"compose\.color\.inherit"/);
    assert.match(read("additional/notes/i18n/pl.js"), /"compose\.color\.inherit"/);
    assert.match(read("additional/notes/ZentralNotes.css"), /\.zn-color-well\b/);
  });

  test("4. every DEMO note has a stable, distinct colour and the installer only colours new notes", () => {
    assert.equal(typeof c.demoNoteColorPlan, "function");
    const colors = c.DEMO_NOTES.map((d) => d.color);
    assert.equal(colors.length, c.DEMO_NOTES.length);
    assert.ok(colors.every((color) => c.cleanNoteColor(color) !== "none"), "each demo entry has a real colour");
    assert.equal(new Set(colors).size, colors.length, "no two demo notes share a colour");
    const first = c.DEMO_NOTES[0].id;
    const plan = plain(c.demoNoteColorPlan(c.DEMO_NOTES, [first]));
    assert.equal(plan.length, c.DEMO_NOTES.length - 1, "an already-installed demo note is skipped");
    assert.ok(!plan.some((row) => row.id === first));
    assert.deepEqual(plain(c.demoNoteColorPlan(c.DEMO_NOTES, [])), plain(c.demoNoteColorPlan(c.DEMO_NOTES, [])), "the plan is deterministic");
    assert.equal(c.demoNoteColorPlan(c.DEMO_NOTES, [])[1].color, c.DEMO_NOTES[1].color);
  });

  test("5. ensureNote accepts a validated create-time color and the installer passes the plan through", () => {
    assert.match(NOTES, /ensureNote\(id, body, folder = "", opts = \{\}\)/);
    assert.match(NOTES, /color: cleanNoteColor\(opts\.color\)/);
    assert.match(NOTES, /for \(const row of demoNoteColorPlan\(DEMO_NOTES[\s\S]{0,300}ensureNote\(/);
    assert.match(NOTES, /ensureNote\(row\.id, row\.body, folder, \{ color: row\.color \}\)/);
    assert.doesNotMatch(NOTES, /store\.update\(d\.id[\s\S]{0,120}color/, "reinstall never recolours an edited demo note");
  });

  console.log(`OW-131/OW-132 note color tests passed (${passed})`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
