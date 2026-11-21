"use strict";
/* OW-121 look follow-up: visual defaults and the contrast failsafe are provable
 * without a screenshot or a live Zen window. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const CSS = read("additional/boost/ZentralBoostWidget.css").replace(/\/\*[\s\S]*?\*\//g, "");
const WIDGET = read("additional/boost/ZentralBoostWidget.js");
const WIDGETS_CSS = read("additional/widgets/ZentralWidgets.css");
const BOOST = read("additional/boost/ZentralBoost.uc.js");
const PREVIEW = read("docs/boost-widget-preview.html");

const tests = [];
const test = (name, run) => tests.push([name, run]);

function rules(source) {
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
    selector: selector.trim(),
    declarations: Object.fromEntries(body.split(";").map((part) => {
      const split = part.indexOf(":");
      return split < 0 ? null : [part.slice(0, split).trim().toLowerCase(), part.slice(split + 1).trim()];
    }).filter(Boolean)),
  }));
}

function loadLookHelpers() {
  const win = {};
  win.window = win;
  vm.runInNewContext(WIDGET, { window: win }, { filename: "ZentralBoostWidget.js" });
  return win.__zentralBoostWidgetModule;
}

function fakeElement(style, parentElement = null) {
  const attrs = new Map();
  const el = {
    parentElement,
    ownerDocument: null,
    setAttribute(name, value) { attrs.set(name, String(value)); },
    getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
    removeAttribute(name) { attrs.delete(name); },
    attrs,
  };
  el._computed = style;
  return el;
}

function makeView(styles, dark = false) {
  return {
    matchMedia: () => ({ matches: dark }),
    getComputedStyle(el) { return styles.get(el) || {}; },
  };
}

test("Boost color/background declarations avoid Zen accent and secondary-surface variables", () => {
  for (const rule of rules(CSS)) {
    if (!/(?:\.zbw-|#zentral-boost-widget)/.test(rule.selector)) continue;
    for (const property of ["color", "background", "background-color"]) {
      const value = rule.declarations[property];
      if (value) assert.doesNotMatch(value, /--zen-primary-color|--zen-colors-secondary/, `${rule.selector} ${property}`);
    }
  }
});

test("Boost default surfaces match Widgets theme colors instead of tinting every card white", () => {
  const surface = /--zen-colors-tertiary,\s*var\(--toolbar-field-background-color,\s*rgba\(127,\s*127,\s*127,\s*0\.14\)\)\)\s*78%,\s*transparent/;
  assert.match(CSS, /background:\s*var\(--zbw-card-bg,[\s\S]*--zen-colors-tertiary[\s\S]*78%,\s*transparent/);
  assert.match(WIDGETS_CSS, /background:\s*var\(--zw-card-bg,[\s\S]*--zen-colors-tertiary[\s\S]*78%,\s*transparent/);
  assert.match(CSS, surface, "Boost and Widgets use the same neutral tertiary surface blend");
  assert.match(CSS, /color:\s*var\(--zbw-card-text,\s*var\(--zen-colors-text,\s*inherit\)\)/);
  assert.match(CSS, /border:\s*1px solid color-mix\(in srgb,\s*currentColor 11%,\s*transparent\)/);
  assert.match(CSS, /\.zbw-action,[\s\S]*?background:\s*transparent/);
  assert.match(CSS, /background:\s*var\(--zw-hover,\s*rgba\(128,\s*128,\s*128,\s*0\.16\)\)/);
  assert.doesNotMatch(CSS, /background:\s*color-mix\(in srgb,\s*currentColor 8%,\s*transparent\)/);
});

test("Boost mirrors Widgets background/text overrides and removes them on theme reset", () => {
  const helpers = loadLookHelpers();
  assert.equal(typeof helpers?.copyWidgetAppearance, "function");
  const values = new Map();
  const root = { style: {
    getPropertyValue(name) { return values.get(name) || ""; },
    setProperty(name, value) { values.set(name, String(value)); },
    removeProperty(name) { values.delete(name); },
  } };
  const trayValues = new Map([["--zw-card-bg", " #202b38 "], ["--zw-card-text", "#edf2fa"]]);
  const tray = { style: { getPropertyValue(name) { return trayValues.get(name) || ""; } } };
  const copied = helpers.copyWidgetAppearance(root, tray);
  assert.equal(copied.background, "#202b38");
  assert.equal(copied.text, "#edf2fa");
  assert.equal(values.get("--zbw-card-bg"), "#202b38");
  assert.equal(values.get("--zbw-card-text"), "#edf2fa");
  trayValues.clear();
  const cleared = helpers.copyWidgetAppearance(root, tray);
  assert.equal(cleared.background, "");
  assert.equal(cleared.text, "");
  assert.equal(values.has("--zbw-card-bg"), false);
  assert.equal(values.has("--zbw-card-text"), false);
  assert.match(WIDGET, /adapter\.observeWidgetAppearanceChange\(scheduleWidgetAppearanceSync\)/);
  assert.match(BOOST, /zen\.workspace\.zentral\.widgets\.appearance\.background/);
  assert.match(BOOST, /zen\.workspace\.zentral\.widgets\.appearance\.text/);
});

test("every Boost surface rule carries an explicit readable text color contract", () => {
  for (const rule of rules(CSS)) {
    if (!/(?:\.zbw-|#zentral-boost-widget)/.test(rule.selector)) continue;
    if (!("background" in rule.declarations) && !("background-color" in rule.declarations)) continue;
    const color = rule.declarations.color;
    assert.ok(color, `${rule.selector} sets a background and must also set text color`);
    if (/data-zbw-contrast\s*=\s*["']?forced/.test(rule.selector)) {
      assert.match(color, /^#(?:f3f3f3|1b1b1d)$/i, `${rule.selector} uses the paired forced-palette foreground`);
    } else {
      assert.match(color, /\binherit\b|currentColor|var\(--zen-colors-text/, `${rule.selector} inherits or follows current text`);
    }
  }
  assert.match(CSS, /color:\s*var\(--zbw-card-text,\s*var\(--zen-colors-text,\s*inherit\)\)/);
  assert.match(CSS, /background:\s*var\(--zbw-card-bg,[\s\S]*--zen-colors-tertiary/);
  assert.match(CSS, /border:\s*1px solid color-mix\(in srgb,\s*currentColor 11%,\s*transparent\)/);
});

test("the 146px boundary keeps 2x2 labels readable before the compact four-action row", () => {
  assert.match(CSS, /container-type:\s*inline-size/);
  assert.match(CSS, /container-name:\s*zbw/);
  assert.match(CSS, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(CSS, /@container\s+zbw\s*\(min-width:\s*150px\)/);
  assert.ok(146 < 150, "146 px card content stays in the readable 2x2 fallback");
  assert.match(CSS, /font-size:\s*9px !important;\s*letter-spacing:\s*-0\.1px !important/);
  assert.match(CSS, /\.zbw-action\[data-zbw-game-mode-on="true"\]::before/);
  assert.match(CSS, /@container\s+zbw\s*\(min-width:\s*280px\)/);
  assert.match(CSS, /@container\s+zbw\s*\(max-width:\s*130px\)/);
  assert.match(CSS, /flex-wrap:\s*wrap/);
  assert.match(CSS, /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.doesNotMatch(CSS, /\.zbw-row[\s\S]{0,260}max-height:\s*26px/);
  assert.doesNotMatch(CSS, /\.zbw-action[^{}]*\{[^}]*max-width:\s*\d+px/i);
  assert.match(CSS, /\.zbw-action[\s\S]{0,500}min-height:\s*24px/);
  assert.match(CSS, /\.zbw-action[\s\S]{0,500}height:\s*24px/);
  assert.match(CSS, /\.zbw-action[\s\S]{0,500}focus-visible/);
  assert.doesNotMatch(CSS, /\.zbw-label[^{}]*\{[^}]*text-overflow:\s*ellipsis/);
  assert.doesNotMatch(CSS, /-webkit-line-clamp|\.zbw-toast-line[^{}]*\{[^}]*overflow:\s*hidden/);
  assert.doesNotMatch(CSS, /\.zbw-action\[disabled\][^{}]*\{[^}]*opacity:/);
});

test("contrastRatio follows WCAG and the effective background composites alpha for at most 12 ancestors", () => {
  const helpers = loadLookHelpers();
  assert.equal(typeof helpers?.contrastRatio, "function");
  assert.equal(typeof helpers?.effectiveBackground, "function");
  assert.ok(Math.abs(helpers.contrastRatio("#000000", "#ffffff") - 21) < 0.001);
  assert.ok(helpers.contrastRatio("#767676", "#ffffff") >= 4.5, "threshold-passing gray");
  assert.ok(helpers.contrastRatio("#777777", "#ffffff") < 4.5, "threshold-failing gray");

  const parentStyles = new Map();
  const view = makeView(parentStyles);
  const parent = fakeElement({ color: "rgb(255, 255, 255)", backgroundColor: "rgb(0, 0, 255)" });
  const child = fakeElement({ color: "rgb(255, 255, 255)", backgroundColor: "rgba(255, 0, 0, 0.5)" }, parent);
  parent.ownerDocument = child.ownerDocument = { defaultView: view };
  parentStyles.set(parent, parent._computed);
  parentStyles.set(child, child._computed);
  assert.equal(helpers.effectiveBackground(child), "rgb(128, 0, 128)");

  let reads = 0;
  const chainStyles = new Map();
  const boundedView = { matchMedia: () => ({ matches: false }), getComputedStyle(el) { reads++; return chainStyles.get(el) || {}; } };
  let node = null;
  for (let i = 0; i < 20; i++) {
    const next = fakeElement({ backgroundColor: i === 19 ? "rgb(0, 0, 0)" : "transparent" }, node);
    next.ownerDocument = { defaultView: boundedView };
    chainStyles.set(next, next._computed);
    node = next;
  }
  helpers.effectiveBackground(node);
  assert.ok(reads <= 12, `computed styles read ${reads} ancestors; the cap is 12`);
});

test("low contrast switches to the luminance-matched forced palette and good contrast clears it", () => {
  const helpers = loadLookHelpers();
  assert.equal(typeof helpers?.applyContrastSafety, "function");
  const styles = new Map();
  const view = makeView(styles);
  const parent = fakeElement({ color: "rgb(37, 37, 37)", backgroundColor: "rgb(37, 37, 37)" });
  const card = fakeElement({ color: "rgb(37, 37, 37)", backgroundColor: "rgba(37, 37, 37, 0.08)" }, parent);
  parent.ownerDocument = card.ownerDocument = { defaultView: view };
  styles.set(parent, parent._computed);
  styles.set(card, card._computed);
  const forced = helpers.applyContrastSafety(card);
  assert.equal(forced.forced, true);
  assert.equal(card.getAttribute("data-zbw-contrast"), "forced");
  assert.equal(card.getAttribute("data-zbw-contrast-surface"), "dark");
  assert.match(CSS, /data-zbw-contrast\s*=\s*["']forced["'][^{}]*data-zbw-contrast-surface\s*=\s*["']dark["'][^{}]*\{[^}]*background:\s*#1e1f22[^}]*color:\s*#f3f3f3/i);
  assert.match(CSS, /data-zbw-contrast\s*=\s*["']forced["'][^{}]*data-zbw-contrast-surface\s*=\s*["']light["'][^{}]*\{[^}]*background:\s*#f3f3f4[^}]*color:\s*#1b1b1d/i);

  styles.set(parent, { color: "rgb(27, 27, 29)", backgroundColor: "rgb(255, 255, 255)" });
  styles.set(card, { color: "rgb(27, 27, 29)", backgroundColor: "transparent" });
  const normal = helpers.applyContrastSafety(card);
  assert.equal(normal.forced, false);
  assert.equal(card.getAttribute("data-zbw-contrast"), null);
  assert.equal(card.getAttribute("data-zbw-contrast-surface"), null);

  const whiteStyles = new Map();
  const whiteView = makeView(whiteStyles);
  const whiteParent = fakeElement({ color: "rgb(27, 27, 29)", backgroundColor: "rgb(255, 255, 255)" });
  const readableCard = fakeElement({ color: "rgb(27, 27, 29)", backgroundColor: "transparent" }, whiteParent);
  const lowValue = fakeElement({ color: "rgb(229, 160, 75)", backgroundColor: "transparent" }, readableCard);
  whiteParent.ownerDocument = readableCard.ownerDocument = lowValue.ownerDocument = { defaultView: whiteView };
  whiteStyles.set(whiteParent, whiteParent._computed);
  whiteStyles.set(readableCard, readableCard._computed);
  whiteStyles.set(lowValue, lowValue._computed);
  readableCard.querySelectorAll = () => [lowValue];
  const descendantForced = helpers.applyContrastSafety(readableCard);
  assert.equal(descendantForced.forced, true, "the accent-colored value cannot hide low contrast behind the card foreground");
  assert.equal(readableCard.getAttribute("data-zbw-contrast-surface"), "light");
  assert.match(CSS, /data-zbw-contrast="forced"[^{}]*\.zbw-value\[data-zbw-level="low"\][^{}]*\{\s*color:\s*inherit/);
});

test("contrast safety runs on mount, value/menu/toast paints, workspace changes and color-scheme changes", () => {
  const paintValue = WIDGET.slice(WIDGET.indexOf("function paintValue()"), WIDGET.indexOf("function computePreviewLine()"));
  const paintMenu = WIDGET.slice(WIDGET.indexOf("function paintMenu()"), WIDGET.indexOf("function handleGameModeEvent"));
  const showToast = WIDGET.slice(WIDGET.indexOf("function showToast("), WIDGET.indexOf("async function runCleanAction"));
  assert.match(paintValue, /updateContrast\(\)/);
  assert.match(paintMenu, /updateContrast\(\)/);
  assert.match(showToast, /updateContrast\(\)/);
  assert.match(WIDGET, /ownListen\(window, "zen-workspace-switched", updateContrast\)/);
  assert.match(WIDGET, /window\.matchMedia\?\.\("\(prefers-color-scheme: dark\)"\)/);
  assert.match(WIDGET, /updateContrast\(\);\s*refresh\(\);\s*return instance/);
  assert.doesNotMatch(WIDGET, /MutationObserver[^;]*:root[^;]*style/i, "contrast is event-driven, not root-style observed");
});

test("English and Polish short action labels are at most nine characters", () => {
  const start = BOOST.indexOf("  const BOOST_WIDGET_STRINGS = Object.freeze({");
  const end = BOOST.indexOf("  // B5/OW-92", start);
  assert.ok(start >= 0 && end > start, "Boost exposes its pure card strings");
  const strings = new Function(BOOST.slice(start, end) + "\nreturn BOOST_WIDGET_STRINGS;")();
  for (const language of ["en", "pl"]) {
    for (const key of ["card.light", "card.deep", "card.game", "card.restore"]) {
      assert.ok(Array.from(strings[language][key]).length <= 9, `${language} ${key}: ${strings[language][key]}`);
    }
  }
});

test("Restore badge output is compact and the DOM keeps the long count in title and aria-label", () => {
  const helpers = loadLookHelpers();
  assert.equal(typeof helpers?.restoreBadgeText, "function");
  for (const count of [1, 9, 12, 99, 100, 9999]) {
    const badge = helpers.restoreBadgeText(count);
    assert.ok(Array.from(badge).length <= 3, `${count} -> ${badge}`);
  }
  assert.equal(helpers.restoreBadgeText(100), "99+");
  assert.match(WIDGET, /button\.setAttribute\("aria-label",\s*item\.label/);
  assert.match(WIDGET, /item\.id === "restore"[\s\S]{0,400}restoreBadgeText/);
  assert.match(WIDGET, /data-zbw-action/);
});

test("preview covers the 146px readability check, four themes, toast, Game Mode ON and contrast helper", () => {
  assert.match(PREVIEW, /const widths = \[140, 146, 170, 220, 300, 360\]/);
  assert.match(PREVIEW, /146 px narrow check uses a readable 2×2 fallback/);
  assert.match(PREVIEW, /\$\{width\}px/);
  for (const theme of ["light", "dark", "owner-like", "bad"]) assert.match(PREVIEW, new RegExp(theme, "i"));
  assert.match(PREVIEW, /Game Mode:/);
  assert.match(PREVIEW, /marker: true, checked: true/);
  assert.match(PREVIEW, /aria-checked/);
  assert.match(PREVIEW, /Restore/);
  assert.match(PREVIEW, /label\.textContent = "Memory Boost"/);
  assert.match(PREVIEW, /applyContrastSafety/);
  assert.match(PREVIEW, /Widgets appearance override/);
  assert.match(PREVIEW, /copyWidgetAppearance/);
  assert.match(PREVIEW, /ZentralBoostWidget\.css/);
  const inlineScript = PREVIEW.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
  assert.ok(inlineScript, "preview has its dynamic DOM renderer");
  assert.doesNotThrow(() => new vm.Script(inlineScript), "preview renderer parses as JavaScript");
  assert.match(read(".gitignore"), /!docs\/boost-widget-preview\.html/);
});

(async () => {
  let failed = 0;
  for (const [name, run] of tests) {
    try {
      await run();
      console.log("ok -", name);
    } catch (error) {
      failed++;
      console.error("not ok -", name);
      console.error(error.stack || error);
    }
  }
  console.log(`\nboost-widget-look: ${tests.length - failed}/${tests.length} passed`);
  if (failed) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
