"use strict";
/* The panel health dot (edge of the panel URL field): a blank or sleeping panel explains itself.
 * panelHealth() is a pure function of plain facts; it is cut out of the real source and run in a vm. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("ok -", name); };

const src = read("extension/panels/navigation/ZentralPanelToolbar.uc.js");
const block = src.slice(src.indexOf("    const HEALTH_RELOAD_LIMIT"), src.indexOf("    function panelHealthInfo"));
assert.ok(block.includes("function panelHealth"), "panelHealth found in the source");
const ctx = vm.createContext({});
vm.runInContext(block + "\nglobalThis.panelHealth = panelHealth;", ctx);
const h = (info) => ctx.panelHealth(info).state;
const fine = { connected: true, blank: false, loading: false, pending: false, hasWindowGlobal: true, active: true, visible: true, reloads: 0 };

test("a healthy page shows no dot", () => {
  assert.equal(h(fine), "ok");
  assert.equal(ctx.panelHealth(fine).reason, "");
});
test("no browser or a detached one says nothing", () => {
  assert.equal(h(null), "none");
  assert.equal(h({ ...fine, connected: false }), "none");
});
test("loading, blank, asleep and paused pages are told apart", () => {
  assert.equal(h({ ...fine, loading: true }), "loading");
  assert.equal(h({ ...fine, blank: true }), "blank");
  assert.equal(h({ ...fine, pending: true }), "asleep");
  assert.equal(h({ ...fine, hasWindowGlobal: false }), "asleep");
  assert.equal(h({ ...fine, active: false, visible: true }), "recovering");
  assert.equal(h({ ...fine, active: false, visible: false }), "ok", "an inactive page nobody can see is normal");
});
test("a blank page walks recovering -> failed with the recovery's reload count", () => {
  assert.equal(h({ ...fine, blank: true, reloads: 1 }), "recovering");
  assert.equal(h({ ...fine, blank: true, reloads: 2 }), "recovering");
  assert.equal(h({ ...fine, blank: true, reloads: 3 }), "failed");
  assert.equal(h({ ...fine, blank: true, loading: true, reloads: 3 }), "recovering", "still loading: not failed yet" );
});
test("every visible state has a one-sentence reason", () => {
  for (const info of [{ ...fine, loading: true }, { ...fine, blank: true }, { ...fine, pending: true }, { ...fine, blank: true, reloads: 3 }, { ...fine, active: false }]) {
    const { reason } = ctx.panelHealth(info);
    assert.ok(reason.length > 5 && reason.length < 140, reason);
  }
});
test("the dot is built hidden, updated on each toolbar sync, and wired to reload and diagnostics", () => {
  assert.match(src, /healthDot\.className = "zen-toolbar-health-dot";\s*healthDot\.hidden = true;/);
  assert.match(src, /syncHealthDot\(toolbar, b\);\s*ctx\.syncSecondaryHealthDot\?\.\(\);\s*if \(backBtn\)/);
  assert.match(src, /reloadPanelFromDot\(getActiveAppBrowser\(\)\)/);
  assert.match(src, /healthDot\.addEventListener\("contextmenu"[\s\S]*?copyDiagnostics\?\.\(\)/);
  assert.match(read("extension/panels/secondary-views/ZentralSecondaryViews.uc.js"), /ctx\.panelHealReloads = \(browser\) => healReloads\.get\(browser\) \|\| 0/);
  assert.match(read("extension/panels/navigation/styles/ZentralPanelToolbar.css"), /\.zen-toolbar-health-dot\[hidden\]\s*\{\s*display: none !important/);
});

// ---- the lower (Triple View) bar -----------------------------------------------------------------------------
const { createPanelWorld } = require("./helpers/fake-panel-window.cjs");
const { openTripleWindow } = require("./helpers/fake-triple-view.cjs");
(async () => {
  const world = createPanelWorld({ sharedGlobal: { Map, Object } });
  const t = openTripleWindow(world, {});
  const synced = [], reloaded = [];
  t.ctx.syncHealthDot = (root, browser) => synced.push([root, browser]);
  t.ctx.reloadPanelFromDot = (browser) => reloaded.push(browser);
  t.link("mail", "chat", 0.5);
  t.autohide(true);
  await world.advance(400);
  t.openApp("mail");
  await world.advance(2500);
  const lower = t.ctx.getAllAppBrowsers().find((b) => b._bgalazkaAppId === "chat");
  const dot = t.document.querySelector(".bgalazka-second-health-dot");
  test("the lower bar has its own dot, hidden until something is wrong", () => {
    assert.ok(dot, "a dot in the lower bar");
    assert.equal(dot.hidden, true);
    assert.match(dot.className, /zen-toolbar-health-dot/, "it shares the main bar's dot styling");
  });
  test("the lower dot is refreshed by recovery passes and reveals, for the lower page", () => {
    assert.ok(synced.length > 0, "it was refreshed");
    assert.ok(synced.every(([, b]) => b === lower), "always for the lower page");
    const before = synced.length;
    t.hide(); world.advance(10); t.reveal();
    return world.advance(500).then(() => assert.ok(synced.length > before, "a reveal refreshes it"));
  });
  await world.advance(600);
  test("clicking the lower dot reloads the lower page, not the upper one", () => {
    dot.dispatchEvent({ type: "click", target: dot, bubbles: false, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
    assert.deepEqual(reloaded, [lower]);
  });
  test("the main toolbar's poll also refreshes the lower dot", () => {
    assert.match(src, /syncHealthDot\(toolbar, b\);\s*ctx\.syncSecondaryHealthDot\?\.\(\);/);
  });
  console.log(`\n${passed} passed`);
  t.stop(); await t.w.close();
})().catch((e) => { console.error(e); process.exit(1); });
