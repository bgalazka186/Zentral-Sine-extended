"use strict";
/* Cycle F (cheap and fast) regression tests for Zentral Notes.
 * Pure helpers added in Cycle F of TODO_notes_roadmap.md (counter, ...). Fake DOM only: nothing here proves live Zen behaviour.
 * UI assertions use the shared fake DOM; actual Zen/Gecko layout and filesystem permissions still need live testing. */
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const dom = require("./helpers/fake-dom.cjs")();
const { El, Ev, document, raf } = dom;
const win = {
  document,
  ZentralRuntime: { register() {} },
  __zentralNotesTestSeam: {},
  requestAnimationFrame: (fn) => raf.push(fn),
  cancelAnimationFrame() {},
  setTimeout,
  clearTimeout,
  innerWidth: 1200,
  innerHeight: 800,
  addEventListener() {},
  removeEventListener() {},
};
win.window = win;
vm.runInNewContext(source, {
  window: win,
  document,
  Event: Ev,
  globalThis: { Services: {} },
  ChromeUtils: {},
  console,
  URL,
  Date,
  JSON,
  Math,
  Promise,
  RegExp,
  Number,
  Map,
  Set,
  setTimeout,
  clearTimeout,
  navigator: { platform: "Linux" },
});

const c = win.__zentralNotesTestSeam.core;

let passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }
const at = (h, m) => new Date(2026, 10, 3, h, m).getTime();

test("captureLine: bullet-time / plain / task, one line, empty = nothing", () => {
  assert.equal(c.captureLine("buy milk", "bullet-time", at(9, 5)), "- 09:05 buy milk");
  assert.equal(c.captureLine("  a\n b  ", "plain", at(9, 5)), "a b");
  assert.equal(c.captureLine("call Ann", "task", at(9, 5)), "- [ ] call Ann");
  assert.equal(c.captureLine("   ", "task", at(9, 5)), "");
  assert.equal(c.captureLine("x", "bogus", at(23, 59)), "- 23:59 x", "unknown format = default");
});

test("insertLineAt: end of note, mid-note, no glued lines, no blank gaps", () => {
  assert.equal(c.insertLineAt("", "- a"), "- a\n");
  assert.equal(c.insertLineAt("# T", "- a"), "# T\n- a\n");
  assert.equal(c.insertLineAt("# T\n", "- a"), "# T\n- a\n");
  assert.equal(c.insertLineAt("## D\n\n## E", "- a", 4), "## D\n- a\n\n## E");
  assert.equal(c.insertLineAt("x", "", 0), "x");
});

test("journal section + capture: the line lands at the end of that day's section", () => {
  const ms = new Date(2026, 10, 3).getTime();
  const r = c.journalSection("# Journal\n\n## 2026-11-02 Mon\n\nold\n", "2026-11-03", ms);
  const out = c.insertLineAt(r.body, "- 10:00 hi", r.caret);
  assert.match(out, /## 2026-11-03 [A-Za-z]+\n\n- 10:00 hi\n$/);
  const r2 = c.journalSection(out, "2026-11-02", ms);
  assert.match(c.insertLineAt(out, "- 10:01 x", r2.caret), /old\n- 10:01 x\n\n## 2026-11-03/);
});

test("pseudo Triple View CSS exists and the seed/new-button prefs are in the schema", () => {
  const css = fs.readFileSync(path.join(__dirname, "../extension/panels/browsers/ZentralBrowserIntegrations.css"), "utf8");
  assert.match(css, /bgalazka-notes-pseudo="true"\]\[bgalazka-quad-view="true"\]\s+#zen-app-panel-slider/);
  const s = JSON.parse(fs.readFileSync(path.join(__dirname, "../additional/notes/settings.json"), "utf8")).schema;
  const get = (k) => s.find((x) => x.property === "zen.workspace.zentral.notes." + k);
  assert.equal(get("zen_folder_new_button").defaultValue, false);
  assert.equal(get("agenda_folder").defaultValue, false, "virtual Agenda is opt-in");
  assert.equal(get("agenda_position").defaultValue, "above");
  assert.equal(get("agenda_days").defaultValue, 4);
  assert.equal(get("quick_capture_format").defaultValue, "bullet-time");
});
const N = (id, body, extra = {}) => ({ id, body, updated: 1, trashed: 0, ...extra });
test("findBrokenLinks: missing note, trashed note, missing heading, unresolved [[title]]; code and images ignored", () => {
  const notes = [
    N("a", "# A\n[ok](b.md) [gone](zz.md) [bin](t.md) [h](b.md#nope) [good](b.md#sec) [[B]] [[Nobody|who]]\n`[code](zz.md)`\n![img](zz.md)\n"),
    N("b", "# B\n## Sec\n"),
    N("t", "# T\n", { trashed: 5 }),
  ];
  const r = c.findBrokenLinks(notes);
  assert.deepEqual(Array.from(r, (x) => x.kind + ":" + (x.targetId || x.title)), ["missing-note:zz", "trashed:t", "missing-heading:b", "missing-note:Nobody"]);
  assert.equal(r.every((x) => x.noteId === "a"), true);
  assert.equal(r[0].line, 1);
  assert.equal(c.findBrokenLinks([N("x", "# X\n```\n[a](q.md)\n```\n")]).length, 0);
});

test("unlinkBroken keeps the words, only outside code", () => {
  const body = "see [gone](zz.md) and [[Nobody|who]]\n`[gone](zz.md)`\n";
  const [a, b] = c.findBrokenLinks([N("a", "# A\n" + body)]);
  assert.equal(c.unlinkBroken(a.raw && "# A\n" + body, a), "# A\nsee gone and [[Nobody|who]]\n`[gone](zz.md)`\n");
  assert.equal(c.unlinkBroken("x [[Nobody|who]] y", b), "x who y");
});

test("Zen safeguards: every Zen-side handler is scoped to our own tabs; teardown exists", () => {
  const js = fs.readFileSync(path.join(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
  assert.match(js, /const isOurTab = /);
  assert.match(js, /if \(!tab \|\| !isOurTab\(tab\)\) return;/, "mouse handler");
  assert.match(js, /if \(!isOurTab\(tab\)\) \{[^}]*return;\s*\}\s*const prev = ev\.detail\?\.previousTab;/, "TabSelect handler");
  assert.match(js, /window\.setTimeout\(\(\) => \{\s*zenSelectTimer = 0;/, "re-selection is deferred, never inside TabSelect");
  assert.match(js, /if \(zenMode\(\) === "off"\) zenTeardown\(\);/);
  assert.match(js, /document\.querySelectorAll\?\.\("tab\[" \+ NOTES_ATTR \+ "\]"\)/, "removeAll sweeps marked tabs anywhere");
});
test("applyTemplate: date/time/title filled, first {{cursor}} is the caret, unknown variables stay", () => {
  const now = new Date(2026, 10, 3, 9, 5).getTime();
  const r = c.applyTemplate("# {{title}}\n{{date}} {{time}}\n- {{cursor}}\n{{cursor}}x {{nope}}", { now, title: " My\nthing " });
  assert.equal(r.body, "# My thing\n2026-11-03 09:05\n- \nx {{nope}}");
  assert.equal(r.caret, "# My thing\n2026-11-03 09:05\n- ".length);
  assert.equal(c.applyTemplate("plain", {}).caret, 5, "no cursor token = caret at the end of the first part");
  assert.equal(c.templateNeedsTitle("# {{title}}"), true);
  assert.equal(c.BUILTIN_TEMPLATES.some((template) => template.id === "zn-tpl-daily"), false, "the legacy Daily template is replaced by the Agenda folder");
});

test("templateChoices: user templates first, built-ins until a note with the same id exists", () => {
  const user = N("u1", "# Retro\n", { folder: "templates" });
  const gone = N("u2", "# Old\n", { folder: "templates", trashed: 3 });
  const other = N("u3", "# Not a template\n", { folder: "" });
  const edited = N("zn-tpl-daily", "# my daily\n", { folder: "templates" });
  const names = Array.from(c.templateChoices([user, gone, other, edited]), (t) => t.name + (t.builtin ? "*" : ""));
  assert.deepEqual(names, ["Retro", "my daily", "Meeting*", "Checklist*", "Project*"]);
  const trashedBuiltin = N("zn-tpl-meeting", "# x\n", { folder: "templates", trashed: 1 });
  assert.equal(Array.from(c.templateChoices([trashedBuiltin]), (t) => t.name).includes("Meeting"), false, "a trashed built-in stays gone");
  for (const t of c.BUILTIN_TEMPLATES) assert.doesNotThrow(() => c.parseBlocks(c.applyTemplate(t.body, { title: "T" }).body), t.id);
});

test("hold variants: Quote and the More caret list the callout kinds on a long press, a tap is unchanged", () => {
  const js = fs.readFileSync(path.join(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
  assert.match(js, /\[tQuote, fmt\.quote, calloutVariants\]/);
  assert.match(js, /\[tInsert, \(\) => showInsertMenu\(\), calloutVariants, true\]/);
  assert.match(js, /onTap: noEdit \? tap : needEdit\(tap\)/, "the More menu opens outside edit mode, as before");
  assert.match(js, /if \(items\.length\) showMenu\(btn, items\); else/, "all callouts hidden: a hold falls back to the tap");
  assert.doesNotMatch(js, /\[tBullet, fmt\.bullet\], \[tQuote, fmt\.quote\]/, "quote is no longer a plain button");
});

test("W9 default_view: last keeps the stored mode, others force it, junk = last; pref is in schema, UI and standalone", () => {
  assert.equal(c.startMode("last", "read"), "read");
  assert.equal(c.startMode("split", "edit"), "split");
  assert.equal(c.startMode("read", "split"), "read");
  assert.equal(c.startMode("edit", "split"), "edit");
  assert.equal(c.startMode("bogus", "split"), "split", "unknown value behaves like last");
  assert.equal(c.startMode(undefined, "edit"), "edit");
  const root = path.join(__dirname, "..");
  const schema = JSON.parse(fs.readFileSync(path.join(root, "additional/notes/settings.json"), "utf8")).schema;
  const item = schema.find((x) => x.property === "zen.workspace.zentral.notes.default_view");
  assert.equal(item.defaultValue, "last");
  assert.deepEqual(item.options.map((o) => o.value), Array.from(c.DEFAULT_VIEWS));
  const js = fs.readFileSync(path.join(root, "additional/notes/ZentralNotes.uc.js"), "utf8");
  assert.match(js, /id: "defaultView".*kind: "choice", def: "last"/);
  assert.equal((js.match(/startMode\(getPref\(PREF\.DEFAULT_VIEW, "last"\), store\.meta\.mode\)/g) || []).length, 3, "both sheet-open paths + a note opened from outside (tab bar, reminder)");
  const man = JSON.parse(fs.readFileSync(path.join(root, "additional/notes/standalone.json"), "utf8"));
  assert.ok(JSON.stringify(man).includes("notes.default_view"));
});
console.log(`\n${passed} notes cycle G tests passed`);
