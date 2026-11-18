"use strict";
/* F0.9: no name in the Notes sources is used without a declaration.
 *
 * Notes is one large file made of nested closures (store, sheet, window host). A function that lives in one closure is
 * invisible in the next, and JavaScript only complains when the line runs. That is how a right-click command, an error
 * path and three Save buttons could each throw a ReferenceError for months: no behaviour test reached those lines.
 * This test reads the source instead of running it, so every line counts, also the ones only a person can reach.
 *
 * Note that `missing?.method()` does NOT protect against an undeclared name; only `typeof missing` does.
 */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { findUndefinedIdentifiers } = require("./helpers/undefined-identifiers.cjs");

const ROOT = path.join(__dirname, "..");
const names = (code, options) => findUndefinedIdentifiers(code, options).map((entry) => entry.name);

// ---- 1. The check itself: a checker that finds nothing proves nothing. -------------------------------------------------
{
  // The exact shape of the defects this test was written for: a name that exists, but in another closure.
  assert.deepEqual(names("function sheet() { function ask() {} return ask; } function host() { return ask(); }"), ["ask"], "a function of a sibling closure is not visible");
  assert.deepEqual(names("function sheet() { const warn = () => {}; } function later() { try { run(); } catch (error) { warn(error); } } function run() {}"), ["warn"], "a logger of a sibling closure is not visible");
  assert.deepEqual(names("function f() { controller?.schedule?.(); }"), ["controller"], "optional chaining does not excuse an undeclared name");
  assert.deepEqual(names("function f() { return typeof controller === 'undefined' ? null : 1; }"), [], "typeof is the one safe probe");

  // Declarations in every position are understood, so real code produces no false alarm.
  assert.deepEqual(names("function f() { return later() + value; } function later() {} var value = 1;"), [], "function and var declarations are hoisted");
  assert.deepEqual(names("const run = () => helper(); const helper = () => 1;"), [], "a closure may use a constant declared further down");
  assert.deepEqual(names("function f({ a, b: [c, ...d], ...e }, g = a, ...h) { return a + c + d + e + g + h; }"), [], "destructured and default parameters");
  assert.deepEqual(names("for (const [key, { value = key }] of pairs) use(key, value); function use() {} var pairs = [];"), [], "loop bindings with defaults");
  assert.deepEqual(names("try { risky(); } catch ({ message }) { report(message); } function risky() {} function report() {}"), [], "a destructured catch parameter");
  assert.deepEqual(names("class Base {} class Item extends Base { static made = 0; #id = Item.made++; get id() { return this.#id; } static { Item.made = 0; } }"), [], "classes, fields and static blocks");
  assert.deepEqual(names("const fn = function self(n) { return n ? self(n - 1) : arguments.length; };"), [], "a named function expression and `arguments`");
  assert.deepEqual(names("outer: for (;;) { break outer; }"), [], "labels are not variables");
  assert.deepEqual(names("const o = { key: 1, method() {}, get value() { return 1; } }; o.other; o?.deep.er;"), [], "property names are not variables");
  assert.deepEqual(names("let a, b; [a, { b }] = [1, { b: 2 }];"), [], "assignment to declared names");

  // Scopes end where the language says they end.
  assert.deepEqual(names("{ let inner = 1; const fixed = 2; } inner; fixed;"), ["inner", "fixed"], "let and const stay inside their block");
  assert.deepEqual(names("if (true) { var lifted = 1; } lifted;"), [], "var leaves its block");
  assert.deepEqual(names("for (let i = 0; i < 1; i++) {} i;"), ["i"], "a loop variable ends with the loop");
  assert.deepEqual(names("try {} catch (error) {} error;"), ["error"], "a catch parameter ends with the handler");
  assert.deepEqual(names("(function named() {})(); named;"), ["named"], "a function expression's own name stays inside it");
  assert.deepEqual(names("function f(a = missing) {} [first, second] = []; count++;"), ["missing", "first", "second", "count"], "defaults, assignment targets and updates are reported");

  // Host globals are an explicit list, and positions point at the source.
  assert.deepEqual(names("window.setTimeout(() => document.title, 0);"), ["window", "document"]);
  assert.deepEqual(names("window.setTimeout(() => document.title, 0);", { globals: ["window", "document"] }), []);
  assert.deepEqual(names("process.exit(require('x'));"), ["process", "require"], "Node's own globals are not assumed for browser code");
  assert.deepEqual(names("import { a } from 'x'; export const b = a; export { b as c };", { sourceType: "module" }), [], "module bindings");
  assert.deepEqual(findUndefinedIdentifiers("const ok = 1;\n  function f() {\n    return ok + missing;\n  }"), [{ name: "missing", line: 3, column: 17 }], "line and column of the use");
}

// ---- 2. The Notes sources. -------------------------------------------------------------------------------------------
// What the host really provides. Everything else must be declared in the file. The lists are kept exact on purpose:
// an entry nobody uses any more would quietly excuse the same name written by mistake later.
const WEB = ["window", "document", "navigator", "performance", "queueMicrotask", "URL", "Event", "Blob", "TextEncoder", "TextDecoder", "DOMParser", "MutationObserver", "ResizeObserver"];
const FIREFOX_CHROME = ["ChromeUtils", "PathUtils", "IOUtils", "Cc", "Ci", "Components"];
const PART = ["window", "module"]; // a pure part: `module.exports` under Node, the module loader on `window` in the browser
const SOURCES = {
  "additional/notes/ZentralNotes.uc.js": [...WEB, ...FIREFOX_CHROME],
  "additional/notes/calendar/ZentralNotesCalendar.js": [...PART, "setTimeout", "clearTimeout", "require"],
  "additional/notes/calendar/ZentralNotesCalendarUI.js": PART,
  "additional/notes/parser/ZentralNotesParserGraph.js": PART,
  "additional/notes/i18n/en.js": PART,
  "additional/notes/i18n/pl.js": PART,
  "additional/notes/i18n/de.js": PART,
  "additional/notes/i18n/registry.js": [...PART, "window"],
  "additional/notes/flavors/ZentralNotesFlavors.js": PART,
  "additional/notes/flavors/ZentralNotesShortcuts.js": PART,
  "additional/notes/paste/ZentralNotesPasteHtml.js": PART,
};

// A new source file must be listed here; the bundle is generated from these files and checked by `build-standalone --check`.
const listed = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) =>
  entry.isDirectory() ? listed(dir + "/" + entry.name) : (/\.(?:js|mjs)$/.test(entry.name) && !/\.standalone\.uc\.js$/.test(entry.name) ? [dir + "/" + entry.name] : []));
assert.deepEqual(listed("additional/notes").sort(), Object.keys(SOURCES).sort(), "every Notes source file is checked (add a new file to SOURCES)");

const problems = [];
for (const [file, globals] of Object.entries(SOURCES)) {
  const code = fs.readFileSync(path.join(ROOT, file), "utf8");
  for (const entry of findUndefinedIdentifiers(code, { globals })) problems.push(`${file}:${entry.line}:${entry.column}  ${entry.name}`);
  const used = new Set(names(code));
  for (const name of globals) assert.ok(used.has(name), `${file} no longer uses the host global \`${name}\`: remove it from the list in this test`);
}
assert.equal(problems.length, 0, `${problems.length} use(s) of a name that no enclosing scope declares (a ReferenceError when the line runs):\n  ${problems.join("\n  ")}\n`);

// ---- 3. Every calendar function the main file names is exported. -------------------------------------------------------
// The main file reaches the calendar part through `CALENDAR_PART` (inside the sheet through its alias `C`) and usually
// calls it defensively: `CALENDAR_PART?.name?.(...)`. When `name` is missing from the export list, that call does nothing
// and reports nothing. A restored Agenda tab kept a bare title and the wrong icon that way.
{
  const calendar = require("../additional/notes/calendar/ZentralNotesCalendar.js");
  const main = fs.readFileSync(path.join(ROOT, "additional/notes/ZentralNotes.uc.js"), "utf8");
  const aliases = ["CALENDAR_PART", ...[...main.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*CALENDAR_PART\s*[;,]/g)].map((match) => match[1])];
  assert.ok(aliases.includes("C"), "the sheet's alias of the calendar part is recognised");
  const missing = [];
  let checked = 0;
  for (const alias of new Set(aliases)) {
    for (const match of main.matchAll(new RegExp("(?<![\\w$.])" + alias.replace(/\$/g, "\\$") + "\\??\\.([A-Za-z_$][\\w$]*)", "g"))) {
      checked++;
      if (!(match[1] in calendar)) missing.push(`additional/notes/ZentralNotes.uc.js:${main.slice(0, match.index).split("\n").length}  ${alias}.${match[1]}`);
    }
  }
  assert.ok(checked >= 100, "the scan is not empty: the calendar part is reached through the recognised names (" + checked + " uses found)");
  assert.equal(missing.length, 0, `the calendar module does not export:\n  ${missing.join("\n  ")}\n(add the name to the \`api\` object at the end of ZentralNotesCalendar.js)\n`);
}

console.log(`undefined-identifier check passed (${Object.keys(SOURCES).length} Notes source files)`);
