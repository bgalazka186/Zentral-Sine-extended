"use strict";
const assert = require("node:assert/strict");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");

// After the Zen folder controller's kill switch trips, its placeholder tabs stay in the sidebar as inert pinned
// about:blank tabs. Clicking one must still open its note and must never leave a blank page selected.
(async () => {
  const h = createFakeZen({ prefs: { "zen.workspace.zentral.notes.zen_folder": "all" } });
  await h.seam.ensureStore(); h.fireTimer(6500); await Promise.resolve();
  const note = h.seam.store.create("# Killed controller note", "");
  h.seam.zen.runNow();
  const tab = h.document.querySelectorAll("tab[bgalazka-notes-item]").find(t => t.getAttribute("bgalazka-notes-item") === "n:" + note.id);
  assert.ok(tab, "the note has a sidebar placeholder tab");
  const opened = []; h.window.__zentralNotesTestSeam.onZenOpenNote = id => opened.push(id);
  h.seam.zen.kill(new Error("simulated controller failure")); assert.equal(h.seam.zen.dead, true);

  const site = h.window.gBrowser.addTab("https://site.test/"); h.window.gBrowser.selectedTab = site; h.emit("TabSelect", site, {});
  const down = h.emit("mousedown", tab, { button: 0 });
  assert.equal(down.defaultPrevented, true, "a dead controller no longer lets the browser select the placeholder");
  await Promise.resolve(); await Promise.resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(opened, [note.id], "the click still opens the note");

  h.window.gBrowser.selectedTab = tab; h.emit("TabSelect", tab, { detail: { previousTab: site } }); h.fireTimer(0);
  assert.equal(h.window.gBrowser.selectedTab, site, "keyboard/programmatic selection of the placeholder returns to the site that was open");
  await h.destroy(); console.log("killed-controller placeholder tabs still open their note and never stay selected");
})().catch(e => { console.error(e); process.exitCode = 1; });
