"use strict";
/* Owner bugs 1 and 2 (2026-11-18): Zen sidebar Notes rows lost their titles while favicons/folders
 * stayed, and Agenda favicons stayed grayscale. Both are parked `[pending]` pseudo-tabs, so the fix
 * has two halves: restore the native `.tab-label` text whenever the browser rewrites a row, and
 * ship a narrow CSS override that clears grayscale/opacity on the row, its favicon and its label
 * WITHOUT hiding or zeroing either. This suite runs the real Notes source in the fake Zen browser
 * and audits the shipped CSS; no live Zen screenshot is claimed. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
const { audit, format } = require("../tools/audit-pending-placeholder-css.cjs");
const UI = require("../additional/notes/calendar/ZentralNotesCalendarUI.js");
const PARSER = require("../additional/notes/parser/ZentralNotesParserGraph.js");
const ZEN = require("../additional/notes/zen/ZentralNotesZenSidebar.js");
const PARTS = { "notes-calendar-ui": UI, "notes-parser": PARSER, "notes-zen-sidebar": ZEN };
const NOTES_FOLDER = "zen.workspace.zentral.notes.zen_folder";
const AGENDA_FOLDER = "zen.workspace.zentral.notes.agenda_folder";
const PARK = "zen.workspace.zentral.notes.park_pseudo_tabs";

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const tick = () => new Promise((resolve) => setImmediate(resolve));
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await tick(); };
const dateAt = (days, hour, min = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, min, 0, 0);
  return d.toISOString();
};
const labelNode = (tab) => {
  const node = tab.querySelector?.(".tab-label");
  assert.ok(node, "the fake Zen tab has a native .tab-label node");
  return node;
};
const rewriteLabel = (tab, value) => {
  tab.setAttribute("label", value);
  const node = labelNode(tab);
  node.setAttribute("value", value);
  node.textContent = value;
};
const assertLabel = (tab, wanted, why) => {
  assert.equal(tab.getAttribute("label"), wanted, why + ": native label attribute");
  const node = labelNode(tab);
  assert.equal(node.getAttribute("value"), wanted, why + ": native label value");
  assert.equal(node.textContent, wanted, why + ": native label text");
};

test("a projected Notes row writes the title into BOTH label roads and restores both after a pending rewrite", async () => {
  const h = createFakeZen({ prefs: { [NOTES_FOLDER]: "all", [PARK]: true }, parts: PARTS, discardRewritesVisuals: true });
  await h.seam.ensureStore();
  h.seam.store.create("# First note");
  h.seam.store.create("# Second note");
  h.fireTimer(6000); h.fireTimer(6500);
  await settle(10);
  h.seam.zen.runNow();
  await settle(10);
  const tab = h.document.querySelectorAll("tab[bgalazka-notes-item]").find((t) => /^n:/.test(t.getAttribute("bgalazka-notes-item") || ""));
  assert.ok(tab, "a projected note row exists");
  const wanted = tab.getAttribute("bgalazka-notes-label");
  assert.match(wanted || "", /note$/, "the note title is the projection label");
  assertLabel(tab, wanted, "freshly projected row");
  const icon = tab.getAttribute("image");
  assert.ok(icon, "the note favicon is still set");

  // OW-88's parking path: the fake browser rewrites BOTH label roads and drops the favicon.
  // Notes must heal them in place even inside the 500 ms quiet window (no projection run).
  h.advanceClock(1000);
  assert.equal(h.seam.parkPseudoTab(tab), "", "the note placeholder is parked");
  assert.equal(tab.getAttribute("pending"), "true", "the browser marked it pending");
  assertLabel(tab, wanted, "after the browser rewrote the pending label on discard");
  assert.equal(tab.getAttribute("image"), icon, "the note favicon survives discard");

  // A later session/attribute rewrite is repaired by the narrow TabAttrModified listener.
  rewriteLabel(tab, "[pending]");
  h.emit("TabAttrModified", tab, { detail: { changed: ["label"] } });
  for (let i = 0; i < 6; i++) h.fireTimer(0);
  await settle(6);
  assertLabel(tab, wanted, "after the browser rewrote the pending label");
  assert.equal(tab.getAttribute("image"), icon, "restoring the title does not drop the favicon");
  await h.destroy();
});

test("the Agenda row keeps its title/favicon when the browser rewrites a pending label", async () => {
  const h = createFakeZen({ prefs: { [AGENDA_FOLDER]: true, [PARK]: true }, parts: PARTS, discardRewritesVisuals: true });
  await h.seam.ensureStore();
  const note = h.seam.store.create("# Agenda note");
  h.seam.store.items.upsert({
    id: "ow-116-reminder",
    summary: "Call back",
    start: { dateTime: dateAt(0, 23, 59) },
    x: { kind: "reminder", noteId: note.id },
  });
  h.fireTimer(6500);
  await settle(8);
  h.seam.agendaController.runNow();
  await settle(8);
  const tab = h.document.querySelectorAll("tab[bgalazka-notes-agenda-item]").find((t) => !String(t.getAttribute("bgalazka-notes-agenda-item") || "").startsWith("seed:"));
  assert.ok(tab, "an Agenda item row exists");
  const wanted = tab.getAttribute("bgalazka-notes-label");
  assert.match(wanted || "", /Call back/, "the Agenda label is the projected summary");
  assertLabel(tab, wanted, "fresh Agenda row");
  const icon = tab.getAttribute("image");
  assert.ok(icon, "the Agenda favicon is set");

  // The user explicitly warned NOT to break Agenda favicons like Notes titles: parking may
  // blank the distinct Agenda icon, and both the label roads and the icon must come back.
  h.advanceClock(1000);
  assert.equal(h.seam.parkPseudoTab(tab), "", "the Agenda placeholder is parked");
  assert.equal(tab.getAttribute("pending"), "true", "the browser marked it pending");
  assertLabel(tab, wanted, "after the browser rewrote the pending Agenda label on discard");
  assert.equal(tab.getAttribute("image"), icon, "Agenda's distinct favicon survives discard");

  // A later attribute-only rewrite is repaired without a full projection.
  rewriteLabel(tab, "[pending]");
  h.emit("TabAttrModified", tab, { detail: { changed: ["label"] } });
  await settle(8);
  assertLabel(tab, wanted, "after the browser rewrote the pending Agenda label");
  assert.equal(tab.getAttribute("image"), icon, "Agenda's distinct favicon survives");
  await h.destroy();
});

test("the narrow pending override clears grayscale on Agenda favicons while keeping labels visible", () => {
  const report = audit();
  const css = read("additional/tabs/ZentralTabDensity.css");
  const visual = report.overrides.filter((r) => r.file === "additional/tabs/ZentralTabDensity.css" && r.line > 975);
  assert.ok(visual.length >= 2, "new pending-visual overrides are listed by the screenshot-free audit");
  const selectors = visual.map((r) => r.selector).join("\n");
  assert.match(selectors, /bgalazka-notes-item/, "Notes rows are covered");
  assert.match(selectors, /bgalazka-notes-agenda-item/, "Agenda rows are covered");
  assert.match(selectors, /\.tab-icon-image/, "the favicon itself is covered, not just the row");
  assert.match(selectors, /\.tab-label/, "the title node is covered too");
  const declarations = visual.flatMap((r) => r.declarations.map((d) => `${d.property}: ${d.value}`));
  for (const wanted of ["filter: none !important", "opacity: 1 !important", "visibility: visible !important"]) {
    assert.ok(declarations.includes(wanted), wanted + " is restored");
  }
  for (const forbidden of ["display: none", "width: 0", "height: 0", "font-size: 0"]) {
    assert.ok(!declarations.some((d) => d.includes(forbidden)), "the override never hides/zeroes a row: " + forbidden);
  }
  assert.match(css, /\[pending\]/, "the override is scoped to parked placeholders");
  assert.doesNotMatch(css, /:root\s+tab\[pending\][^{]*\{[^}]*filter:\s*none/, "no blanket pending-tab override");
  assert.equal(read("docs/ow-114-pending-css-audit.md"), format(report), "the generated CSS audit report is current");
});

(async () => {
  for (const [name, fn] of tests) {
    await fn();
    passed++;
    console.log("ok -", name);
  }
  console.log(`\now-116-pending-placeholder-visuals (${passed} passed)`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
