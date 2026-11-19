"use strict";
/* Owner bug 3 (2026-11-18): resizing a Zentral panel, squeezing it with the top bar, or running
 * Triple View with Notes open felt janky. The measurable repository claim is narrower than a live
 * frame-rate measurement: repeated resize notifications with unchanged geometry must not rewrite
 * the sheet/root, the floating-card watcher must not run an unconditional 450 ms layout loop, and
 * the panel/Triple View listeners must coalesce or guard their own work. Real Zen performance is
 * still an OWNER GATE; this suite proves the event/write fan-out is bounded. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createPanelWorld, noteText, DIR } = require("./helpers/fake-panel-window.cjs");

const REPO = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function block(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, "source contains " + marker);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error("unbalanced block: " + marker);
}

test("Notes layout is fingerprinted, rAF-coalesced and writes only changed style/dataset values", () => {
  const src = read("additional/notes/ZentralNotes.uc.js");
  assert.match(src, /let lastLayoutKey = ""/, "an unchanged-geometry fingerprint exists");
  assert.match(src, /let layoutForced = false/, "state changes can explicitly force one layout");
  assert.match(src, /const layoutStateKey = /, "the layout fingerprint is a real helper");
  assert.match(src, /window\.requestAnimationFrame\(\(\) => layout\(false\)\)/, "observer-driven rAF passes are dedupable");
  assert.match(src, /function layout\(force = true\)/, "direct caller-driven layouts are still authoritative");
  assert.match(src, /const setStyleValue = /, "style writes are guarded");
  assert.match(src, /const setDatasetValue = /, "dataset writes are guarded");
  assert.match(src, /__zentralNotesTestSeam\.layout/, "an opt-in layout probe exposes pass/write counts");
  assert.doesNotMatch(src, /root\.style\.left = Math\.round\(left - off\.ox\)/, "the old unconditional left write is gone");
});

test("the floating-card settle watcher no longer runs a per-frame 450 ms loop", () => {
  const src = read("additional/notes/ZentralNotes.uc.js");
  // There are two adapters with watch(cb): the panel bar and the floating card. Start after
  // the floating card's comment so the right implementation is checked.
  const floatingStart = src.indexOf("// The card follows the browser chrome");
  assert.ok(floatingStart > 0, "the floating-card watcher is present");
  const floating = block(src.slice(floatingStart), "watch(cb) {");
  assert.doesNotMatch(floating, /Date\.now\(\) < until/, "no unconditional Date.now()-driven frame chain");
  assert.match(floating, /settleTimer/, "one trailing settle timer remains");
  assert.match(floating, /if \(!frame\) frame = window\.requestAnimationFrame\(tick\)/, "a burst schedules one frame");
  assert.match(floating, /window\.clearTimeout\(settleTimer\)/, "the trailing timer is cancelled/cleaned up");
});

test("panel push sync is guarded and Triple View keeps its frame-coalesced follow-up fit", () => {
  const panels = read("extension/panels/ZentralPanels.uc.js");
  const push = block(panels, "function syncPanelPushState()");
  assert.match(push, /if \(pushChanged\) docRoot\.setAttribute\("bgalazka-push-page"/, "the root push attribute is written only when changed");
  assert.match(push, /setAttrIfChanged\(/, "button attributes are written only when changed");
  assert.doesNotMatch(push, /document\.documentElement\.setAttribute\(\s*"bgalazka-push-page"/, "no unconditional root push write");

  const notesSource = read("additional/notes/ZentralNotes.uc.js");
  assert.match(notesSource, /if \(SLOT\.owner === api && px === SLOT\.px/, "an unchanged Triple View slot returns before CSS writes/events");

  const secondary = read("extension/panels/secondary-views/ZentralSecondaryViews.uc.js");
  const fit = block(secondary, "function scheduleSecondaryGeometryFit()");
  assert.match(fit, /cancelAnimationFrame\(secondaryFitFrame\)/, "the existing follow-up fit is rAF-coalesced");
  assert.match(fit, /requestAnimationFrame\(/, "one frame answers a fit burst");
  assert.match(fit, /fitSecondaryBrowsers\(\)/, "the coalesced frame still fits both panels");
  assert.match(block(secondary, "const onNotesGap = () => {"), /scheduleSecondaryGeometryFit\(\)/, "the reserve event uses that scheduler");
});

test("repeated panel resize notifications with unchanged geometry cause zero layout writes", async () => {
  const world = createPanelWorld({ sharedGlobal: { Map, Object } });
  world.disk.set(DIR + "/n1.md", noteText("Resize note"));
  const w = world.openWindow({ id: "resize-coalescing" });
  const panel = w.buildPanel({ open: true, announce: true });
  const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });
  const reserve = () => parseFloat(w.html.style.getPropertyValue("--zentral-notes-panel-reserve")) || 0;
  panel.root.getBoundingClientRect = () => rect(0, 0, 420, 640 - reserve());
  panel.slider.getBoundingClientRect = () => rect(0, 12, 420, 600);
  panel.toolbar.getBoundingClientRect = () => rect(0, 12, 420, 36);
  panel.page.getBoundingClientRect = () => rect(0, 48, 420, 564 - reserve());
  w.start();
  await world.advance(1000);
  const button = panel.toolbar.firstElementChild;
  assert.ok(button, "the primary panel has a Notes button");
  button.click();
  await world.advance(1200);
  assert.ok(w.openSheets().length >= 1, "Notes is open in the panel");
  const probe = w.win.__zentralNotesTestSeam?.layout;
  assert.ok(probe && typeof probe.reset === "function", "the opt-in layout probe exists");
  probe.reset();

  const resizeListeners = () => w.listeners.filter((l) => l.type === "resize");
  assert.ok(resizeListeners().length >= 1, "the sheet listens to window resize");
  for (let i = 0; i < 12; i++) {
    for (const listener of resizeListeners()) listener.fn({ type: "resize" });
    await world.advance(20);
  }
  assert.ok(probe.passes >= 12, "each resize turn was observed and rAF-coalesced");
  assert.equal(probe.writes, 0, "unchanged geometry performs no full layout write pass");
  assert.equal(probe.styleWrites, 0, "no sheet style is rewritten");
  assert.equal(probe.datasetWrites, 0, "no sheet dataset attribute is rewritten");
  assert.equal(probe.skipped, probe.passes, "all repeated passes were deduplicated");
  await w.close();
});

test("the task report records the live-Zen performance OWNER GATE instead of claiming a frame rate", () => {
  const report = read("docs/bugfix-2026-11-18.md");
  assert.match(report, /OW-117/);
  assert.match(report, /OWNER GATE/);
  assert.match(report, /not measured|live Zen/i);
});

(async () => {
  for (const [name, fn] of tests) {
    await fn();
    passed++;
    console.log("ok -", name);
  }
  console.log(`\now-117-notes-resize-coalescing (${passed} passed)`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
