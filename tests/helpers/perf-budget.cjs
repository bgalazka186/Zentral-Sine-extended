"use strict";
const { performance } = require("node:perf_hooks");

const ITERATIONS = 1_500_000;
const REFERENCE_MS = 5.5;
const MIN_SCALE = 1;
const MAX_SCALE = 3;

function clampScale(value) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

function measureCalibration() {
  const samples = [];
  let checksum = 0;
  for (let sample = 0; sample < 3; sample++) {
    let state = (0x12345678 ^ sample) >>> 0;
    const start = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      state = (Math.imul(state ^ i, 1664525) + 1013904223) >>> 0;
    }
    samples.push(performance.now() - start);
    checksum ^= state;
  }
  samples.sort((a, b) => a - b);
  const elapsedMs = samples[1];
  return Object.freeze({
    elapsedMs,
    referenceMs: REFERENCE_MS,
    ratio: elapsedMs / REFERENCE_MS,
    scale: clampScale(elapsedMs / REFERENCE_MS),
    checksum,
  });
}

const calibration = measureCalibration();
const inheritedScale = Number(process.env.ZENTRAL_PERF_BUDGET_SCALE);
const activeScale = Number.isFinite(inheritedScale) && inheritedScale > 0
  ? clampScale(inheritedScale)
  : calibration.scale;

function scaleBudget(baseMs, scale = activeScale) {
  if (!Number.isFinite(baseMs) || baseMs <= 0) throw new TypeError("base budget must be a positive finite number");
  return baseMs * clampScale(scale);
}

module.exports = Object.freeze({ calibration, activeScale, scaleBudget, clampScale });
