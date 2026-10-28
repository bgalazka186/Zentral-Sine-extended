"use strict";
/* One Notes icon everywhere: the sheet/bar buttons (ICONS.note) and the settings window category
 * (settingsIcons.note in the runtime) must be the same drawing, and the layout must use it. */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const pick = (src, re, what) => { const m = re.exec(src); assert.ok(m, what + " not found"); return m[1]; };
const gui = pick(read("additional/notes/ZentralNotes.uc.js"), /\bnote: "([^"]+)"/, "ICONS.note");
const settings = pick(read("loader/ZentralRuntime.js"), /\bnote: "([^"]+)"/, "settingsIcons.note");
assert.equal(settings, gui, "settings window and GUI use different Notes icons");
const layout = JSON.parse(read("extension/settings/layout.json"));
assert.equal(layout.categories.find((c) => c.id === "notes").icon, "note");
console.log("ok - Notes uses one icon in the GUI and in the settings window");
