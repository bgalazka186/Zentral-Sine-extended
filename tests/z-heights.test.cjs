"use strict";
/* Keeps z-heights_map.md honest and guards the stacking order that has already caused bugs:
 * panels vs RSS card vs Big Preview vs notes vs settings. */
const assert = require("node:assert/strict"),
  cp = require("node:child_process"),
  fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, "..");
const { rows } = require("../tools/build-z-map.cjs");
const find = (file, re) => {
  const r = rows.filter((x) => x.file.endsWith(file) && re.test(x.where));
  assert.ok(r.length, `z-index not found: ${file} ${re}`);
  return Math.max(...r.map((x) => x.value));
};
const settings = find("extension/settings/styles/ZentralSettingsFoundation.css", /zentral-settings-modal/);
const rss = find("additional/rss/ZentralRssDisplay.css", /bgalazka-rss-card/);
const notes = find("additional/notes/ZentralNotes.css", /data-host="float"/);
const big = find("additional/video/ZentralVideoPreview.css", /data-enlarged/);
const panelRoot = find("zentral/apps/styles/ZentralAppsInjected.css", /zen-app-panel-root/);
const edge = find("extension/appearance/ZentralAppearance.css", /reveal-edge/);
const pillShield = find("extension/panels/floating/ZentralFloatingPanels.css", /drag-shield/);

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("ok -", name); };

test("z-heights_map.md is up to date", () => {
  cp.execFileSync(process.execPath, [path.join(root, "tools/build-z-map.cjs"), "--check"], { stdio: "pipe" });
});
test("normal layers: settings > RSS card > Notes card > Big Preview fallback > panel parts", () => {
  assert.ok(settings > rss, "settings window above RSS card");
  assert.ok(rss > notes && notes > big, "RSS card > Notes card > Big Preview");
  assert.ok(big > pillShield && pillShield >= edge && edge > panelRoot, "Big Preview > pill/edge helpers > panel root");
});
test("RSS card is a top-layer popover that re-enters the top layer on every show", () => {
  const js = fs.readFileSync(path.join(root, "additional/rss/ZentralRssDisplay.uc.js"), "utf8");
  assert.match(js, /setAttribute\("popover", "manual"\)/);
  assert.match(js, /c\.hidden = false;\s*raiseCard\(c\);/, "raised right after it becomes visible");
  assert.match(js, /hidePopover\(\);\s*\n?\s*c\.showPopover\(\)/, "hide+show moves it above earlier popovers");
  assert.match(js, /dropCard\(card\)/, "leaves the top layer when hidden");
  const css = fs.readFileSync(path.join(root, "additional/rss/ZentralRssDisplay.css"), "utf8");
  for (const reset of [/inset:\s*auto/, /margin:\s*0/, /height:\s*auto/])
    assert.match(css, reset, "popover defaults are reset: " + reset);
});
test("Big Preview is the other top-layer user (so ordering depends on show time)", () => {
  const js = fs.readFileSync(path.join(root, "additional/video/controllers/ZentralVideoEnlarge.js"), "utf8");
  assert.match(js, /setAttribute\("popover", "manual"\)/);
  assert.match(js, /showPopover\(\)/);
});
console.log(`\n${passed} z-height tests passed`);
