"use strict";
/* OW-129 RED -> GREEN: the Clock quick note is hidden until its own small
 * bottom-right chevron is used. OW-69's one switch and OW-68's one-line row
 * stay intact; no extra card height or global gesture listener. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createFakeSidebarHarness, widgetSrc: SRC, widgetCss: CSS } = require("./helpers/fake-widgets-harness.cjs");

const ROOT = path.join(__dirname, "..");
const SETTINGS = JSON.parse(fs.readFileSync(path.join(ROOT, "additional/widgets/settings.json"), "utf8"));
const core = createFakeSidebarHarness().core;
const plain = (v) => JSON.parse(JSON.stringify(v));
const BASE = {
  "zen.workspace.zentral.widgets.enabled": true,
  "zen.workspace.zentral.widgets.clock.enabled": true,
  "zen.workspace.zentral.widgets.date.enabled": false,
};
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const click = (el) => {
  for (const [type, fn] of [...(el._listeners || [])]) {
    if (type === "click") fn({ type: "click", preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
  }
};

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`ok - ${name}`);
}

(async () => {
  try {
    await test("1. a pure visibility resolver keeps the OW-69 switch and a per-card open state", () => {
      assert.equal(typeof core.clockQuickNoteVisibility, "function");
      const hidden = plain(core.clockQuickNoteVisibility({ enabled: true, canNote: true, opened: false }));
      assert.deepEqual(hidden, { available: true, visible: false, expanded: false, toggleHidden: false, ariaPressed: "false" });
      const open = plain(core.clockQuickNoteVisibility({ enabled: true, canNote: true, opened: true }));
      assert.equal(open.visible, true);
      assert.equal(open.expanded, true);
      assert.equal(open.ariaPressed, "true");
      const off = plain(core.clockQuickNoteVisibility({ enabled: false, canNote: true, opened: true }));
      assert.equal(off.visible, false);
      assert.equal(off.toggleHidden, true);
      const noNotes = plain(core.clockQuickNoteVisibility({ enabled: true, canNote: false, opened: true }));
      assert.equal(noNotes.toggleHidden, true);
    });

    await test("2. the existing quick-note switch stays on in the schema and the source watches it", () => {
      const pref = "zen.workspace.zentral.widgets.clock.quick_note";
      const row = SETTINGS.schema.find((s) => s.property === pref);
      assert.ok(row);
      assert.equal(row.defaultValue, true);
      assert.match(SRC, /WIDGET_PREFS\.CLOCK_QUICK_NOTE,\n\s+\]/);
      assert.match(SRC, /clockQuickNoteVisibility\(/);
    });

    await test("3. the fake Clock starts closed, with one accessible bottom-right chevron", async () => {
      const h = createFakeSidebarHarness({ ...BASE }, { notes: true });
      const { api } = h.start();
      await tick(40);
      const body = api.getTray().children.find((el) => el.getAttribute("data-zw-widget") === "clock").querySelector(".zw-clock");
      const row = body.querySelector(".zw-clock-note-row");
      const toggle = body.querySelector(".zw-clock-note-toggle");
      assert.ok(toggle, "the chevron is on the clock face");
      assert.equal(toggle.getAttribute("aria-expanded"), "false");
      assert.equal(toggle.getAttribute("aria-pressed"), "false");
      assert.ok(toggle.getAttribute("aria-label"), "the chevron is labelled");
      assert.equal(row.hidden, true, "the quick note does not occupy a row by default");
      assert.equal(row.style.display, "none", "and takes no space");
      assert.equal(toggle.hidden, false, "the chevron is available");
      api.destroy();
    });

    await test("4. clicking the chevron opens the OW-68 one-line row; Save closes it and keeps the opener", async () => {
      const h = createFakeSidebarHarness({ ...BASE }, { notes: true });
      const { api } = h.start();
      await tick(40);
      const body = api.getTray().children.find((el) => el.getAttribute("data-zw-widget") === "clock").querySelector(".zw-clock");
      const row = body.querySelector(".zw-clock-note-row");
      const toggle = body.querySelector(".zw-clock-note-toggle");
      const field = body.querySelector(".zw-clock-note");
      const save = body.querySelector(".zw-clock-note-btn");
      click(toggle);
      assert.equal(row.hidden, false);
      assert.equal(row.style.display, "");
      assert.equal(toggle.getAttribute("aria-expanded"), "true");
      assert.equal(toggle.getAttribute("aria-pressed"), "true");
      assert.match(CSS, /\.zw-clock-note-row \.zw-clock-note-btn \{[^}]*flex: 0 0 auto !important/);
      assert.match(CSS, /\.zw-clock-note-row \.zw-clock-note \{[^}]*flex: 1 1 0 !important/);
      field.value = "Chevron note";
      click(save);
      assert.equal(row.hidden, true);
      assert.equal(toggle.getAttribute("aria-expanded"), "false");
      assert.ok(h.quickNotes.includes("Chevron note"));
      api.destroy();
    });

    await test("5. OW-69 off wins over the chevron and adds no card height", async () => {
      const pref = "zen.workspace.zentral.widgets.clock.quick_note";
      const h = createFakeSidebarHarness({ ...BASE, [pref]: false }, { notes: true });
      const { api } = h.start();
      await tick(40);
      const body = api.getTray().children.find((el) => el.getAttribute("data-zw-widget") === "clock").querySelector(".zw-clock");
      const row = body.querySelector(".zw-clock-note-row");
      const toggle = body.querySelector(".zw-clock-note-toggle");
      assert.equal(toggle.hidden, true, "no dead control when the switch is off");
      assert.equal(row.hidden, true);
      click(toggle);
      assert.equal(row.hidden, true, "an off switch cannot be opened");
      h.prefs.set(pref, true); h.Services.prefs.setBoolPref(pref, true);
      await tick(60); h.flushRaf();
      assert.equal(body.querySelector(".zw-clock-note-toggle").hidden, false, "the switch is live");
      assert.equal(row.hidden, true, "turning it on does not auto-open the row");
      assert.match(CSS, /\.zw-clock-note-toggle \{[^}]*position:\s*absolute/);
      assert.match(CSS, /\.zw-clock-note-toggle \{[^}]*inset-inline-end:/);
      assert.match(CSS, /\.zw-clock-note-toggle \{[^}]*bottom:/);
      assert.doesNotMatch(CSS, /\.zw-clock-note-toggle-row/, "no extra row");
      api.destroy();
    });

    console.log(`OW-129 clock quick note chevron tests passed (${passed})`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
})();
