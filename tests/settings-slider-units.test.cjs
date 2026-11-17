"use strict";
/* UI4.9: a slider badge read "7days" and "100000chars". The formatter now owns the space, and it must own it in one
 * place: the native settings rows, the feature panels and the schema sliders all read through the same rule, so a
 * caller that passes " px" and a caller that passes "px" cannot disagree.
 *
 * The rule itself is parsed out of the shipped sources, so a change that reintroduces `value + unit` fails here. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const ROWS = read("extension/settings/controllers/ZentralSettingsRows.js");
const FEATURES = read("extension/settings/controllers/ZentralFeatureSettings.js");
const RUNTIME = read("loader/ZentralRuntime.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok -", name);
}

/* Pull the two formatters out of the sources without booting a browser: they are pure and side-effect free. */
function loadFormatters() {
  const extract = (source, name) => {
    const start = source.indexOf("function " + name + "(");
    assert.ok(start > 0, name + " exists in the shipped source");
    // Walk braces so the whole body is taken, not a fixed slice.
    let depth = 0;
    let index = source.indexOf("{", start);
    const open = index;
    for (; index < source.length; index++) {
      if (source[index] === "{") depth++;
      else if (source[index] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    return source.slice(start, index + 1);
  };
  const tightRows = ROWS.match(/const TIGHT_SLIDER_UNITS = Object\.freeze\(\[(.*?)\]\);/s);
  assert.ok(tightRows, "the tight-unit list is a named constant");
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(
    "const TIGHT_SLIDER_UNITS = Object.freeze([" + tightRows[1] + "]);\n" + extract(ROWS, "formatSliderValue") + "\nthis.rowsFormat = formatSliderValue;",
    sandbox,
  );
  const tightRuntime = RUNTIME.match(/const TIGHT_UNITS = Object\.freeze\(\[(.*?)\]\);/s);
  assert.ok(tightRuntime, "the schema formatter has its own named list");
  vm.runInContext(
    "const TIGHT_UNITS = Object.freeze([" + tightRuntime[1] + "]);\n" + extract(RUNTIME, "formatSchemaValue") + "\nthis.schemaFormat = formatSchemaValue;",
    sandbox,
  );
  return { rows: sandbox.rowsFormat, schema: sandbox.schemaFormat };
}

const { rows, schema } = loadFormatters();

test("a unit separated by a space reads as one phrase", () => {
  assert.equal(rows("7", "days"), "7 days");
  assert.equal(rows("100000", "chars"), "100000 chars");
  assert.equal(rows("100", " ms"), "100 ms", "a caller's leading space does not double");
  assert.equal(rows("2", " frames"), "2 frames");
  assert.equal(rows("30", "s"), "30 s");
});

test("a percentage and a pixel count stay tight, the way they are read", () => {
  assert.equal(rows("80", "%"), "80%");
  assert.equal(rows("12", "px"), "12px");
  assert.equal(rows("12", " px"), "12px");
  assert.equal(schema("42", "%"), "42%");
  assert.equal(schema("8", "px"), "8px");
});

test("no unit prints the value alone, and a missing value never prints the word undefined", () => {
  assert.equal(rows("7", ""), "7");
  assert.equal(rows("7", null), "7");
  assert.equal(rows("7", "   "), "7", "whitespace is not a unit");
  assert.equal(rows("", "days"), "", "an empty value does not become ' days'");
  assert.equal(rows(null, "days"), "");
  assert.equal(schema("", "days"), "");
  assert.equal(schema(undefined, "px"), "");
});

test("the schema formatter and the row formatter agree on every shipped unit", () => {
  const units = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "settings.json") {
        const json = JSON.parse(fs.readFileSync(full, "utf8"));
        const scan = (node) => {
          if (!node || typeof node !== "object") return;
          if (Array.isArray(node)) return node.forEach(scan);
          if (node.numeric && typeof node.numeric.unit === "string") units.add(node.numeric.unit);
          for (const value of Object.values(node)) scan(value);
        };
        scan(json);
      }
    }
  };
  walk(root + "/additional");
  walk(root + "/extension");
  assert.ok(units.size >= 4, "the settings declare several units");
  for (const unit of units) {
    assert.equal(schema("5", unit), rows("5", unit), "one rule for " + JSON.stringify(unit));
  }
});

test("the sources no longer concatenate a value with a unit by hand", () => {
  assert.ok(!/badge\.textContent = (?:input\.)?value \+ suffix/.test(ROWS), "the native rows call the formatter");
  assert.ok(!/control\.badge\.textContent = value \+ unit/.test(FEATURES), "the feature panels call the formatter");
  assert.ok(!/readout\.textContent = isOff \? "Default" : value \+ unit/.test(RUNTIME), "the schema sliders call the formatter");
  // Every call site still goes through the shared helper.
  assert.ok(ROWS.includes("formatSliderValue(input.value, suffix)"));
  assert.ok(FEATURES.includes("formatSliderValue(value, unit)"));
  assert.ok(RUNTIME.includes("formatSchemaValue(value, unit)"));
});

console.log("\nPASS settings-slider-units (" + passed + " tests)");
