"use strict";
/* OW-124 RED -> GREEN. The owner's short Browser Console row is a XUL
 * <label> with BOTH `value="ThisShouldNotRepeat"` and textContent
 * "ThisShouldNotRepeat". Zen's own `text=label` inheritance owns textContent;
 * writing `value` as a second visual road is what repeats the title. This does
 * NOT claim a live render fix: it pins the observed DOM shape and the one-road
 * repair, then leaves the visual result to the OWNER GATE. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(ROOT, "additional/notes/ZentralNotes.uc.js"), "utf8");
const dom = require("./helpers/fake-dom.cjs")();
const win = { document: dom.document, ZentralRuntime: { register() {} }, __zentralNotesTestSeam: {} };
win.window = win;
vm.runInNewContext(source, {
  window: win,
  document: dom.document,
  globalThis: { window: win, document: dom.document, Services: {} },
  ChromeUtils: {},
  console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, WeakMap, WeakSet, Symbol, Reflect,
  setTimeout, clearTimeout,
});
const c = win.__zentralNotesTestSeam.core;
const sidebar = dom.zenSidebar();

const OWNER_ROW = `<label xmlns="http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul" class="tab-text tab-label" role="presentation" fadein="true" pinned="true" value="ThisShouldNotRepeat">ThisShouldNotRepeat</label><label xmlns="http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul" class="zen-tab-sublabel" data-l10n-id="zen-tab-sublabel" data-l10n-args="{&quot;tabSubtitle&quot;: &quot;zen-default-pinned&quot;}" role="presentation">Back to pinned url</label>`;

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

try {
  test("1. the owner-supplied bugged row is two native labels, with the title on both roads", () => {
    assert.match(OWNER_ROW, /class="tab-text tab-label"[^>]*value="ThisShouldNotRepeat">ThisShouldNotRepeat<\/label>/);
    assert.match(OWNER_ROW, /class="zen-tab-sublabel"[^>]*>Back to pinned url<\/label>/);
    const tab = sidebar.tab("ThisShouldNotRepeat", { "bgalazka-notes-item": "n:owner-row", "bgalazka-notes-label": "ThisShouldNotRepeat" });
    const native = tab.querySelector(".tab-label");
    assert.ok(native, "the fake row has the native .tab-label node");
    // The helper starts from Zen's native one-road shape; add the owner-observed
    // legacy `value` road explicitly so this test still pins the supplied DOM.
    native.setAttribute("value", "ThisShouldNotRepeat");
    assert.equal(native.getAttribute("value"), "ThisShouldNotRepeat", "the supplied `value` road");
    assert.equal(native.textContent, "ThisShouldNotRepeat", "and the supplied textContent road");
  });

  test("2. a pure road resolver keeps one XUL text road and is idempotent for Problemy", () => {
    assert.equal(typeof c.cleanSidebarLabelRoads, "function", "the pure label-road helper is exported");
    const bug = c.cleanSidebarLabelRoads({
      label: "Problemy",
      value: "Problemy",
      text: "Problemy",
    });
    assert.deepEqual(JSON.parse(JSON.stringify(bug)), {
      label: "Problemy",
      value: "",
      text: "Problemy",
      repeated: true,
    }, "the exact doubled-roads state is recognized and reduced to one road");
    const again = c.cleanSidebarLabelRoads(bug);
    const roads = (state) => ({ label: state.label, value: state.value, text: state.text });
    assert.deepEqual(roads(again), roads(bug), "applying it twice changes no label road");
    assert.equal(again.repeated, false, "and the resolved state is no longer a doubled-roads diagnosis");
    const genuine = c.cleanSidebarLabelRoads({ label: "ProblemyProblemy", value: "", text: "ProblemyProblemy" });
    assert.equal(genuine.label, "ProblemyProblemy", "a genuine doubled-looking owner title is never shortened");
    assert.equal(genuine.text, "ProblemyProblemy");
    assert.equal(genuine.repeated, false);
  });

  test("3. setSidebarTabLabel repairs the supplied row without writing a second visual road", () => {
    const tab = sidebar.tab("ThisShouldNotRepeat", { "bgalazka-notes-item": "n:owner-row", "bgalazka-notes-label": "ThisShouldNotRepeat" });
    const native = tab.querySelector(".tab-label");
    native.setAttribute("value", "ThisShouldNotRepeat");
    assert.ok(c.setSidebarTabLabel(tab, "ThisShouldNotRepeat"), "the doubled row is repaired once");
    assert.equal(tab.getAttribute("label"), "ThisShouldNotRepeat", "the native tab attribute stays canonical");
    assert.equal(native.getAttribute("value"), null, "the extra XUL `value` road is removed");
    assert.equal(native.textContent, "ThisShouldNotRepeat", "Zen's inherited text road carries the title once");
    assert.equal(c.setSidebarTabLabel(tab, "ThisShouldNotRepeat"), false, "re-applying the repair is idempotent");
    assert.equal(native.getAttribute("value"), null);
    assert.equal(native.textContent, "ThisShouldNotRepeat");
  });

  test("4. restoreSidebarTabLabel heals a doubled pending rewrite from the owned label marker", () => {
    const tab = sidebar.tab("Problemy", { pending: "true", "bgalazka-notes-item": "n:problemy", "bgalazka-notes-label": "Problemy" });
    const native = tab.querySelector(".tab-label");
    native.setAttribute("value", "[pending]");
    native.textContent = "[pending]";
    assert.equal(c.needsLabelRepair(tab), true, "the browser-side placeholder is detected");
    assert.equal(c.restoreSidebarTabLabel(tab, true), true);
    assert.equal(native.getAttribute("value"), null);
    assert.equal(native.textContent, "Problemy");
  });

  console.log(`OW-124 duplicated sidebar title tests passed (${passed})`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
