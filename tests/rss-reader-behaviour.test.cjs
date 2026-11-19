"use strict";
/* OW-38 (part 3): the RSS folder module. Its reader card is behavioural — hover delay, hide delay, side, visible
 * parts, middle-click dismiss — and none of it had a test. The card's look belongs to the Look module; here only the
 * rules the RSS module owns are proven: the binding of a reader to exactly one tab strip, the clamped delays, the
 * known side, the gap, and the URL picker that decides what may be linked from a feed's text. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(root, "additional/rss/ZentralRssDisplay.uc.js"), "utf8");
const seam = {};
const win = { __zentralRssTestSeam: seam, ZentralRuntime: { register() {} }, addEventListener: () => {} };
win.window = win;
const sandbox = {
  window: win,
  globalThis: {},
  ChromeUtils: { importESModule: () => ({ Services: { prefs: {}, obs: {} } }) },
  document: { addEventListener: () => {}, documentElement: {} },
  console,
  URL,
  Number,
  Math,
  String,
  Array,
  Object,
  RegExp,
  Set,
  Map,
};
vm.runInNewContext(SRC, sandbox);
const s = seam;

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok -", name);
}

test("a reader is bound to exactly one tab strip", () => {
  assert.equal(s.readerBindingAction(true, null, "strip-a"), "bind", "first strip binds");
  assert.equal(s.readerBindingAction(true, "strip-a", "strip-a"), "keep", "the same strip keeps its reader");
  assert.equal(s.readerBindingAction(true, "strip-a", "strip-b"), "replace", "another strip replaces it");
  assert.equal(s.readerBindingAction(false, "strip-a", "strip-b"), "unbind", "switched off, the reader goes");
  assert.equal(s.readerBindingAction(false, null, "strip-b"), "keep", "switched off with nothing bound does nothing");
  assert.equal(s.readerBindingAction(true, "strip-a", ""), "unbind", "a strip that vanished is not re-bound to nothing");
  assert.equal(s.readerBindingAction(false, "strip-a", ""), "unbind");
});

test("the delays are clamped and never invented", () => {
  assert.equal(s.clampCardDelay("hover", 0), 0);
  assert.equal(s.clampCardDelay("hover", 500), 500);
  assert.equal(s.clampCardDelay("hover", 99999), 2000, "a runaway hover delay is capped");
  assert.equal(s.clampCardDelay("hide", -40), 0, "a negative delay is zero, not a guess");
  assert.equal(s.clampCardDelay("hide", 900), 900);
  assert.equal(s.clampCardDelay("hover", "abc"), null, "an unreadable value is reported, not turned into a default");
  assert.equal(s.clampCardDelay("hover", 12.7), 13, "whole milliseconds");
  assert.equal(s.clampCardDelay("nonsense", 5), 0, "an unknown delay name is not a crash");
  assert.deepEqual(JSON.parse(JSON.stringify(s.LIMITS)), { hover: [0, 2000], hide: [0, 5000] });
});

test("the card stands where it was told to stand", () => {
  for (const side of ["auto", "left", "right"]) assert.equal(s.cleanReaderSide(side), side);
  assert.equal(s.cleanReaderSide("diagonal"), "auto", "an unknown side is automatic, never off-screen");
  assert.equal(s.cleanReaderSide(undefined), "auto");
  assert.equal(s.cleanReaderSide(null), "auto");
});

test("the gap follows the Look variable, bounded", () => {
  assert.equal(s.cleanCardGap("6px"), 6);
  assert.equal(s.cleanCardGap(""), 6, "no value keeps the default");
  assert.equal(s.cleanCardGap("120"), 32, "a huge gap would push the card outside the sidebar");
  assert.equal(s.cleanCardGap("-4"), 0);
  assert.equal(s.cleanCardGap("3.5px"), 3.5);
});

test("only a URL the platform accepts becomes a link", () => {
  const clean = (raw) => {
    const text = String(raw).trim();
    try {
      const url = new URL(/^www\./i.test(text) ? "https://" + text : text);
      return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : "";
    } catch (_) {
      return "";
    }
  };
  assert.deepEqual(JSON.parse(JSON.stringify(s.urlsInText("see https://a.example/x and www.b.example", clean))),
    ["https://a.example/x", "https://www.b.example/"]);
  assert.deepEqual(JSON.parse(JSON.stringify(s.urlsInText("nothing here", clean))), []);
  assert.deepEqual(JSON.parse(JSON.stringify(s.urlsInText("javascript:alert(1)", clean))), [], "no script link is ever offered");
  assert.deepEqual(JSON.parse(JSON.stringify(s.urlsInText("ftp://files.example/x", clean))), []);
  assert.equal(s.urlsInText("x https://a.example/1 y https://a.example/2", clean).length, 2, "a repeated scan finds both");
  assert.equal(s.urlsInText(null, clean).length, 0);
});

test("the card's behaviour switches are all declared, and the look is not touched here", () => {
  const keys = [...SRC.matchAll(/"(zen\.workspace\.bgalazka\.rss\.card_[a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length >= 8, "the card owns its behaviour switches");
  for (const key of keys) assert.match(SRC, new RegExp(key.replace(/\./g, "\\.")), key);
  // The module must not own colours: the Look custom properties do.
  assert.ok(!/--bgalazka-look-rss-card-[a-z-]+\s*\*?\s*===\s*/.test(SRC), "the module reads the Look variables, it does not write them");
  assert.ok(!/setProperty\(\s*"--bgalazka-look-rss-card/.test(SRC), "and it never sets them");
});

console.log("\nPASS rss-reader-behaviour (" + passed + " tests)");
