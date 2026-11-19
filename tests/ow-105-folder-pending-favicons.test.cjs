"use strict";

// Regression guard for the Arc unloaded-tab grayscale interaction. The rule
// must be scoped to tabs within Zen folders and must not undo pending/unload or
// opacity state; a child favicon cannot reverse a filter on its tab ancestor.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "../zentral/groups/styles/ZentralGroupsInjected.css"), "utf8");
const rule = css.match(/:root\s+zen-folder\s+tab\[pending="true"\]\s*\{([^}]*)\}/s);
assert.ok(rule, "parked tabs inside Notes, Agenda and live folders have a dedicated exception");
assert.match(rule[1], /filter\s*:\s*none\s*!important/);
assert.doesNotMatch(rule[1], /opacity\s*:/, "the host mod's unloaded-tab opacity remains active");
assert.doesNotMatch(rule[1], /pending\s*:/, "the native pending state is not modified");
console.log("ow-105-folder-pending-favicons: 4 assertions passed");
