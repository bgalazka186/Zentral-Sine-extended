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
  const site = h.window.gBrowser.addTab("https://site.test/");
  h.window.gBrowser.selectedTab = site; h.emit("TabSelect", site, {});
  const reused = h.window.gBrowser.addTab("https://reused-normal.test/");
  reused.setAttribute("bgalazka-notes-item", "n:" + note.id);
  reused._zentralNotesUrl = "about:blank#zn-note:" + encodeURIComponent(note.id);
  const ordinaryPress = h.emit("mousedown", reused, { button: 0 });
  assert.equal(ordinaryPress.defaultPrevented, false, "a live normal URL is not protected as a Notes pseudo-tab");
  h.window.gBrowser.selectedTab = reused; h.emit("TabSelect", reused, { detail: { previousTab: tab } });
  assert.equal(h.window.gBrowser.selectedTab, reused, "stale Notes identity cannot bounce a normal tab selection");
  assert.equal(reused.hasAttribute("bgalazka-notes-item"), false, "stale Notes marker is cleared");
  assert.equal(reused._zentralNotesUrl, undefined, "stale Notes remembered URL is cleared");
  assert.equal(h.emit("dragstart", reused).defaultPrevented, false, "stale Notes identity does not block normal tab dragging");
  h.seam.zen.kill(new Error("simulated controller failure")); assert.equal(h.seam.zen.dead, true);

  const down = h.emit("mousedown", tab, { button: 0 });
  assert.equal(down.defaultPrevented, true, "a dead controller no longer lets the browser select the placeholder");
  await Promise.resolve(); await Promise.resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(opened, [note.id], "the click still opens the note");

  h.window.gBrowser.selectedTab = tab; h.emit("TabSelect", tab, { detail: { previousTab: site } }); h.fireTimer(0);
  assert.equal(h.window.gBrowser.selectedTab, site, "keyboard/programmatic selection of the placeholder returns to the site that was open");

  // The exact same internally-created placeholder tab may later be repurposed
  // as a normal web tab. Its WeakSet membership must not make that page inert.
  tab.linkedBrowser.currentURI.spec = "https://reused-internal-tab.test/";
  const reusedDown = h.emit("mousedown", tab, { button: 0 });
  assert.equal(reusedDown.defaultPrevented, false, "a reused internal placeholder is no longer click-protected");
  assert.equal(tab.hasAttribute("bgalazka-notes-item"), false, "the reused placeholder loses its Notes marker");
  assert.equal(tab._zentralNotesUrl, undefined, "the reused placeholder loses its remembered pseudo URL");
  const reusedDrag = h.emit("dragstart", tab);
  assert.equal(reusedDrag.defaultPrevented, false, "the reused web tab can be dragged normally");
  await h.destroy(); console.log("killed-controller placeholder tabs still open their note and never stay selected");
})().catch(e => { console.error(e); process.exitCode = 1; });
