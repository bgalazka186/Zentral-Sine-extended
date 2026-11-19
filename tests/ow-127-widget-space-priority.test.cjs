"use strict";
/* OW-127 RED -> GREEN: a pure, owner-configurable widget-space policy.
 * The default must preserve today's order and scroll behavior; a constrained
 * tray gives up space from the END of the priority list. Scroll access is per
 * widget; a widget marked never is not mounted under pressure. No live layout
 * is claimed. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createFakeSidebarHarness, widgetSrc: SRC, widgetCss: CSS } = require("./helpers/fake-widgets-harness.cjs");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const json = (rel) => JSON.parse(read(rel));
const core = createFakeSidebarHarness().core;
const plain = (value) => JSON.parse(JSON.stringify(value));

const PRIORITY = "zen.workspace.zentral.widgets.space_priority";
const SCROLL = "zen.workspace.zentral.widgets.space_scroll";
const IDS = ["clock", "date", "weather", "boost"];
const DEFS = IDS.map((id) => ({ id, minHeight: 50 }));

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

try {
  test("1. both space-policy preferences are declared in every settings surface", () => {
    const settings = json("additional/widgets/settings.json");
    for (const pref of [PRIORITY, SCROLL]) {
      const row = settings.schema.find((s) => s.property === pref);
      assert.ok(row, pref + " is in the widget schema");
      assert.equal(row.type, "input");
      assert.equal(row.defaultValue, "", "empty preserves current behavior");
      assert.ok(settings.settings[pref], pref + " has a section/owner");
      assert.equal(settings.settings[pref].section, "Layout & visibility");
      assert.equal(settings.settings[pref].owner, "widgets");
      assert.ok(json("additional/widgets/preferences.json").some((p) => p.property === pref), "preferences.json");
      assert.ok(read("extension/settings/layout.json").includes(pref), "layout order");
      assert.ok(read("additional/widgets/standalone.json").includes(pref), "standalone list");
    }
    assert.match(SRC, /SPACE_PRIORITY:\s*"zen\.workspace\.zentral\.widgets\.space_priority"/);
    assert.match(SRC, /SPACE_SCROLL:\s*"zen\.workspace\.zentral\.widgets\.space_scroll"/);
    assert.match(SRC, /spacePriority:\s*getString\(WIDGET_PREFS\.SPACE_PRIORITY/);
    assert.match(SRC, /spaceScroll:\s*getString\(WIDGET_PREFS\.SPACE_SCROLL/);
  });

  test("2. the pure resolver preserves the current order and all-scroll default", () => {
    assert.equal(typeof core.cleanWidgetSpacePolicy, "function");
    const policy = plain(core.cleanWidgetSpacePolicy("", "", IDS));
    assert.deepEqual(policy.priority, IDS);
    assert.deepEqual(policy.scroll, IDS);
    assert.deepEqual(policy.never, []);
    assert.equal(policy.scrollMode, "all");
  });

  test("3. a chosen priority wins, unknown ids are dropped, and scroll access is per widget", () => {
    const policy = plain(core.cleanWidgetSpacePolicy("boost, missing, clock", "weather, clock", IDS));
    assert.deepEqual(policy.priority, ["boost", "clock", "date", "weather"], "known chosen first, rest keep default order");
    assert.deepEqual(policy.scroll, ["weather", "clock"], "only these ids may be reached by scroll");
    assert.deepEqual(policy.never, ["date", "boost"], "the complementary never list keeps registered-id order");
    assert.equal(policy.scrollMode, "some");
    const none = plain(core.cleanWidgetSpacePolicy("weather", "none", IDS));
    assert.deepEqual(none.scroll, []);
    assert.deepEqual(none.never, IDS);
    assert.equal(none.scrollMode, "none");
  });

  test("4. under pressure the end of the priority gives up space; allowed scroll stays reachable", () => {
    assert.equal(typeof core.planWidgetSpace, "function");
    const policy = core.cleanWidgetSpacePolicy("boost, clock", "weather, clock", IDS);
    const plan = plain(core.planWidgetSpace(DEFS, policy, { maxHeight: 100, minHeight: 50, pressure: true }));
    assert.deepEqual(plan.visible, ["boost", "clock"]);
    assert.deepEqual(plan.scroll, ["weather"]);
    assert.deepEqual(plan.never, ["date"]);
    assert.deepEqual(plan.order, ["boost", "clock", "weather"]);
    assert.equal(plan.trayScroll, true);
    assert.equal(plan.spaceMode, "scroll");
    const fixed = plain(core.planWidgetSpace(DEFS, core.cleanWidgetSpacePolicy("boost, clock", "none", IDS), { maxHeight: 100, minHeight: 50, pressure: true }));
    assert.equal(fixed.trayScroll, false);
    assert.equal(fixed.spaceMode, "fixed");
    assert.deepEqual(fixed.never, ["date", "weather"]);
  });

  test("5. without pressure every enabled widget stays visible and mounted", () => {
    const policy = core.cleanWidgetSpacePolicy("boost", "clock", IDS);
    const plan = plain(core.planWidgetSpace(DEFS, policy, { maxHeight: 300, minHeight: 50, pressure: false }));
    assert.deepEqual(plan.visible, IDS);
    assert.deepEqual(plan.scroll, []);
    assert.deepEqual(plan.never, []);
    assert.equal(plan.spaceMode, "all");
  });

  test("6. runtime wiring is bounded to the existing scroll tray, with no added collapsed height", () => {
    assert.match(SRC, /cleanWidgetSpacePolicy\(config\.spacePriority, config\.spaceScroll/);
    assert.match(SRC, /planWidgetSpace\(enabledDefs, spacePolicy/);
    assert.match(SRC, /tray\.setAttribute\("data-zw-space-mode", spacePlan\.spaceMode\)/);
    assert.match(SRC, /tray\.setAttribute\("data-zw-space-pressure", spacePressure \? "true" : "false"\)/);
    assert.match(CSS, /#zentral-sidebar-widgets\[data-zw-space-mode="fixed"\]/);
    assert.match(CSS, /#zentral-sidebar-widgets\[data-zw-space-pressure="true"\] \.zw-card\[data-zw-space="scroll"\]/);
    assert.match(CSS, /scroll-snap-align:\s*start/);
    assert.doesNotMatch(CSS, /\.zw-space-control/, "no extra control or row is added");
    assert.match(CSS, /max-height:\s*var\(--zw-max-height,\s*0px\)/, "collapsed tray keeps its zero max-height default");
  });

  console.log(`OW-127 widget space priority tests passed (${passed})`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
