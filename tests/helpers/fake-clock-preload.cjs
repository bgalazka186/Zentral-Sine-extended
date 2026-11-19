"use strict";
/* F0.16: run one test file at a chosen instant, so a fixture that reads the real clock is checked at hours nobody is
 * awake for.
 *
 *   FAKE_NOW_ISO=2026-11-17T23:55:00Z TZ=Pacific/Auckland node --require ./tests/helpers/fake-clock-preload.cjs tests/x.test.cjs
 *
 * Only the global `Date` is touched: `Date.now()` and `new Date()` (no arguments) answer the fixed instant, and
 * everything else — parsing, `new Date(ms)`, `Date.UTC`, the prototype — is the real one. `process.env.FAKE_NOW_ISO`
 * has to be set; with it unset this file does nothing, so a normal run is unaffected.
 */
// A file that already pins its own clock (and says so) is left alone: overriding it would be measuring this tool.
const target = process.argv.slice(2).find((a) => a.endsWith(".test.cjs"));
const alreadyFixed = target && (() => {
  try { return /CLOCK_START|FixedDate|FakeDate|setSystemTime/.test(require("node:fs").readFileSync(target, "utf8")); } catch (_) { return false; }
})();
const fixed = process.env.FAKE_NOW_ISO && !alreadyFixed ? Date.parse(process.env.FAKE_NOW_ISO) : NaN;
if (Number.isFinite(fixed)) {
  const RealDate = Date;
  // A subclass keeps every static (parse, UTC) and every prototype method; only construction and now() differ.
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(fixed);
      else super(...args);
    }
    static now() { return fixed; }
  }
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;
  globalThis.Date = FakeDate;
  // The fake browser's windows share one clock base; give them the pinned instant too, so a test that builds two windows
  // cannot have them disagree about the time.
  globalThis.__zentralFakeClockBase = fixed;
}
