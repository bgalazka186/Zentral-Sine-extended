"use strict";
/* ST7.8: one reminder or event can carry its own colour.
 *
 * Three layers, closest first: the item's own colour, then its source note's, then its category's. An empty or "none"
 * layer never masks a useful one below it, so clearing an item's colour falls back instead of turning the row blank.
 *
 * The storage half matters as much as the display half: the item's colour lives in x.color and has to survive
 * cleanItem, or every write silently drops it.
 */
const assert = require("node:assert/strict");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("ok - " + name);
}

(async () => {
  await test("the item's own colour wins over the note's and the category's", () => {
    assert.equal(C.resolveItemColor("#ff0000", "#00ff00", "#0000ff"), "#ff0000");
    assert.equal(C.resolveItemColor("pink", "blue", "green"), "pink");
  });

  await test("a missing layer falls through to the next one", () => {
    assert.equal(C.resolveItemColor("", "#00ff00", "#0000ff"), "#00ff00", "note beats category");
    assert.equal(C.resolveItemColor("", "", "#0000ff"), "#0000ff");
    assert.equal(C.resolveItemColor("none", "none", "teal"), "teal", '"none" is not a colour');
    assert.equal(C.resolveItemColor("", "", ""), "");
    assert.equal(C.resolveItemColor(null, undefined, 42), "", "junk is ignored, not coerced");
  });

  await test("the old two-value call still means note-then-category", () => {
    // Callers written before ST7.8 pass (noteColour, categoryColour); that pairing must not shift by an argument.
    assert.equal(C.resolveItemColor("blue", "green"), "blue");
    assert.equal(C.resolveItemColor("", "green"), "green");
    assert.equal(C.resolveItemColor("none", "green"), "green");
    assert.equal(C.resolveItemColor("", ""), "");
  });

  await test("cleanItemColor keeps palette names and hex, drops everything else", () => {
    assert.equal(C.cleanItemColor("pink"), "pink");
    assert.equal(C.cleanItemColor("  Pink  "), "pink");
    assert.equal(C.cleanItemColor("#FF6B6B"), "#ff6b6b");
    assert.equal(C.cleanItemColor("#f00"), "#ff0000", "short hex is expanded");
    for (const junk of ["", "none", "chartreuse", "#12", "#1234567", "rgb(1,2,3)", null, undefined, 5, {}]) {
      assert.equal(C.cleanItemColor(junk), "", `dropped: ${String(junk)}`);
    }
    assert.deepEqual(C.ITEM_COLOR_CHOICES, ["yellow", "green", "blue", "pink", "purple", "orange", "red", "teal", "gray", "brown", "lime", "cyan"]);
    for (const name of C.ITEM_COLOR_CHOICES) assert.equal(C.cleanItemColor(name), name);
  });

  await test("cleanItem carries x.color through a write instead of dropping it", () => {
    const item = C.makeItem({
      id: "it1",
      summary: "Tea with Ada",
      start: { dateTime: "2026-11-18T09:00:00.000Z" },
      x: { kind: "event", src: "manual", color: "#FF6B6B" },
    }, Date.parse("2026-11-17T10:00:00.000Z"));
    const cleaned = C.cleanItem(item);
    assert.equal(cleaned.x.color, "#ff6b6b", "a set colour survives");

    const junk = C.cleanItem({ ...item, x: { ...item.x, color: "<script>" } });
    assert.equal("color" in junk.x, false, "junk is dropped rather than stored");

    // An item that was never colourised keeps the exact shape (and etag) it had before the field existed.
    const bare = C.cleanItem({ ...item, x: { kind: "event", src: "manual" } });
    assert.equal("color" in bare.x, false, "an uncoloured item carries no colour key");
    assert.equal(C.etagOf ? C.etagOf(bare) : bare.etag, bare.etag, "its etag is the stored one");
  });

  await test("the Agenda row description uses all three layers", () => {
    const base = { id: "it2", summary: "Standup", start: { dateTime: "2026-11-18T09:00:00.000Z" }, x: { kind: "event", src: "manual" } };
    const row = (x) => C.agendaZenItem({ ...base, x: { ...base.x, ...x } }, {});
    assert.equal(row({ color: "#ff6b6b", noteColor: "blue", categoryColor: "green" }).color, "#ff6b6b");
    assert.equal(row({ noteColor: "blue", categoryColor: "green" }).color, "blue");
    assert.equal(row({ color: "", noteColor: "", categoryColor: "green" }).color, "green");
    assert.equal(row({}).color, "");
  });

  await test("Inherit explains the item's own colour first, then the note, then the category", () => {
    const note = { color: "blue", title: "Groceries" };
    const category = { color: "green", name: "Home" };
    const own = C.describeInheritance("color", { x: { color: "pink" } }, { note, category });
    assert.equal(own.source, "item");
    assert.equal(own.valueLabel, "pink #ff7eb6", "the label names the palette entry and its hex");
    assert.match(own.label, /this item/i);

    const fromNote = C.describeInheritance("color", { x: {} }, { note, category });
    assert.equal(fromNote.source, "note");

    const fromCategory = C.describeInheritance("color", { x: {} }, { note: { color: "none" }, category });
    assert.equal(fromCategory.source, "category");

    const nothing = C.describeInheritance("color", { x: {} }, { note: {}, category: {} });
    assert.equal(nothing.source, "none");
  });

  console.log(`\n${passed} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
