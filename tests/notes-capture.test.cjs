"use strict";
/* Capture (selection/page -> note snippet), appearance overrides and their wiring (roadmap step D1).
 * Pure functions run in a VM; the Zen-only parts (context menu, selection reading) are guarded statically. */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "additional/notes/ZentralNotes.uc.js"), "utf8");
const css = fs.readFileSync(path.join(root, "additional/notes/ZentralNotes.css"), "utf8");
const seam = {};
const win = { __zentralNotesTestSeam: seam, ZentralRuntime: { register() {} } };
win.window = win;
vm.runInNewContext(src, { window: win, globalThis: { Services: {} }, ChromeUtils: {}, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, console });
const c = seam.core;
let passed = 0;
const test = (n, fn) => { fn(); passed++; console.log("ok -", n); };
const NOW = new Date(2026, 9, 30, 14, 5).getTime();
const base = { text: "Hello world", title: "Page", url: "https://ex.com/a#old", now: NOW };

test("quote with date, source link and highlight fragment", () => {
  const s = c.buildCapture({ ...base, opts: {} });
  assert.equal(s, "2026-10-30 \u00b7 [Page](https://ex.com/a#:~:text=Hello%20world)\n\n> Hello world");
});
test("time, no link, plain text, checkbox", () => {
  assert.equal(c.buildCapture({ ...base, opts: { time: true, link: false, style: "plain" } }), "2026-10-30 \u00b7 14:05 \u00b7 Page\n\nHello world");
  assert.equal(c.buildCapture({ ...base, opts: { checkbox: true, style: "bullet", link: false } }), "- [ ] 2026-10-30 \u00b7 Page\n\n- Hello world");
  assert.equal(c.buildCapture({ ...base, opts: { date: false, source: false, link: false, checkbox: true } }), "- [ ] Hello world");
});
test("styles: highlight, callout, bullet multi-line; unknown style falls back to quote", () => {
  const o = { date: false, source: false, link: false };
  assert.equal(c.buildCapture({ ...base, text: "a\nb", opts: { ...o, style: "highlight" } }), "==a b==");
  assert.equal(c.buildCapture({ ...base, text: "a\nb", opts: { ...o, style: "callout" } }), "> [!NOTE]\n> a\n> b");
  assert.equal(c.buildCapture({ ...base, text: "a\nb", opts: { ...o, style: "bullet" } }), "- a\n  b");
  assert.equal(c.buildCapture({ ...base, opts: { ...o, style: "zzz" } }), "> Hello world");
});
test("long selection uses start,end fragment; unsafe address is dropped; page without text is one line", () => {
  const long = "one two three four five six seven eight nine ten eleven";
  assert.match(c.captureFragmentUrl("https://ex.com/", long), /#:~:text=one%20two%20three%20four,eight%20nine%20ten%20eleven$/);
  assert.equal(c.captureFragmentUrl("https://ex.com/", "a-b, c"), "https://ex.com/#:~:text=a%2Db%2C%20c");
  assert.ok(!/\]\(/.test(c.buildCapture({ ...base, url: "javascript:alert(1)", opts: {} })), "no link for javascript:");
  assert.equal(c.buildCapture({ ...base, text: "", opts: { date: false, highlight: true } }), "[Page](https://ex.com/a#old)");
});
test("insertCapture: end, top, below a title, empty note", () => {
  assert.equal(c.insertCapture("x\n\n", "S"), "x\n\nS\n");
  assert.equal(c.insertCapture("", "S"), "S\n");
  assert.equal(c.insertCapture("# Inbox\n\nold", "S", "top"), "# Inbox\n\nS\n\nold");
  assert.equal(c.insertCapture("old", "S", "top"), "S\n\nold");
});
test("findInbox matches the label, ignores trashed notes", () => {
  const list = [{ id: "a", label: "inbox", trashed: 5 }, { id: "b", label: "Inbox", trashed: 0 }];
  assert.equal(c.findInbox(list, "Inbox").id, "b");
  assert.equal(c.findInbox([], "Inbox"), null);
});
test("lookOverrides: nothing set = nothing applied; values and flags; bad input ignored", () => {
  assert.equal(JSON.stringify(c.lookOverrides(() => "")), '{"vars":{},"flags":[]}');
  assert.equal(JSON.stringify(c.lookOverrides(() => "auto")), '{"vars":{},"flags":[]}');
  const P = c.PREF;
  const vals = { [P.LOOK_RADIUS]: "16", [P.LOOK_BORDER]: "99", [P.LOOK_BG]: "#112233", [P.LOOK_TEXT]: "red", [P.LOOK_FONT]: "serif", [P.LOOK_BTN_STYLE]: "filled", [P.LOOK_SHADOW]: "none", [P.LOOK_EDITOR_FONT]: "mono" };
  const r = c.lookOverrides((k) => vals[k] ?? "");
  assert.equal(r.vars["--zentral-notes-ov-radius"], "16px");
  assert.equal(r.vars["--zentral-notes-ov-bg"], "#112233");
  assert.ok(!("--zentral-notes-ov-border" in r.vars) && !("--zentral-notes-ov-text" in r.vars), "out of range / non-hex ignored");
  assert.equal([...r.flags].sort().join(), ["bg", "btn-filled", "editor-font", "font", "radius", "shadow"].sort().join());
  for (const k of Object.keys(r.vars)) assert.ok(c.LOOK_VARS.includes(k), k + " is cleaned up");
});
test("every look flag has a CSS rule; every look/capture pref is in the schema, layout and standalone order", () => {
  for (const f of ["radius","border","shadow","bg","opacity","text","accent","line","font","editor-font","padding","heading","btn-size","btn-radius","btn-filled","btn-outlined","btn-fill","btn-border","btn-icon"])
    assert.ok(css.includes(`zentral-notes-ov~="${f}"`), "css rule for " + f);
  const settings = JSON.parse(fs.readFileSync(path.join(root, "additional/notes/settings.json"), "utf8"));
  const layout = JSON.parse(fs.readFileSync(path.join(root, "extension/settings/layout.json"), "utf8"));
  const standalone = JSON.parse(fs.readFileSync(path.join(root, "additional/notes/standalone.json"), "utf8"));
  const keys = Object.values(c.PREF).filter((k) => /\.(look|capture)_/.test(k));
  assert.ok(keys.length >= 30);
  for (const k of keys) {
    assert.ok(settings.schema.some((s) => s.property === k), "schema " + k);
    assert.ok(layout.order.includes(k), "layout " + k);
    assert.ok(standalone.preferenceOrder.includes(k), "standalone " + k);
  }
});
test("Zen wiring: context menu, global shortcuts, unload cleanup", () => {
  assert.match(src, /contentAreaContextMenu/);
  assert.match(src, /id: "captureQuick"[^}]*global: true/);
  assert.match(src, /id: "captureInbox"[^}]*global: true/);
  assert.match(src, /removeEventListener\("popupshowing", onCtxShowing\)/);
  assert.match(src, /store\.update\(id, insertCapture/);
});
console.log(`\n${passed} notes capture tests passed`);
