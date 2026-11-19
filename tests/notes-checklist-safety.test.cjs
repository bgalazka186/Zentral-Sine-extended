"use strict";
/* Regression fixtures: links / code / comment markers inside checklist items must never throw, and date keys must not use toISOString. */
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const root = path.resolve(__dirname, "../additional/notes");
const source = fs.readFileSync(path.join(root, "ZentralNotes.uc.js"), "utf8");
const seam = {};
const win = { __zentralNotesTestSeam: seam, ZentralRuntime: { register() {} } };
win.window = win;
vm.runInNewContext(source, { window: win, globalThis: { Services: {} }, ChromeUtils: {}, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, console });
const c = seam.core;
let passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok -", name); }

const lines = [
  "- [ ] Call [Alex](user://42) re: project",
  "- [x] Run `npm test` and [docs](https://example.com/a_b_(c))",
  "- [ ] Task <!-- r-id: 123e4567-e89b-12d3-a456-426614174000 -->",
  "- [ ] [[Note#Heading]] and **bold** with `code [x]`",
  "- [ ] ",
  "- [ ]",
  "- [x] [unclosed link(",
  "* [ ] star bullet [a](b)",
  "1. [ ] numbered [a](b)",
];
test("checklist lines with links, code and comment markers parse without throwing", () => {
  for (const l of lines) assert.doesNotThrow(() => c.parseBlocks(l), l);
  assert.doesNotThrow(() => c.parseBlocks(lines.join("\n")));
});
test("a task line keeps its link text and its r-id marker survives in the source text", () => {
  const blocks = c.parseBlocks(lines[0]);
  assert.ok(blocks.length >= 1);
  assert.match(JSON.stringify(blocks), /Alex/);
  assert.ok(lines[2].includes("<!-- r-id: 123e4567-e89b-12d3-a456-426614174000 -->"));
});
test("date keys come from local fields: no toISOString().slice(0, 10) key anywhere in Notes sources", () => {
  for (const f of ["ZentralNotes.uc.js", "calendar/ZentralNotesCalendar.js"]) {
    const src = fs.readFileSync(path.join(root, f), "utf8");
    const hits = src.split("\n").filter((l) => /toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/.test(l) && !/catch\s*\(/.test(l));
    assert.deepEqual(hits, [], f);
  }
});
console.log(passed + " passed");
