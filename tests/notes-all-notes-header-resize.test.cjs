"use strict";
/* OW-97: two things the owner asked for and could not get.
 *
 * 1. The calendar's header must say what its buttons do with GLYPHS, not words — "Przejdź do dziś" and "Miesiąc" are
 *    long in every language and they were pushing the settings and Big Picture buttons out of the window. And when
 *    room runs out the header gives up its pieces in a chosen order: the name first, then the long date range, and only
 *    then anything else. The buttons never shrink.
 *
 * 2. The notes tree is a WIDTH the user sets; the calendar is what stretches. A percentage share cannot do that: a
 *    share widens both panes when the window grows.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const cal = require("../additional/notes/calendar/ZentralNotesCalendar.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok -", name);
}

const JS = fs.readFileSync(path.join(__dirname, "..", "additional", "notes", "ZentralNotes.uc.js"), "utf8");
const CSS = fs.readFileSync(path.join(__dirname, "..", "additional", "notes", "ZentralNotes.css"), "utf8");

const block = (startToken, endToken, len = 2000) => {
  const at = JS.indexOf(startToken);
  assert.ok(at > 0, `source still contains ${startToken}`);
  return JS.slice(at, Math.min(JS.length, at + len));
};

test("the today button is a glyph, never a word", () => {
  const decl = block("const calendarToday = h(", 'title: t("cal.todayBtn")', 400);
  assert.match(decl, /icon\("calendar"/, "it draws the calendar glyph");
  assert.ok(!/}, t\("cal\.todayBtn"\)\);/.test(decl), "and no longer has the label as its only child");
  assert.match(decl, /"aria-label": t\("cal\.todayBtn"\)/, "the words are still the accessible name");
  assert.match(decl, /zn-calendar-today-dot/, "with a dot, which is how a calendar glyph says today");
});

test("a re-translation cannot turn the today button back into words", () => {
  // Two places re-apply the label when the language changes. Both must keep the glyph.
  const hits = [...JS.matchAll(/calendarToday\.setAttribute\("aria-label", t\("cal\.todayBtn"\)\)/g)];
  assert.ok(hits.length >= 2, "both label refreshes are present");
  const guarded = [...JS.matchAll(/if \(!calendarToday\.querySelector\("svg"\)\) \{/g)];
  assert.ok(guarded.length >= 2, "and each one rebuilds the glyph only when it is missing");
  assert.ok(!/calendarToday\.textContent/.test(JS), "nothing writes text into it any more");
});

test("the month/week toggle is a chevron that points the way the view goes", () => {
  const decl = block("const btnCalendarViewToggle = h(", 'icon("chevron", 14)', 400);
  assert.match(decl, /icon\("chevron", 14\)/, "a chevron, not the words");
  assert.ok(!/}, t\("cal\.view\.month"\)\);/.test(decl), "no word label in the declaration");
  const refresh = block("btnCalendarViewToggle.dataset.next", "buttonViewToggle", 400);
  assert.match(refresh, /dataset\.next = isWeek \? "month" : "week"/, "the direction is stated for the stylesheet");
  assert.match(refresh, /replaceChildren\(icon\("chevron", 14\)\)/, "and the glyph is rebuilt, not the word");
});

test("the chevron actually turns: down to the week, up back to the month", () => {
  // The icon set's chevron points right, so "down" is 90° and "up" is 270°. A test that asserted 0/180 would pass on a
  // chevron pointing sideways, which is exactly what it looked like before this check existed.
  assert.match(CSS, /zn-calendar-view-toggle\[data-next="week"\] svg \{ transform: rotate\(90deg\)/, "week is the down one");
  assert.match(CSS, /zn-calendar-view-toggle\[data-next="month"\] svg \{ transform: rotate\(270deg\)/, "month is the up one");
  assert.match(CSS, /prefers-reduced-motion[\s\S]{0,120}zn-calendar-view-toggle svg \{ transition: none/, "and turning is optional for a person who asked for less motion");
});

test("the header gives up its room in the owner's order, and the buttons never shrink", () => {
  // 1. the name shrinks hardest
  assert.match(CSS, /\.zn-calendar-pane-head > strong \{ flex-shrink: 999/, "the calendar's name is first to go");
  // 2. the period shrinks after it
  assert.match(CSS, /\.zn-calendar-pane-hint \{ flex: 0 1 auto; flex-shrink: 1;/, "the long date range goes second");
  // 3. the controls are fixed
  assert.match(CSS, /\.zn-calendar-head-nav \{ flex: 0 0 auto; \}/, "prev/today/next/chevron never shrink");
  assert.match(CSS, /\.zn-calendar-head-nav > \.zn-chip \{ flex: 0 0 auto; \}/, "not one chip of them");
  assert.match(CSS, /\.zn-calendar-pane-head-right > \.zn-btn \{ flex: 0 0 auto; \}/, "and neither do settings or Big Picture");
  // and the two glyph buttons have a fixed square, so no translation can widen them again
  assert.match(CSS, /\.zn-calendar-today,\s*\.zentral-notes-sheet[^{]*\.zn-calendar-view-toggle \{ width: 26px; height: 24px/, "the two glyph buttons are fixed squares");
});

test("the header does not wrap: wrapping is what pushed buttons out of the window", () => {
  assert.match(CSS, /\.zn-calendar-pane-head \{ flex-wrap: nowrap;/, "one line, ever");
});

test("the notes tree is a width, and the calendar is what is left", () => {
  assert.match(CSS, /\.zn-calendar-pane \{ display: flex; flex: 1 1 0;/, "the calendar takes the remaining space");
  const apply = block("const treeWidth = picked.orientation", "applyTreePaneSqueeze(", 1400);
  assert.match(apply, /flex = `0 0 \$\{treeWidth\}px`/, "the tree is a fixed pixel width");
  // The percentage survives only as the fallback for the top/bottom split (a height) and for a browser that never
  // measured the window; a left/right layout with a known width must not reach it.
  assert.match(apply, /if \(treeWidth\) \{\s*treePane\.style\.flex = `0 0 \$\{treeWidth\}px`/, "the width branch is taken first, unconditionally");
});

test("a stored share seeds the width once, so nobody lands on a split they did not choose", () => {
  const seeding = block("const storedWidth = Number(store.meta.calendarTreeWidth)", "clampTreePaneWidth", 500);
  assert.match(seeding, /Math\.round\(\(Number\(dims\?\.width\) \|\| 0\) \* share\)/, "an old document's share becomes a pixel width");
  assert.match(seeding, /> 0/, "and only while no width was ever set");
});

test("a left/right drag writes a width; a top/bottom drag is still a share", () => {
  const drag = block("function changeCalendarShare(share)", "function commitCalendarShare", 1600);
  assert.match(drag, /orientation === "lr"/, "the two orientations are told apart");
  assert.match(drag, /treePane\.style\.flex = `0 0 \$\{width\}px`/, "left/right moves a width");
  assert.match(drag, /flexBasis = `\$\{Math\.round\(clean \* 1000\) \/ 10\}%`/, "top/bottom still moves a share, because there it is a height");
  const commit = block("function commitCalendarShare()", "store.setMeta", 900);
  assert.match(commit, /calendarTreeWidth: Number\(drag\.treeWidth\)/, "the width is stored");
  assert.match(commit, /calendarSplitLR: drag\.share/, "and the share stays in step for the other orientation");
});

test("the width is bounded, and never leaves the calendar nothing", () => {
  assert.deepEqual({ ...cal.TREE_WIDTH_LIMITS }, { min: 160, max: 900, default: 360 });
  // The floor must stay under the squeeze ladder's own `tight` threshold, or that tier becomes unreachable and the tree
  // stops compacting exactly where a person drags to make it.
  assert.ok(cal.TREE_WIDTH_LIMITS.min < cal.TREE_SQUEEZE_THRESHOLDS.tight, "the floor is below the tight tier");
  assert.equal(cal.treePaneSqueezeState(cal.TREE_WIDTH_LIMITS.min).tier, "tight", "so a tree at the floor is at its most compact");
  assert.equal(cal.cleanTreePaneWidth(undefined), 360, "unset is a sane default");
  assert.equal(cal.cleanTreePaneWidth(10), 160, "too narrow is the floor");
  assert.equal(cal.cleanTreePaneWidth(100000), 900, "too wide is the ceiling");
  assert.equal(cal.cleanTreePaneWidth("abc"), 360, "junk is the default");
  assert.equal(cal.clampTreePaneWidth(600, 1000), 600, "a width that fits is kept exactly");
  assert.equal(cal.clampTreePaneWidth(600, 500), 393, "in a narrow window the share ceiling wins");
  assert.ok(cal.clampTreePaneWidth(900, 200) >= cal.TREE_WIDTH_LIMITS.min, "and it never falls under the floor either");
  assert.equal(cal.clampTreePaneWidth(600, 0), 600, "an unmeasured window leaves the width alone");
});

test("the width is a UI state key in both lists, or setMeta would leak it into notes metadata", () => {
  assert.ok(cal.UI_STATE_KEYS.includes("calendarTreeWidth"), "the calendar module knows it");
  const fallback = JS.slice(JS.indexOf("UI_KEYS_FALLBACK = Object.freeze"), JS.indexOf("UI_KEYS_FALLBACK = Object.freeze") + 900);
  assert.match(fallback, /"calendarTreeWidth"/, "and so does the notes fallback when the calendar is not loaded");
});

console.log(`\n${passed} all-notes header and resize tests passed`);
