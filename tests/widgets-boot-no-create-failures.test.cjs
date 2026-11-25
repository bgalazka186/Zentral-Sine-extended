"use strict";
/* Booting the real widgets feature must not log "widget create failed".
 * Owner console: "[ZentralWidgets] widget create failed: clock ReferenceError: can't access lexical declaration
 * 'timerState' before initialization" (three times at start-up). The clock widget is registered early and every later
 * registerWidget call re-syncs the registered widgets, so a binding its create() reads that is declared further down
 * the file is still in its temporal dead zone. The seam tests never boot the feature, so none of them saw it. */
const assert = require("node:assert/strict");
const { createFakeSidebarHarness } = require("./helpers/fake-widgets-harness.cjs");

const logs = [];
const real = { warn: console.warn, error: console.error };
console.warn = (...a) => logs.push(a.map(String).join(" "));
console.error = (...a) => logs.push(a.map(String).join(" "));
let mounted = [];
(async () => {
try {
  const sink = (...a) => logs.push(a.map(String).join(" "));
  const h = createFakeSidebarHarness({
    "zen.workspace.zentral.widgets.enabled": true,
    "zen.workspace.zentral.widgets.clock.enabled": true,
    "zen.workspace.zentral.widgets.weather.enabled": true,
    "zen.workspace.zentral.widgets.timer.enabled": true,
  }, { console: { log() {}, warn: sink, error: sink } });
  const { api } = h.start();
  await new Promise((r) => setTimeout(r, 40));
  mounted = api.getTray().children.map((el) => el.getAttribute("data-zw-widget"));
} finally {
  console.warn = real.warn;
  console.error = real.error;
}
assert.ok(mounted.includes("clock"), "the clock mounted: " + mounted);
const failures = logs.filter((l) => /create failed|before initialization/.test(l));
assert.deepEqual(failures, [], "no widget may fail to be created at boot:\n" + failures.join("\n"));
console.log("ok - the widgets feature boots without a widget create failure");
})().catch((e) => { console.error(e); process.exit(1); });
