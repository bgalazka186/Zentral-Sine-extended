"use strict";
/* Schema defaults and code fallbacks must agree (see tools/check-default-drift.cjs). The settings
 * window and Sine show the schema value; a different literal in a getPref(key, fallback) call would
 * silently change behavior for users who never touched the setting. */
const assert = require("node:assert/strict");
const { scan } = require("../tools/check-default-drift.cjs");
const found = scan();
assert.deepEqual(
  found.map((x) => `${x.file}:${x.line} ${x.key} schema=${JSON.stringify(x.schema)} code=${JSON.stringify(x.code)}`),
  [],
  "schema default and code fallback differ",
);
console.log("ok - schema defaults and code fallbacks agree");
