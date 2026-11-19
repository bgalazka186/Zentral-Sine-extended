"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { scaleBudget, clampScale } = require("./helpers/perf-budget.cjs");

test("performance ceilings scale upward with a calibrated machine ratio", () => {
  assert.equal(scaleBudget(100, 1), 100);
  assert.equal(scaleBudget(100, 1.5), 150);
  assert.equal(scaleBudget(100, 3), 300);
  assert.equal(scaleBudget(100, 9), 300, "a noisy calibration cannot expand ceilings without bound");
  assert.equal(scaleBudget(100, 0.4), 100, "fast machines keep the baseline ceiling");
  assert.equal(clampScale(Number.NaN), 1);
  assert.throws(() => scaleBudget(0), /positive finite/);
});
