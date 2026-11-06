"use strict";
/* S6 W5: the one-event contract between Notes (additional/notes) and the extended panel's autohide
 * (extension/panels/interaction/ZentralPanelHover.js). Static: both sides must use the same event name,
 * the panel side must bring a hidden panel back only when it is open and not closing, hold it, and clean the
 * listener up. Real autohide behavior still needs a live Zen. */
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const read = (rel) => fs.readFileSync(path.resolve(__dirname, "..", rel), "utf8");
const hover = read("extension/panels/interaction/ZentralPanelHover.js");
const notes = read("additional/notes/ZentralNotes.uc.js");
const EVENT = "zentral-notes-request-reveal";
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("ok -", name); };

test("both sides use the same event name", () => {
  assert.ok(notes.includes(`new Event("${EVENT}")`), "Notes dispatches it on the document");
  assert.ok(hover.includes(`document.addEventListener("${EVENT}"`), "the panel code listens on the document");
});
test("the panel side only reveals an open, not closing panel, holds it and un-hides through the real function", () => {
  const i = hover.indexOf("const onNotesRevealRequest");
  assert.ok(i > 0);
  const body = hover.slice(i, hover.indexOf("document.addEventListener", i));
  assert.ok(/hasAttribute\("open"\)/.test(body) && /hasAttribute\("closing"\)/.test(body));
  assert.ok(/hoverHoldUntil = Date\.now\(\) \+ \d+/.test(body), "a short hold so the leave logic does not hide it again at once");
  assert.ok(body.includes("clearHoverHide()") && body.includes("setHoverPanelHidden(false)"));
});
test("the listener is removed with the module", () => {
  assert.ok(new RegExp(`removeEventListener\\(\\s*"${EVENT}"`).test(hover));
});
test("Notes never touches the panel's own attributes to reveal it", () => {
  const i = notes.indexOf("async function ensurePanelShown");
  const body = notes.slice(i, notes.indexOf("function closeOthers", i));
  assert.ok(!/removeAttribute\("bgalazka-hover-panel-hidden"\)/.test(body));
  assert.ok(!/setAttribute\("bgalazka-hover-panel-hidden"/.test(body));
});
console.log(`\n${passed} notes panel bridge tests passed`);
