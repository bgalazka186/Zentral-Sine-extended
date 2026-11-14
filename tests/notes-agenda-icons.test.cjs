"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");

const css = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.css"), "utf8");
const PREF_AGENDA = "zen.workspace.zentral.notes.agenda_folder";
const PREF_FAVICONS = "zen.workspace.zentral.notes.zen_note_favicons";
const MARK = "bgalazka-notes-agenda-item";

const dateAt = (days, hour = 10, min = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, min, 0, 0);
  return d.toISOString();
};

async function host(extraPrefs = {}) {
  const h = createFakeZen({ prefs: { [PREF_AGENDA]: true, ...extraPrefs } });
  await h.seam.ensureStore();
  h.fireTimer(6500);
  await Promise.resolve();
  return h;
}

(async () => {
  // 1. CSS badge rules exist for event and reminder Agenda tabs.
  assert.match(css, /tab\[bgalazka-notes-agenda-item\]\[bgalazka-notes-agenda-kind="event"\]/);
  assert.match(css, /tab\[bgalazka-notes-agenda-item\]\[bgalazka-notes-agenda-kind="reminder"\]/);

  // 2. Pure favicon & icon setter contract.
  {
    const h = await host();
    const core = h.window.__zentralNotesTestSeam.core;
    const evBlue = core.agendaFaviconUri("blue", "event");
    const remBlue = core.agendaFaviconUri("blue", "reminder");
    const moreUri = core.agendaFaviconUri("", "more");
    const noteBlue = core.noteFaviconUri("blue");
    assert.ok(evBlue.startsWith("data:image/svg+xml,"));
    assert.ok(remBlue.startsWith("data:image/svg+xml,"));
    assert.notEqual(evBlue, remBlue, "event and reminder favicons are visually distinct");
    assert.notEqual(evBlue, noteBlue, "event favicon is distinct from note favicon");
    assert.notEqual(remBlue, moreUri, "reminder favicon is distinct from +N more favicon");
    assert.equal(core.agendaFaviconUri('red"><script>', "event"), core.agendaFaviconUri("", "event"), "unsafe color falls back to palette default");

    const tab = h.document.createElement("tab");
    const img = h.document.createElement("image");
    img.className = "tab-icon-image";
    tab.append(img);
    const setIconCalls = [];
    const gBrowser = { setIcon: (_t, u) => setIconCalls.push(u) };
    core.setAgendaTabIcon(tab, "green", "reminder", { gBrowser, on: true });
    assert.equal(tab.getAttribute("bgalazka-notes-agenda-kind"), "reminder");
    assert.equal(tab.getAttribute("bgalazka-notes-color"), core.colorHex("green"));
    assert.equal(tab.getAttribute("image"), core.agendaFaviconUri("green", "reminder"));
    assert.equal(img.getAttribute("src"), core.agendaFaviconUri("green", "reminder"));
    assert.equal(tab.style.getPropertyValue("--zn-agenda-color"), core.colorHex("green"));
    assert.equal(setIconCalls.length, 1);

    // Calling again with unchanged values is a no-op.
    core.setAgendaTabIcon(tab, "green", "reminder", { gBrowser, on: true });
    assert.equal(setIconCalls.length, 1);

    // Disabling colored favicons strips color tint while keeping distinct kind icon.
    core.setAgendaTabIcon(tab, "green", "reminder", { gBrowser, on: false });
    assert.equal(tab.getAttribute("image"), core.agendaFaviconUri("", "reminder"));
    assert.equal(tab.style.getPropertyValue("--zn-agenda-color"), "");
    await h.destroy();
  }

  // 3. Host integration: note/category color precedence, live recolor, TabAttrModified loop guard, and session discard recovery.
  {
    const h = await host();
    const core = h.window.__zentralNotesTestSeam.core;
    const setIconCalls = [];
    h.window.gBrowser.setIcon = (tab, uri) => {
      setIconCalls.push({ key: tab.getAttribute(MARK), uri });
      tab.setAttribute("image", uri);
      // Simulate real Zen/Firefox firing TabAttrModified synchronously from setIcon.
      h.emit("TabAttrModified", tab, { detail: { changed: ["image"] } });
    };

    h.seam.store.items.upsertCategory({ name: "Work", color: "#3366cc" });
    const coloredNote = h.seam.store.create("# Colored note");
    h.seam.store.setColor(coloredNote.id, "red");
    const plainNote = h.seam.store.create("# Plain note");
    h.seam.store.setColor(plainNote.id, "none");

    h.seam.store.items.upsert({
      id: "ev-cat",
      summary: "Category Event",
      start: { dateTime: dateAt(1, 10, 0) },
      end: { dateTime: dateAt(1, 11, 0) },
      x: { kind: "event", category: "Work", noteId: plainNote.id },
    });
    h.seam.store.items.upsert({
      id: "rem-note",
      summary: "Note Color Reminder",
      start: { dateTime: dateAt(1, 14, 0) },
      x: { kind: "reminder", category: "Work", noteId: coloredNote.id },
    });
    h.seam.agendaController.runNow();

    const tabs = h.document.querySelectorAll(`tab[${MARK}]`);
    assert.equal(tabs.length, 2);
    const evTab = tabs.find((t) => t.getAttribute("bgalazka-notes-agenda-record-id") === "ev-cat");
    const remTab = tabs.find((t) => t.getAttribute("bgalazka-notes-agenda-record-id") === "rem-note");
    assert.ok(evTab && remTab);

    assert.equal(evTab.getAttribute("bgalazka-notes-agenda-kind"), "event");
    assert.equal(evTab.getAttribute("bgalazka-notes-color"), "#3366cc", "category color applies when note is uncolored");
    assert.equal(evTab.getAttribute("image"), core.agendaFaviconUri("#3366cc", "event"));

    assert.equal(remTab.getAttribute("bgalazka-notes-agenda-kind"), "reminder");
    assert.equal(remTab.getAttribute("bgalazka-notes-color"), core.colorHex("red"), "note color overrides category color");
    assert.equal(remTab.getAttribute("image"), core.agendaFaviconUri("red", "reminder"));

    // Updating the category color updates the event tab icon on reconciliation.
    h.seam.store.items.upsertCategory({ name: "Work", color: "#11aa77" });
    h.seam.agendaController.runNow();
    assert.equal(evTab.getAttribute("bgalazka-notes-color"), "#11aa77");
    assert.equal(evTab.getAttribute("image"), core.agendaFaviconUri("#11aa77", "event"));

    // Updating the note color updates the Agenda tab icon on reconciliation.
    h.seam.store.setColor(coloredNote.id, "purple");
    h.seam.agendaController.runNow();
    assert.equal(remTab.getAttribute("bgalazka-notes-color"), core.colorHex("purple"));
    assert.equal(remTab.getAttribute("image"), core.agendaFaviconUri("purple", "reminder"));

    // Idle follow-up run performs zero DOM operations and zero setIcon calls.
    const callsBeforeIdle = setIconCalls.length;
    h.resetOperations();
    h.seam.agendaController.runNow();
    assert.deepEqual(h.operations, []);
    assert.equal(setIconCalls.length, callsBeforeIdle, "idle reconciliation does not re-apply icons");

    // Browser clobbering label, tooltip, and image triggers exactly one bounded repair (no loop).
    const callsBeforeClobber = setIconCalls.length;
    const expectedLabel = remTab.getAttribute("bgalazka-notes-label");
    const expectedTip = remTab.getAttribute("bgalazka-notes-agenda-tooltip");
    remTab.setAttribute("label", "about:blank");
    remTab.setAttribute("tooltiptext", "about:blank");
    remTab.setAttribute("title", "about:blank");
    remTab.removeAttribute("image");
    h.emit("TabAttrModified", remTab, { detail: { changed: ["label", "image", "tooltiptext", "title"] } });
    assert.equal(remTab.getAttribute("label"), expectedLabel);
    assert.equal(remTab.getAttribute("tooltiptext"), expectedTip);
    assert.equal(remTab.getAttribute("title"), expectedTip);
    assert.equal(remTab.getAttribute("image"), core.agendaFaviconUri("purple", "reminder"));
    assert.equal(setIconCalls.length - callsBeforeClobber, 1, "TabAttrModified loop guard repairs once without looping");

    // Re-emitting TabAttrModified when already intact performs zero repairs.
    h.emit("TabAttrModified", remTab, { detail: { changed: ["label", "image"] } });
    assert.equal(setIconCalls.length - callsBeforeClobber, 1);

    // Session discard / SSTabRestored: wipe custom attributes while keeping URL/key and verify recovery.
    const callsBeforeRestore = setIconCalls.length;
    const evExpectedLabel = evTab.getAttribute("bgalazka-notes-label");
    for (const attr of [
      "label", "tooltiptext", "title", "image",
      "bgalazka-notes-label", "bgalazka-notes-agenda-kind",
      "bgalazka-notes-color", "bgalazka-notes-agenda-tooltip",
      "bgalazka-notes-agenda-summary",
    ]) evTab.removeAttribute(attr);
    h.emit("SSTabRestored", evTab);
    assert.equal(evTab.getAttribute("label"), evExpectedLabel);
    assert.equal(evTab.getAttribute("bgalazka-notes-agenda-kind"), "event");
    assert.equal(evTab.getAttribute("bgalazka-notes-color"), "#11aa77");
    assert.equal(evTab.getAttribute("image"), core.agendaFaviconUri("#11aa77", "event"));
    assert.equal(setIconCalls.length - callsBeforeRestore, 1);

    // Toggling PREF.ZEN_FAVICONS switches custom color off while keeping distinct type icons, then restores on re-enable.
    h.setPref(PREF_FAVICONS, false);
    h.seam.agendaController.runNow();
    assert.equal(evTab.getAttribute("image"), core.agendaFaviconUri("", "event"));
    assert.equal(remTab.getAttribute("image"), core.agendaFaviconUri("", "reminder"));
    assert.notEqual(evTab.getAttribute("image"), remTab.getAttribute("image"));

    h.setPref(PREF_FAVICONS, true);
    h.seam.agendaController.runNow();
    assert.equal(evTab.getAttribute("image"), core.agendaFaviconUri("#11aa77", "event"));
    assert.equal(remTab.getAttribute("image"), core.agendaFaviconUri("purple", "reminder"));

    await h.destroy();
  }

  console.log("Agenda icons, badges and attribute repair tests passed");
})();
