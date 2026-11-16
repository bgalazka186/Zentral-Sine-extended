"use strict";
/* T3.6a: accessible color-palette contrast across themes, presets, previews, folders, and calendar views (T2.3g). */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const cal = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const notesSource = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const notesCss = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.css"), "utf8");
const foldersSource = fs.readFileSync(path.resolve(__dirname, "../additional/folders/ZentralColorfulFolders.uc.js"), "utf8");

let passed = 0;
function test(name, fn) {
  return Promise.resolve(fn()).then(() => {
    passed++;
    console.log("ok -", name);
  });
}

// ---- 1. Pure WCAG contrast, hue preservation, and preset × theme matrix ---------------------------------------------
(async () => {
  await test("pure surface resolver guarantees readable text, muted, accent, and selected pill foreground across light, dark, paper, recommended, and zentral (including adversarial Zen primary colors)", () => {
    assert.equal(typeof cal.contrastRatio, "function");
    assert.equal(typeof cal.resolveThemeSurface, "function");
    assert.equal(typeof cal.derivePaletteTokens, "function");
    assert.equal(typeof cal.resolveFolderSurfaceTokens, "function");
    assert.equal(typeof cal.resolveCssColor, "function");

    const themeFixtures = [
      { label: "light", theme: "light", opts: {} },
      { label: "dark", theme: "dark", opts: {} },
      { label: "paper", theme: "paper", opts: {} },
      { label: "recommended-light (system light)", theme: "recommended", opts: { scheme: "light" } },
      { label: "recommended-dark (system dark)", theme: "recommended", opts: { scheme: "dark" } },
      { label: "zentral-light (system light)", theme: "zentral", opts: { scheme: "light" } },
      { label: "zentral-dark (system dark)", theme: "zentral", opts: { scheme: "dark" } },
      { label: "zentral-dark + black Zen primary (#111111)", theme: "zentral", opts: { scheme: "dark", hostSurface: "#1e1e24", hostText: "#e9e9f0", hostAccent: "#111111" } },
      { label: "zentral-light + pastel yellow Zen primary (#f5c542)", theme: "zentral", opts: { scheme: "light", hostSurface: "#f7f7fa", hostText: "#1c1c22", hostAccent: "#f5c542" } },
      { label: "zentral-light + pale sky Zen primary (#cfe0ff)", theme: "zentral", opts: { scheme: "light", hostSurface: "#ffffff", hostText: "#18181b", hostAccent: "#cfe0ff" } },
      { label: "custom Look overrides (warm cream + pale accent)", theme: "dark", opts: { overrides: { bg: "#f6efe2", text: "#f0ece4", accent: "#ffe082" } } },
    ];

    for (const fx of themeFixtures) {
      const s = cal.resolveThemeSurface(fx.theme, fx.opts);
      assert.ok(cal.contrastRatio(s.text, s.surface) >= 4.5, `${fx.label}: text vs surface >= 4.5 (got ${cal.contrastRatio(s.text, s.surface).toFixed(2)})`);
      assert.ok(cal.contrastRatio(s.muted, s.surface) >= 4.5, `${fx.label}: muted vs surface >= 4.5 (got ${cal.contrastRatio(s.muted, s.surface).toFixed(2)})`);
      assert.ok(cal.contrastRatio(s.accent, s.surface) >= 4.5, `${fx.label}: accent vs surface >= 4.5 (got ${cal.contrastRatio(s.accent, s.surface).toFixed(2)})`);
      assert.ok(cal.contrastRatio(s.accentOutline, s.surface) >= 3.0, `${fx.label}: accentOutline vs surface >= 3.0`);
      assert.ok(cal.contrastRatio(s.accentOnFill, s.accentFill) >= 4.5, `${fx.label}: accentOnFill vs accentFill >= 4.5 (got ${cal.contrastRatio(s.accentOnFill, s.accentFill).toFixed(2)})`);
    }

    // Hue preservation on adversarial chromatic Zen primary colors.
    const yellowZentral = cal.resolveThemeSurface("zentral", { scheme: "light", hostSurface: "#f7f7fa", hostText: "#1c1c22", hostAccent: "#f5c542" });
    assert.ok(cal.hueDistanceDeg(yellowZentral.accent, "#f5c542") <= 6, "yellow Zen accent keeps its golden hue when darkened for light toolbar contrast");
    const skyZentral = cal.resolveThemeSurface("zentral", { scheme: "light", hostSurface: "#ffffff", hostText: "#18181b", hostAccent: "#cfe0ff" });
    assert.ok(cal.hueDistanceDeg(skyZentral.accent, "#cfe0ff") <= 6, "sky Zen accent keeps its blue hue when darkened for white surface contrast");
  });

  await test("every named Note/Highlight swatch, saved custom quick color, and Folder Collection preset meets foreground/outline/hover/selected/disabled contrast across all 7 theme surfaces while preserving hue", () => {
    const dom = require("./helpers/fake-dom.cjs")();
    const win = {
      __zentralNotesParts: { "notes-calendar": cal }, document: dom.document, ZentralRuntime: { register() {} }, __zentralNotesTestSeam: {},
      requestAnimationFrame() {}, cancelAnimationFrame() {}, setTimeout, clearTimeout, queueMicrotask,
      addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    };
    win.window = win;
    vm.runInNewContext(notesSource, {
      window: win, document: dom.document, Event: dom.Ev, globalThis: { Services: {} }, ChromeUtils: {},
      console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, setTimeout, clearTimeout, queueMicrotask, navigator: { platform: "Linux" },
    });
    const core = win.__zentralNotesTestSeam.core;
    assert.ok(Array.isArray(core.FOLDER_STYLE?.COLLECTIONS) && core.FOLDER_STYLE.COLLECTIONS.length >= 7, "Folder collections exposed");

    const surfaces = [
      cal.resolveThemeSurface("light"),
      cal.resolveThemeSurface("dark"),
      cal.resolveThemeSurface("paper"),
      cal.resolveThemeSurface("recommended", { scheme: "light" }),
      cal.resolveThemeSurface("recommended", { scheme: "dark" }),
      cal.resolveThemeSurface("zentral", { scheme: "light" }),
      cal.resolveThemeSurface("zentral", { scheme: "dark" }),
    ];

    const namedColors = [...Object.keys(cal.PALETTE_COLOR_HEX)];
    const savedQuickColors = ["#ffffff", "#fff59a", "#ffeb3b", "#cfe0ff", "#171b22", "#1f2a44", "#000000", "#2459b4", "#9bbdff", "#808080"];
    const presetColors = core.FOLDER_STYLE.COLLECTIONS.flatMap((g) => g.items.map((it) => it.b));
    const allInputs = [...new Set([...namedColors, ...savedQuickColors, ...presetColors])];

    for (const surface of surfaces) {
      const tag = `${surface.theme}/${surface.scheme}`;
      for (const color of allInputs) {
        for (const kind of ["swatch", "calendar", "time"]) {
          const tok = cal.derivePaletteTokens(color, surface, { kind });
          assert.ok(cal.contrastRatio(tok.fg, surface.surface) >= 4.5, `${tag} ${color} (${kind}): fg vs surface >= 4.5`);
          assert.ok(cal.contrastRatio(tok.fg, tok.bg) >= 4.5, `${tag} ${color} (${kind}): fg vs bg >= 4.5`);
          assert.ok(cal.contrastRatio(tok.fg, tok.hoverBg) >= 4.5, `${tag} ${color} (${kind}): fg vs hoverBg >= 4.5`);
          assert.ok(cal.contrastRatio(tok.selectedFg, tok.selectedBg) >= 4.5, `${tag} ${color} (${kind}): selectedFg vs selectedBg >= 4.5`);
          assert.ok(cal.contrastRatio(tok.hueFg, surface.surface) >= 4.5, `${tag} ${color} (${kind}): hueFg vs surface >= 4.5`);
          assert.ok(cal.contrastRatio(tok.hueFg, tok.bg) >= 4.5, `${tag} ${color} (${kind}): hueFg vs bg >= 4.5`);
          assert.ok(cal.contrastRatio(tok.hueFg, tok.hoverBg) >= 4.5, `${tag} ${color} (${kind}): hueFg vs hoverBg >= 4.5`);
          assert.ok(cal.contrastRatio(tok.hueFg, tok.selectedBg) >= 4.5, `${tag} ${color} (${kind}): hueFg vs selectedBg >= 4.5`);
          assert.ok(cal.contrastRatio(tok.muted, tok.bg) >= 4.5, `${tag} ${color} (${kind}): muted vs bg >= 4.5`);
          assert.ok(cal.contrastRatio(tok.muted, tok.hoverBg) >= 4.5, `${tag} ${color} (${kind}): muted vs hoverBg >= 4.5`);
          assert.ok(cal.contrastRatio(tok.outline, surface.surface) >= 3.0, `${tag} ${color} (${kind}): outline vs surface >= 3.0`);
          assert.ok(cal.contrastRatio(tok.outline, tok.bg) >= 3.0, `${tag} ${color} (${kind}): outline vs bg >= 3.0`);
          assert.ok(cal.contrastRatio(tok.selectedOutline, surface.surface) >= 3.0, `${tag} ${color} (${kind}): selectedOutline vs surface >= 3.0`);
          assert.ok(cal.contrastRatio(tok.disabledFg, tok.disabledBg) >= 3.0, `${tag} ${color} (${kind}): disabledFg vs disabledBg >= 3.0`);
          assert.ok(cal.contrastRatio(tok.hlFg, tok.hlBg) >= 4.5, `${tag} ${color} (${kind}): highlight fg vs hlBg >= 4.5`);
          assert.notEqual(tok.hoverBg, surface.surface, `${tag} ${color} (${kind}): hoverBg differs visibly from surface`);
          assert.notEqual(tok.selectedBg, tok.bg, `${tag} ${color} (${kind}): selectedBg differs visibly from normal bg`);

          const hsl = cal.colorHsl(color);
          if (hsl && hsl.s >= 15) {
            assert.ok(cal.hueDistanceDeg(tok.outline, color) <= 6, `${tag} ${color}: outline preserves hue (drift ${cal.hueDistanceDeg(tok.outline, color).toFixed(1)}°)`);
            assert.ok(cal.hueDistanceDeg(tok.hueFg, color) <= 6, `${tag} ${color}: hueFg preserves hue (drift ${cal.hueDistanceDeg(tok.hueFg, color).toFixed(1)}°)`);
          }
        }
      }

      // Every Folder Collection preset (both Simple and Detailed modes) + adversarial explicit label colors.
      const folderFixtures = [
        ...core.FOLDER_STYLE.COLLECTIONS.flatMap((g) => g.items.map((it) => ({ name: `${g.group}/${it.n}`, rec: it }))),
        { name: "explicit dark label", rec: { b: "#336699", d: { front: "#abcdef", label: "#202020", stroke: "#0b0d12" }, o: { front: 25 } } },
        { name: "explicit pale label", rec: { b: "#f4e04d", d: { front: "#fff59a", label: "#fffbe0", stroke: "#ffffcc" }, o: {} } },
      ];
      for (const fx of folderFixtures) {
        for (const mode of ["simple", "detailed"]) {
          const resolved = core.FOLDER_STYLE.resolve(fx.rec, 2, { mode });
          const ftok = cal.resolveFolderSurfaceTokens(resolved, surface);
          assert.ok(cal.contrastRatio(ftok.label, surface.surface) >= 4.5, `${tag} ${fx.name} (${mode}): folder label vs surface >= 4.5`);
          assert.ok(cal.contrastRatio(ftok.label, ftok.tint) >= 4.5, `${tag} ${fx.name} (${mode}): folder label vs tint >= 4.5`);
          assert.ok(cal.contrastRatio(ftok.label, ftok.hover) >= 4.5, `${tag} ${fx.name} (${mode}): folder label vs hover >= 4.5`);
          assert.ok(cal.contrastRatio(ftok.label, ftok.selected) >= 4.5, `${tag} ${fx.name} (${mode}): folder label vs selected >= 4.5`);
          assert.ok(cal.contrastRatio(ftok.accent, surface.surface) >= 4.5, `${tag} ${fx.name} (${mode}): folder count/accent vs surface >= 4.5`);
          assert.ok(cal.contrastRatio(ftok.accent, ftok.tint) >= 4.5, `${tag} ${fx.name} (${mode}): folder count/accent vs tint >= 4.5`);
          assert.ok(cal.contrastRatio(ftok.stroke, surface.surface) >= 3.0, `${tag} ${fx.name} (${mode}): folder icon stroke vs surface >= 3.0`);
          assert.ok(cal.contrastRatio(ftok.disabledFg, ftok.disabledBg) >= 3.0, `${tag} ${fx.name} (${mode}): folder disabledFg vs disabledBg >= 3.0`);
        }
      }
    }
  });

  // ---- 2. Live UI: preview parity, folder style dialog, swatches, and calendar T2.3g across Month/Next days/Agenda/Week/Day ----
  await test("live UI previews match live swatches/folder rows/calendar items and keep colored events & reminders readable across Month, Next days, Agenda, Week, and Day in every theme", async () => {
    const dom = require("./helpers/fake-dom.cjs")();
    const { El, Ev, document, raf } = dom;
    El.prototype.ownerDocument = document;
    const listeners = new Map();
    let mediaLight = true;
    const mediaListeners = new Set();
    const win = {
      __zentralNotesParts: { "notes-calendar": cal }, document, ZentralRuntime: { register() {} }, __zentralNotesTestSeam: {},
      requestAnimationFrame: (fn) => raf.push(fn), cancelAnimationFrame() {}, setTimeout, clearTimeout, queueMicrotask,
      innerWidth: 1280, innerHeight: 860,
      matchMedia: (q) => ({
        matches: q.includes("light") ? mediaLight : !mediaLight,
        addEventListener: (_t, fn) => mediaListeners.add(fn),
        removeEventListener: (_t, fn) => mediaListeners.delete(fn),
      }),
      addEventListener(type, fn) { const list = listeners.get(type) || []; list.push(fn); listeners.set(type, list); },
      removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter((x) => x !== fn)); },
      dispatchEvent(event) { for (const fn of [...(listeners.get(event.type) || [])]) fn(event); },
    };
    win.window = win;
    vm.runInNewContext(notesSource, {
      window: win, document, Event: Ev, globalThis: { Services: {} }, ChromeUtils: {},
      console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, setTimeout, clearTimeout, queueMicrotask, navigator: { platform: "Linux" },
    });
    const core = win.__zentralNotesTestSeam.core;
    const flush = async () => { for (let i = 0; i < 6; i++) { raf.splice(0).forEach((fn) => fn()); await new Promise((r) => setImmediate(r)); } };

    const fixedNow = new Date(2026, 10, 16, 10, 0, 0).getTime(); // Mon 2026-11-16
    const files = new Map();
    const io = {
      join: (...parts) => parts.join("/"), filename: (v) => v.split("/").pop(),
      readUTF8: async (v) => { if (!files.has(v)) throw new Error("not found"); return files.get(v).text; },
      writeUTF8: async (v, text) => files.set(v, { text, mtime: fixedNow }),
      remove: async (v) => files.delete(v), exists: async (v) => files.has(v),
      children: async (dir) => [...files.keys()].filter((v) => v.startsWith(dir + "/") && !v.slice(dir.length + 1).includes("/")),
      stat: async (v) => ({ lastModified: files.get(v)?.mtime || 0 }), restrict: async () => {},
    };
    const store = core.createStore({
      io, notify() {}, windowId: "contrast-ui", now: () => fixedNow,
      getDir: async () => "/contrast-ui", getMaxSaveMs: () => 1000, setTimer: setTimeout, clearTimer: clearTimeout,
    });
    await store.open();

    // Create adversarial colored notes, categories, folders, events, and pending/done/dismissed reminders.
    store.addFolder("Work", "");
    const paleNote = store.create("# Pale Lemon Note\nBody", "work");
    store.setColor(paleNote.id, "#fff59a");
    const darkNote = store.create("# Obsidian Note\nBody", "work");
    store.setColor(darkNote.id, "#171b22");
    const yellowNote = store.create("# Yellow Palette Note\nBody", "work");
    store.setColor(yellowNote.id, "yellow");
    const plainNote = store.create("# Category Fallback Note\nBody", "work");

    store.items.upsertCategory({ name: "BrightCat", color: "#ffe066" });
    store.items.upsertCategory({ name: "DarkCat", color: "#1f2a44" });

    const day = cal.dayStart(fixedNow);
    store.items.upsert({ id: "pale-rem", summary: "Pale reminder", start: { dateTime: new Date(day + 9 * 3600000).toISOString() }, x: { kind: "reminder", src: "manual", noteId: paleNote.id, category: "BrightCat" } });
    store.items.upsert({ id: "dark-ev", summary: "Obsidian event", start: { dateTime: new Date(day + 11 * 3600000).toISOString() }, end: { dateTime: new Date(day + 12 * 3600000).toISOString() }, x: { kind: "event", src: "manual", noteId: darkNote.id, category: "DarkCat" } });
    const yellowAllDay = store.items.upsert({ id: "yellow-allday", summary: "Yellow all-day", start: { date: "2026-11-16" }, x: { kind: "reminder", src: "manual", noteId: yellowNote.id } });
    store.items.upsert({ id: "cat-fallback", summary: "Category fallback", start: { dateTime: new Date(cal.addDays(day, 1) + 14 * 3600000).toISOString() }, x: { kind: "reminder", src: "manual", noteId: plainNote.id, category: "BrightCat" } });
    // Mark yellowAllDay as dismissed to exercise disabled/dismissed reminder contrast in Month & Upcoming.
    store.items.history.append({ itemId: yellowAllDay.id, occurrenceId: yellowAllDay.id, action: "dismissed", at: fixedNow });
    await store.items.flush();
    await store.items.history.flush();
    store.setMeta({ calendarOpen: true, calendarCursor: "2026-11-16", calendarView: "month" });
    await store.flush();

    const prefs = new Map([
      ["zen.workspace.zentral.notes.theme", "light"],
      ["zen.workspace.zentral.notes.custom_colors", "#ffffff,#fff59a,#171b22,#000000"],
    ]);
    const host = document.createElement("div");
    document.body.append(host);
    let paneRect = { left: 0, top: 0, width: 640, height: 520 };
    const adapter = { position: "fixed", host, attach: (r) => host.append(r), getArea: () => ({ left: 0, top: 0, width: 1180, height: 780 }), watch: () => () => {}, setActive() {}, rewatch() {} };
    const env = {
      now: () => fixedNow,
      getPref: (k, d) => (prefs.has(k) ? prefs.get(k) : d),
      setPref: (k, v) => prefs.set(k, v),
      openLink() {}, copyText() {}, exportNote() {}, exportAll() {}, revealFolder() {},
    };
    const sheet = core.createSheet({ store, adapter, env, ensureStore: () => Promise.resolve(store) });
    await sheet.open();
    await flush();
    const calPane = sheet.root.querySelector(".zn-calendar-pane");
    if (calPane) calPane.getBoundingClientRect = () => paneRect;

    const setTheme = async (theme, lightScheme = true) => {
      mediaLight = lightScheme;
      prefs.set("zen.workspace.zentral.notes.theme", theme);
      document.documentElement.setAttribute("zentral-notes-theme", theme);
      win.dispatchEvent(new Ev("zentral-notes-theme-changed"));
      await flush();
    };

    // Check 1: Color picker live preview uses identical resolved palette tokens as live swatches/calendar items.
    await setTheme("paper", true);
    const btnColor = sheet.root.querySelector('[aria-label="Note color"]');
    assert.ok(btnColor, "Note color button exists");
    btnColor.dispatchEvent(new Ev("click", { bubbles: true }));
    await flush();
    const swatches = [...sheet.root.querySelectorAll(".zn-menu .zn-swatch")].filter((el) => !el.classList.contains("zn-swatch-add"));
    assert.ok(swatches.length >= 12, "preset + saved quick-color swatches rendered");
    const paperSurface = cal.resolveThemeSurface("paper");
    for (const sw of swatches) {
      const outline = sw.style.getPropertyValue("--zn-pal-outline");
      assert.ok(outline, `swatch ${sw.title} receives --zn-pal-outline`);
      assert.ok(cal.contrastRatio(outline, paperSurface.surface) >= 3.0, `swatch ${sw.title} outline readable on Paper`);
    }
    const addCustomBtn = sheet.root.querySelector(".zn-swatch-add");
    addCustomBtn.dispatchEvent(new Ev("click", { bubbles: true }));
    await flush();
    const preview = sheet.root.querySelector('.zn-palette-preview[aria-label="Color contrast preview"]');
    assert.ok(preview, "colorPicker renders live Color contrast preview");
    const hexInput = sheet.root.querySelector(".zn-hex-field");
    hexInput.value = "#fff59a";
    hexInput.dispatchEvent(new Ev("input", { bubbles: true }));
    await flush();
    const expectedPaleOnPaper = cal.derivePaletteTokens("#fff59a", paperSurface, { kind: "swatch" });
    assert.equal(preview.style.getPropertyValue("--zn-pal-fg"), expectedPaleOnPaper.hueFg, "preview fg matches resolved palette hueFg");
    assert.equal(preview.style.getPropertyValue("--zn-pal-outline"), expectedPaleOnPaper.outline, "preview outline matches resolved palette outline");
    assert.equal(preview.style.getPropertyValue("--zn-pal-hover"), expectedPaleOnPaper.hoverBg, "preview hover matches resolved palette hoverBg");
    assert.equal(preview.style.getPropertyValue("--zn-pal-selected-bg"), expectedPaleOnPaper.selectedBg, "preview selected matches resolved palette selectedBg");
    assert.equal(preview.style.getPropertyValue("--zn-pal-disabled-fg"), expectedPaleOnPaper.disabledFg, "preview disabled matches resolved palette disabledFg");
    for (const state of ["normal", "hover", "selected", "disabled"]) {
      assert.ok(preview.querySelector(`[data-state="${state}"]`), `preview shows ${state} state pill`);
    }
    // Close custom color dialog.
    const cancelBtn = [...sheet.root.querySelectorAll(".zn-dialog .zn-chip")].find((b) => b.textContent === "Cancel");
    cancelBtn.dispatchEvent(new Ev("click", { bubbles: true }));
    await flush();

    // Check 2: Folder style dialog preset buttons & live folder row preview match live All notes folder row byte-for-byte.
    const titleBtn = sheet.root.querySelector(".zn-title");
    titleBtn.dispatchEvent(new Ev("click", { bubbles: true }));
    await flush();
    let workRow = sheet.root.querySelector('.zn-frow[data-fid="work"]');
    assert.ok(workRow, "Work folder row rendered in All notes");
    workRow.querySelector(".zn-fmore").dispatchEvent(new Ev("click", { bubbles: true }));
    await flush();
    const colorMenuBtn = [...sheet.root.querySelectorAll(".zn-menu button")].find((b) => b.textContent.startsWith("Color and icon"));
    colorMenuBtn.dispatchEvent(new Ev("click", { bubbles: true }));
    await flush();

    for (const [theme, schemeLight] of [["light", true], ["dark", false], ["recommended", true], ["zentral", true]]) {
      await setTheme(theme, schemeLight);
      const surf = cal.resolveThemeSurface(theme, { scheme: schemeLight ? "light" : "dark" });
      const presetChips = [...sheet.root.querySelectorAll(".zn-fstyle-presets .zn-chip")];
      assert.ok(presetChips.length >= 35, "all folder collection preset chips rendered");
      for (const chip of presetChips) {
        assert.ok(chip.querySelector(".zn-fstyle-preset-swatch"), `preset ${chip.textContent} renders dedicated gradient swatch`);
        const fg = chip.style.getPropertyValue("--zn-pal-fg");
        const bg = chip.style.getPropertyValue("--zn-pal-bg");
        const outline = chip.style.getPropertyValue("--zn-pal-outline");
        assert.ok(cal.contrastRatio(fg, bg) >= 4.5, `${theme} preset ${chip.textContent}: fg vs chip bg >= 4.5`);
        assert.ok(cal.contrastRatio(outline, surf.surface) >= 3.0, `${theme} preset ${chip.textContent}: outline vs surface >= 3.0`);
      }
    }

    // Pick "Obsidian" in Dark mode and verify preview row matches live Work row after Apply, then switch to Light and verify both re-resolve!
    await setTheme("dark", false);
    const obsidianChip = [...sheet.root.querySelectorAll(".zn-fstyle-presets .zn-chip")].find((b) => b.textContent === "Obsidian");
    obsidianChip.dispatchEvent(new Ev("click", { bubbles: true }));
    await flush();
    const fPreview = sheet.root.querySelector('.zn-fstyle-preview[aria-label="Folder style preview"] .zn-frow');
    assert.ok(fPreview, "askFolderStyle renders live .zn-frow preview");
    const previewVarsBeforeApply = ["--zn-frow-label", "--zn-frow-accent", "--zn-frow-stroke", "--zn-frow-tint", "--zn-frow-hover", "--zn-frow-selected", "--zn-frow-disabled-fg"]
      .map((k) => [k, fPreview.style.getPropertyValue(k)]);
    const applyClose = [...sheet.root.querySelectorAll(".zn-dialog .zn-chip")].find((b) => b.textContent === "Apply and close");
    applyClose.dispatchEvent(new Ev("click", { bubbles: true }));
    await flush();
    workRow = sheet.root.querySelector('.zn-frow[data-fid="work"]');
    for (const [k, v] of previewVarsBeforeApply) {
      assert.ok(v, `preview set ${k}`);
      assert.equal(workRow.style.getPropertyValue(k), v, `live folder row ${k} equals preview ${k}`);
    }
    const darkSurf = cal.resolveThemeSurface("dark");
    assert.ok(cal.contrastRatio(workRow.style.getPropertyValue("--zn-frow-label"), darkSurf.surface) >= 4.5, "Obsidian folder label readable in Dark mode");
    assert.ok(cal.contrastRatio(workRow.style.getPropertyValue("--zn-frow-accent"), darkSurf.surface) >= 4.5, "Obsidian folder count readable in Dark mode");
    assert.ok(cal.contrastRatio(workRow.style.getPropertyValue("--zn-frow-stroke"), darkSurf.surface) >= 3.0, "Obsidian folder icon stroke visible in Dark mode");

    // Check 3: Calendar T2.3g across Month, Next days (upcoming), Agenda, Week, and Day in Light, Paper, Dark, Recommended, and Zentral!
    const viewSelect = sheet.root.querySelector(".zn-calendar-view-select");
    assert.ok(viewSelect, "calendar view selector exists");
    const viewLabels = { month: "Month", upcoming: "Next days", agenda: "Agenda", week: "Week", day: "Day" };
    const switchView = async (v) => {
      viewSelect.dispatchEvent(new Ev("click", { bubbles: true }));
      await flush();
      const target = viewLabels[v] || v;
      const opt = [...sheet.root.querySelectorAll(".zn-menu button")].find((b) => b.textContent.replace(/^✓\s*/, "").trim() === target);
      assert.ok(opt, `calendar view menu option ${target}`);
      opt.dispatchEvent(new Ev("click", { bubbles: true }));
      await flush();
    };
    const assertCalNodesReadable = (nodes, surf, label) => {
      assert.ok(nodes.length > 0, `${label}: rendered calendar item nodes`);
      for (const node of nodes) {
        const raw = node.style.getPropertyValue("--zn-cal-item-color");
        assert.ok(raw, `${label}: preserves raw --zn-cal-item-color`);
        const bg = node.style.getPropertyValue("--zn-cal-item-bg");
        const fg = node.style.getPropertyValue("--zn-cal-item-fg");
        const muted = node.style.getPropertyValue("--zn-cal-item-muted");
        const outline = node.style.getPropertyValue("--zn-cal-item-outline");
        const disBg = node.style.getPropertyValue("--zn-cal-item-disabled-bg");
        const disFg = node.style.getPropertyValue("--zn-cal-item-disabled-fg");
        assert.ok(cal.contrastRatio(fg, bg) >= 4.5, `${label} (${raw}): fg vs bg >= 4.5`);
        assert.ok(cal.contrastRatio(muted, bg) >= 4.5, `${label} (${raw}): muted vs bg >= 4.5`);
        assert.ok(cal.contrastRatio(outline, surf.surface) >= 3.0, `${label} (${raw}): outline vs surface >= 3.0`);
        assert.ok(cal.contrastRatio(disFg, disBg) >= 3.0, `${label} (${raw}): disabledFg vs disabledBg >= 3.0`);
      }
    };

    for (const [theme, schemeLight] of [["light", true], ["paper", true], ["dark", false], ["recommended", true], ["recommended", false], ["zentral", true], ["zentral", false]]) {
      await setTheme(theme, schemeLight);
      const surf = cal.resolveThemeSurface(theme, { scheme: schemeLight ? "light" : "dark" });
      const tag = `${theme}/${schemeLight ? "light" : "dark"}`;

      await switchView("month");
      assertCalNodesReadable([...sheet.root.querySelectorAll(".zn-cal-month-mark")], surf, `${tag} Month marks`);
      assertCalNodesReadable([...sheet.root.querySelectorAll(".zn-cal-month-selection .zn-cal-item")], surf, `${tag} Month selected day items`);
      // Verify raw --zn-cal-item-color inheritance contract (T2.3g) is preserved verbatim.
      const paleMark = [...sheet.root.querySelectorAll(".zn-cal-month-mark")].find((n) => n.textContent.includes("Pale reminder"));
      assert.equal(paleMark.style.getPropertyValue("--zn-cal-item-color"), "#fff59a", "raw note hex preserved on --zn-cal-item-color");

      await switchView("upcoming");
      assertCalNodesReadable([...sheet.root.querySelectorAll(".zn-cal-upcoming-list .zn-cal-item")], surf, `${tag} Next days items`);
      const catItem = [...sheet.root.querySelectorAll(".zn-cal-upcoming-list .zn-cal-item")].find((n) => n.textContent.includes("Category fallback"));
      assert.equal(catItem.style.getPropertyValue("--zn-cal-item-color"), "#ffe066", "category fallback hex preserved on --zn-cal-item-color");

      await switchView("agenda");
      assertCalNodesReadable([...sheet.root.querySelectorAll(".zn-cal-agenda-list .zn-cal-item")], surf, `${tag} Agenda items`);

      await switchView("week");
      assertCalNodesReadable([...sheet.root.querySelectorAll(".zn-cal-time-event, .zn-cal-time-reminder, .zn-cal-time-allday-row .zn-cal-item")], surf, `${tag} Week items`);

      await switchView("day");
      assertCalNodesReadable([...sheet.root.querySelectorAll(".zn-cal-time-event, .zn-cal-time-reminder, .zn-cal-time-allday-row .zn-cal-item")], surf, `${tag} Day items`);
    }

    // CSS rule checks: Week/Day timed items explicitly inherit readable foreground and dismissed items avoid 0.4 opacity washout.
    assert.match(notesCss, /\.zn-cal-time-event\s*\{[^}]*color:\s*var\(--zn-cal-item-fg/, "Week/Day timed events bind --zn-cal-item-fg instead of UA ButtonText");
    assert.match(notesCss, /\.zn-cal-time-reminder\s*\{[^}]*color:\s*var\(--zn-cal-item-fg/, "Week/Day timed reminders bind --zn-cal-item-fg instead of UA ButtonText");
    assert.match(foldersSource, /zcf-swatch-dot/, "Colorful Folders floating editor swatches separate gradient dot from CanvasText label");

    // Check 4: Narrow Month heatmap picker (--zn-cal-picker-tint-safe) + Read-pane inline Markdown highlights (.zn-hl).
    store.setMeta({ calendarPicker: { mode: "picker", colorMode: "category", minWidth: 470, minHeight: 360 } });
    await switchView("month");
    for (const [theme, schemeLight] of [["light", true], ["paper", true], ["dark", false]]) {
      await setTheme(theme, schemeLight);
      const surf = cal.resolveThemeSurface(theme, { scheme: schemeLight ? "light" : "dark" });
      const tintedDays = [...sheet.root.querySelectorAll(".zn-cal-picker-day")].filter((d) => d.style.getPropertyValue("--zn-cal-picker-tint"));
      assert.ok(tintedDays.length > 0, `${theme}: narrow picker rendered category-tinted day cells`);
      for (const cell of tintedDays) {
        const safe = cell.style.getPropertyValue("--zn-cal-picker-tint-safe");
        assert.ok(safe, `${theme}: picker cell sets --zn-cal-picker-tint-safe`);
        assert.ok(cal.contrastRatio(safe, surf.surface) >= 3.0, `${theme}: picker tint safe outline >= 3.0`);
        const heat3Bg = cal.mixSrgb(safe, surf.surface, 0.28);
        assert.ok(cal.contrastRatio(surf.text, heat3Bg) >= 4.5, `${theme}: picker date text readable on heat-3 tint`);
      }
    }

    // Switch back to editor Read mode with custom pale & dark highlights and verify live theme re-resolution.
    const hlNote = store.create("# Highlight Contrast\n\n==yellow mark== and =={#fff59a}pale== and =={#171b22}obsidian==");
    await flush();
    const hlRow = [...sheet.root.querySelectorAll(".zn-item")].find((el) => el.textContent.includes("Highlight Contrast"));
    assert.ok(hlRow, "Highlight Contrast note row in All notes");
    hlRow.dispatchEvent(new Ev("click", { bubbles: true }));
    await flush();
    const modeBtn = [...sheet.root.querySelectorAll(".zn-mode-btn")].find((b) => b.title.startsWith("Read"));
    if (modeBtn) {
      modeBtn.dispatchEvent(new Ev("click", { bubbles: true }));
      await flush();
    }
    for (const [theme, schemeLight] of [["dark", false], ["light", true], ["paper", true]]) {
      await setTheme(theme, schemeLight);
      const marks = [...sheet.root.querySelectorAll(".zn-read .zn-hl")];
      assert.ok(marks.length >= 1, `${theme}: rendered inline .zn-hl highlight`);
      for (const mk of marks) {
        const hlBg = mk.style.getPropertyValue("--zn-pal-hl-bg");
        const hlFg = mk.style.getPropertyValue("--zn-pal-hl-fg");
        assert.ok(hlBg && hlFg, `${theme}: .zn-hl sets --zn-pal-hl-bg and --zn-pal-hl-fg`);
        assert.ok(cal.contrastRatio(hlFg, hlBg) >= 4.5, `${theme}: .zn-hl foreground vs background >= 4.5`);
      }
    }
  });

  console.log(`\n${passed} palette contrast tests passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
