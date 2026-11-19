"use strict";
/* OW-42: 3,600 production-shaped 1 Hz clock refreshes; budget DOM work, layout reads and formatter allocations. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");
const { scaleBudget } = require("./helpers/perf-budget.cjs");

const source = fs.readFileSync(path.resolve(__dirname, "../additional/widgets/ZentralWidgets.uc.js"), "utf8");
let formatterCreations = 0;
let intlPartsLists = 0;
const CountingIntl = Object.create(Intl);
CountingIntl.DateTimeFormat = function (locale, options) {
  formatterCreations++;
  const formatter = new Intl.DateTimeFormat(locale, options);
  return {
    formatToParts(value) {
      intlPartsLists++;
      return formatter.formatToParts(value);
    },
    format(value) {
      return formatter.format(value);
    },
  };
};

const Services = { prefs: {}, obs: {} };
const runtime = { services: {}, register(definition) { this.definition = definition; } };
const window = { ZentralRuntime: runtime, __zentralWidgetsTestSeam: {} };
const context = vm.createContext({
  window,
  Services,
  globalThis: { Services },
  Intl: CountingIntl,
  console: { log() {}, warn() {}, error() {} },
});
vm.runInContext(source, context);
const core = window.__zentralWidgetsTestSeam.core;
assert.ok(core && typeof core.renderClockElements === "function", "production clock render helper is exported");

let nodeCreations = 0;
let layoutReads = 0;
function countedNode() {
  nodeCreations++;
  let text = "";
  let hidden = false;
  const attrs = new Map();
  const counts = { textWrites: 0, hiddenWrites: 0, attributeWrites: 0 };
  const node = {
    counts,
    get textContent() { return text; },
    set textContent(value) { counts.textWrites++; text = String(value); },
    get hidden() { return hidden; },
    set hidden(value) { counts.hiddenWrites++; hidden = Boolean(value); },
    getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
    setAttribute(name, value) { counts.attributeWrites++; attrs.set(name, String(value)); },
    getBoundingClientRect() { layoutReads++; throw new Error("clock render must never force layout"); },
    get offsetHeight() { layoutReads++; throw new Error("clock render must never read layout"); },
  };
  return node;
}
const elements = {
  wrap: countedNode(),
  timeEl: countedNode(),
  secEl: countedNode(),
  merEl: countedNode(),
  zoneEl: countedNode(),
};
const opts = {
  format: "12h",
  showSeconds: true,
  showZone: true,
  locale: "en-US",
  timeZone: "UTC",
};
core.clearClockDateTimeFormatCache();
const startMs = Date.UTC(2026, 10, 16, 14, 5, 30, 0);
let now = startMs;
let staticKey = "";
const first = core.formatClockParts(now, opts);
staticKey = core.renderClockElements(elements, first, staticKey);
const nodeCountAtStart = nodeCreations;
for (const node of Object.values(elements)) {
  node.counts.textWrites = 0;
  node.counts.hiddenWrites = 0;
  node.counts.attributeWrites = 0;
}

const startedAt = performance.now();
let snapshots = 0;
let steadyTicks = 0;
let steadyTextWrites = 0;
let steadyOtherTextWrites = 0;
let maxSteadyMutations = 0;
let priorTextWrites = 0;
let priorAttrWrites = 0;
const nodes = Object.values(elements);
for (let tick = 1; tick <= 3600; tick++) {
  now += 1000;
  const value = core.formatClockParts(now, opts);
  staticKey = core.renderClockElements(elements, value, staticKey);
  snapshots++;
  const textWrites = nodes.reduce((sum, node) => sum + node.counts.textWrites, 0);
  const attrWrites = elements.wrap.counts.attributeWrites;
  const tickTextWrites = textWrites - priorTextWrites;
  const tickAttrWrites = attrWrites - priorAttrWrites;
  priorTextWrites = textWrites;
  priorAttrWrites = attrWrites;
  const minuteBoundary = value.seconds === "00";
  if (!minuteBoundary) {
    steadyTicks++;
    steadyTextWrites += tickTextWrites;
    steadyOtherTextWrites += tickTextWrites - (tickTextWrites && elements.secEl.counts.textWrites > 0 ? 1 : 0);
    maxSteadyMutations = Math.max(maxSteadyMutations, tickTextWrites + tickAttrWrites);
    assert.equal(tickTextWrites, 1, "steady second must write exactly one text node");
    assert.equal(tickAttrWrites, 0, "steady second must not mutate clock attributes");
  } else {
    assert.ok(tickTextWrites <= 2, "minute boundary may update static time plus seconds");
    assert.ok(tickAttrWrites <= 2, "minute boundary may update minute key and accessible label");
  }
}
const elapsedMs = performance.now() - startedAt;
const totalTextWrites = nodes.reduce((sum, node) => sum + node.counts.textWrites, 0);
const secondsWrites = elements.secEl.counts.textWrites;
const otherTextWrites = totalTextWrites - secondsWrites;
const formatterCount = formatterCreations;
const partLists = intlPartsLists;
console.log(
  "OW-42 PERF",
  JSON.stringify({
    ticks: 3600,
    elapsedMs: Number(elapsedMs.toFixed(2)),
    msPerTick: Number((elapsedMs / 3600).toFixed(4)),
    textWrites: totalTextWrites,
    secondsWrites,
    otherTextWrites,
    steadyTicks,
    steadyTextWrites,
    steadyOtherTextWrites,
    maxSteadyMutations,
    attributeWrites: elements.wrap.counts.attributeWrites,
    formatterCreations: formatterCount,
    intlPartsLists: partLists,
    resultSnapshots: snapshots,
    domNodesDuringTicks: nodeCreations - nodeCountAtStart,
    layoutReads,
  }),
);
assert.equal(snapshots, 3600);
assert.equal(secondsWrites, 3600, "one seconds-span update per tick, including minute rollovers");
assert.equal(steadyTicks, 3540);
assert.equal(steadyTextWrites, steadyTicks);
assert.equal(steadyOtherTextWrites, 0);
assert.equal(otherTextWrites, 60, "static time text changes only at minute boundaries");
assert.equal(maxSteadyMutations, 1);
assert.ok(formatterCount <= 2, "Intl.DateTimeFormat instances are cached across all ticks");
assert.ok(partLists <= 7202, "only the civil-time and display formatter part lists are produced per tick");
assert.equal(nodeCreations - nodeCountAtStart, 0, "no DOM nodes are allocated in the tick path");
assert.equal(layoutReads, 0, "seconds ticks do not perform layout-forcing reads");
assert.ok(elapsedMs <= scaleBudget(300), `3,600 clock ticks exceeded JS budget: ${elapsedMs.toFixed(2)} ms`);
