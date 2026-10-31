"use strict";
/* Cycle C, pure window logic of additional/notes/ZentralNotes.uc.js: geometry (move / resize / clamp),
 * sheet placement, keeping clear of the native sidebar, hold-to-act, recent list, the shortcut table and
 * the persisted window state in meta.json. Real layout and pointer behavior still need a live Zen. */
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const seam = {};
const win = { __zentralNotesTestSeam: seam, ZentralRuntime: { register() {} } };
win.window = win;
vm.runInNewContext(source, { window: win, globalThis: { Services: {} }, ChromeUtils: {}, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, console });
const c = seam.core;
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("ok -", name); }
const AREA = { w: 1000, h: 700 };
// Objects come from another realm (vm context), so compare their JSON with sorted keys.
const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
const same = (a, b, msg) => assert.equal(canon(a), canon(b), msg);

(async () => {
  await test("normalizeGeo keeps sane rectangles and rejects the rest", () => {
    same(c.normalizeGeo({ x: 10.4, y: 20.6, w: 400, h: 300 }), { x: 10, y: 21, w: 400, h: 300 });
    for (const bad of [null, 5, {}, { x: 0, y: 0, w: 100, h: 300 }, { x: 0, y: 0, w: 400, h: 50 }, { x: NaN, y: 0, w: 400, h: 300 }, { x: "1", y: 0, w: 400, h: 300 }, { x: 0, y: 0, w: 99999, h: 300 }])
      assert.equal(c.normalizeGeo(bad), null);
  });
  await test("clampGeo keeps the rectangle inside the area and above the minimum", () => {
    same(c.clampGeo({ x: -50, y: -9, w: 400, h: 300 }, AREA), { x: 0, y: 0, w: 400, h: 300 });
    same(c.clampGeo({ x: 900, y: 650, w: 400, h: 300 }, AREA), { x: 600, y: 400, w: 400, h: 300 });
    same(c.clampGeo({ x: 0, y: 0, w: 5000, h: 5000 }, AREA), { x: 0, y: 0, w: 1000, h: 700 });
    same(c.clampGeo({ x: 0, y: 0, w: 10, h: 10 }, AREA), { x: 0, y: 0, w: 240, h: 160 });
    // an area smaller than the minimum wins over the minimum
    same(c.clampGeo({ x: 0, y: 0, w: 400, h: 300 }, { w: 200, h: 100 }), { x: 0, y: 0, w: 200, h: 100 });
  });
  await test("moveGeo follows the pointer but stops at the area edges", () => {
    const s = { x: 100, y: 100, w: 400, h: 300 };
    same(c.moveGeo(s, 30, -20, AREA), { x: 130, y: 80, w: 400, h: 300 });
    same(c.moveGeo(s, 9999, 9999, AREA), { x: 600, y: 400, w: 400, h: 300 });
    same(c.moveGeo(s, -9999, -9999, AREA), { x: 0, y: 0, w: 400, h: 300 });
  });
  await test("resizeGeo: every handle moves only its own edges; the opposite edge stays put", () => {
    const s = { x: 100, y: 100, w: 400, h: 300 };
    same(c.resizeGeo(s, "e", 50, 99, AREA), { x: 100, y: 100, w: 450, h: 300 });
    same(c.resizeGeo(s, "s", 99, 40, AREA), { x: 100, y: 100, w: 400, h: 340 });
    same(c.resizeGeo(s, "w", -40, 0, AREA), { x: 60, y: 100, w: 440, h: 300 });
    same(c.resizeGeo(s, "n", 0, -40, AREA), { x: 100, y: 60, w: 400, h: 340 });
    same(c.resizeGeo(s, "nw", -40, -40, AREA), { x: 60, y: 60, w: 440, h: 340 });
    same(c.resizeGeo(s, "se", 40, 40, AREA), { x: 100, y: 100, w: 440, h: 340 });
    same(c.resizeGeo(s, "ne", 40, -40, AREA), { x: 100, y: 60, w: 440, h: 340 });
    same(c.resizeGeo(s, "sw", -40, 40, AREA), { x: 60, y: 100, w: 440, h: 340 });
    for (const hd of c.RESIZE_HANDLES) assert.ok(c.resizeGeo(s, hd, 1, 1, AREA));
  });
  await test("resizeGeo cannot shrink below the minimum or grow past the area; a west drag past the minimum pins the east edge", () => {
    const s = { x: 100, y: 100, w: 400, h: 300 };
    same(c.resizeGeo(s, "e", -9999, 0, AREA), { x: 100, y: 100, w: 240, h: 300 });
    same(c.resizeGeo(s, "w", 9999, 0, AREA), { x: 260, y: 100, w: 240, h: 300 }, "east edge stays at 500");
    same(c.resizeGeo(s, "se", 9999, 9999, AREA), { x: 100, y: 100, w: 900, h: 600 });
    same(c.resizeGeo(s, "nw", -9999, -9999, AREA), { x: 0, y: 0, w: 500, h: 400 });
  });
  await test("placeSheet reproduces the old default layout and lets stored geometry replace only peek", () => {
    const top = { width: 800, height: 700, anchor: "top" };
    same(c.placeSheet({ area: top }), { x: 6, y: 6, w: 788, h: 434 }, "62% of 700");
    same(c.placeSheet({ area: { ...top, anchor: "bottom" } }), { x: 6, y: 260, w: 788, h: 434 });
    same(c.placeSheet({ area: top, size: "full" }), { x: 6, y: 6, w: 788, h: 688 });
    same(c.placeSheet({ area: top, size: "span" }), { x: 6, y: 6, w: 788, h: 688 });
    const geo = { x: 50, y: 60, w: 300, h: 400 };
    same(c.placeSheet({ area: top, geo }), geo);
    same(c.placeSheet({ area: top, geo, size: "full" }), { x: 6, y: 6, w: 788, h: 688 }, "full ignores geo");
    same(c.placeSheet({ area: top, geo: { x: 900, y: 0, w: 300, h: 400 } }), { x: 500, y: 0, w: 300, h: 400 }, "a window that got smaller pulls geo back in");
    same(c.placeSheet({ area: { width: 800, height: 300, anchor: "top" }, geo }), { x: 6, y: 6, w: 788, h: 288 }, "short areas are always full");
  });
  await test("keepClear removes a tall sidebar strip from either side and ignores short or small rectangles", () => {
    const view = { left: 0, top: 0, width: 1200, height: 800 };
    same(c.keepClear(view, [{ left: 0, width: 280, height: 800 }], 800), { left: 280, top: 0, width: 920, height: 800 });
    same(c.keepClear(view, [{ left: 920, width: 280, height: 800 }], 800), { left: 0, top: 0, width: 920, height: 800 });
    same(c.keepClear(view, [{ left: 0, width: 280, height: 200 }], 800), view, "short rectangle ignored");
    same(c.keepClear(view, [{ left: 0, width: 10, height: 800 }, null], 800), view, "thin rectangle ignored");
    assert.equal(c.keepClear(view, [{ left: 0, width: 1190, height: 800 }], 800).width >= 240, true, "a minimum always remains");
    assert.equal(c.sideOf({ left: 920, width: 280 }, 1200), "right");
    assert.equal(c.sideOf({ left: 0, width: 280 }, 1200), "left");
    assert.equal(c.sideOf(null, 1200), "left");
  });
  await test("hold-to-act: tap, hold, swallowed click, cancel, and no timer outside a press", () => {
    const log = [];
    let t = 0, pending = null;
    const mk = () => c.createHoldAction({ ms: 450, setTimer: (fn) => { pending = fn; return ++t; }, clearTimer: () => { pending = null; }, onTap: () => log.push("tap"), onHold: () => log.push("hold") });
    let h = mk();
    assert.equal(h.armed, false, "no timer at rest");
    h.press(); assert.equal(h.armed, true); h.release(); assert.equal(h.armed, false); h.click();
    same(log.splice(0), ["tap"], "quick press = tap");
    h.press(); pending(); h.release(); assert.equal(h.click(), false);
    same(log.splice(0), ["hold"], "long press = hold only; the ending click is swallowed");
    h.click(); same(log.splice(0), ["tap"], "the next click is a normal tap again");
    h.press(); h.cancel(); assert.equal(h.armed, false); assert.equal(pending, null, "pointer left: timer cleared");
    h.press(); h.press(); pending(); pending = null; h.cancel(); h.click();
    same(log.splice(0), ["hold", "tap"], "a cancel after a hold resets; keyboard click is a tap");
    h = mk(); h.click(); same(log, ["tap"], "Enter/Space (click without press) is a tap");
  });
  await test("recent list: newest first, no duplicates, capped; stored data is cleaned", () => {
    let r = [];
    for (const id of ["a", "b", "c", "a"]) r = c.pushRecent(r, id);
    same(r, ["a", "c", "b"]);
    for (let i = 0; i < 20; i++) r = c.pushRecent(r, "n" + i);
    assert.equal(r.length, 8);
    assert.equal(r[0], "n19");
    same(c.cleanRecent(["x", "x", 5, "", "y"]), ["x", "y"]);
    same(c.cleanRecent("nope"), []);
  });
  await test("shortcut table: new actions exist, globals are flagged, ids stay unique and defaults do not collide", () => {
    const ids = c.SHORTCUT_ACTIONS.map((a) => a.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ["recent", "notePin", "keepOpen", "larger", "span", "resetGeo", "quickNew", "openFloating"]) assert.ok(ids.includes(id), id);
    same(c.SHORTCUT_ACTIONS.filter((a) => a.global).map((a) => a.id).sort(), ["captureInbox", "capturePage", "captureQuick", "openFloating", "quickNew"]);
    const defs = c.SHORTCUT_ACTIONS.map((a) => a.def).filter(Boolean);
    assert.equal(new Set(defs).size, defs.length, "no two defaults share a combination");
    const list = c.effectiveShortcuts(c.parseShortcutMap(JSON.stringify({ span: "Ctrl+Alt+J", quickNew: "Alt+Shift+Q" })));
    assert.equal(list.find((x) => x.id === "span").combo, "Ctrl+Alt+J");
    assert.equal(c.findShortcutConflict(list, "larger", "Ctrl+Alt+J"), "span", "conflicts are found across sheet and global actions");
  });
  await test("labels: cleaned to one short line, saved in the front matter, read back, searchable", () => {
    assert.equal(c.cleanLabel("  work \n\t ideas  "), "work ideas");
    assert.equal(c.cleanLabel("x".repeat(100)).length, 40);
    assert.equal(c.cleanLabel(null), "");
    const text = c.serializeNote({ id: "n1", created: 1000, updated: 2000, color: "none", label: "Shopping list", pinned: false, trashed: 0, body: "hi" });
    assert.ok(text.includes("label: Shopping list"));
    assert.equal(c.noteFromFile("n1", text, 5).label, "Shopping list");
    assert.ok(!c.serializeNote({ id: "n2", created: 1, updated: 1, color: "none", label: "  ", body: "" }).includes("label:"), "no empty label line");
    assert.equal(c.noteFromFile("n3", "no front matter", 5).label, "");
  });
  await test("themes: known names pass, anything else falls back to the Zen look", () => {
    assert.equal(c.normalizeTheme("recommended"), "recommended");
    for (const bad of ["", "neon", null, undefined, 3]) assert.equal(c.normalizeTheme(bad), "zentral");
    same(c.NOTE_THEMES.map((t) => t[0]), ["zentral", "recommended", "light", "dark", "paper"]);
  });
  await test("V4-R3 clearOfRect keeps a wide sheet off the pill menu and leaves non-overlapping boxes alone", () => {
    const box = { left: 100, top: 50, width: 800, height: 600 };
    same(c.clearOfRect(box, null), box);
    same(c.clearOfRect(box, { left: 5, top: 100, width: 20, height: 20 }), box, "left of the box");
    same(c.clearOfRect(box, { left: 120, top: 900, width: 20, height: 20 }), box, "below the box");
    const l = c.clearOfRect(box, { left: 110, top: 100, width: 30, height: 30 });
    assert.equal(l.left, 144); assert.equal(l.left + l.width, 900);
    const r = c.clearOfRect(box, { left: 860, top: 100, width: 30, height: 30 });
    assert.equal(r.left, 100); assert.equal(r.left + r.width, 856);
    const tiny = c.clearOfRect({ left: 0, top: 0, width: 300, height: 300 }, { left: 10, top: 10, width: 280, height: 20 });
    assert.ok(tiny.width >= 240, "minimum width wins");
  });
  await test("V4-R3 CSS lets the spilled sheet escape the clip but keeps wrappers click-through", () => {
    const css = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.css"), "utf8");
    assert.match(css, /bgalazka-notes-spill="true"\][^{]*#zen-app-panel-clip,[^{]*#zen-app-panel-slider\s*\{\s*overflow:\s*visible/);
    assert.match(css, /#zen-app-panel-clip\s*\{\s*pointer-events:\s*none/);
    assert.match(css, /> \.zentral-notes-sheet\s*\{[^}]*pointer-events:\s*auto/);
  });
  await test("panel slot shares are bounded, larger mode expands and zero custom share uses the preference", () => {
    assert.equal(c.slotShare({ size: "peek", pref: 45, custom: 0 }), 0.45);
    assert.equal(c.slotShare({ size: "peek", pref: 45, custom: 0.6 }), 0.6);
    assert.equal(c.slotShare({ size: "full", pref: 45, custom: 0.6 }), 0.8);
    assert.equal(c.slotShare({ size: "span", pref: 45, custom: 0.6 }), 0);
    assert.equal(c.slotShare({ size: "peek", pref: 1, custom: 0 }), c.SLOT_MIN_SHARE);
    assert.equal(c.slotShare({ size: "peek", pref: 100, custom: 0 }), c.SLOT_MAX_SHARE);
    assert.equal(c.slotPx(600, 0.5), 300);
    assert.equal(c.slotPx(600, 0.95), 480, "leaves the page its minimum usable height");
    assert.equal(c.slotPx(180, 0.5), 0, "too-short page cannot be split");
  });
  await test("slot edge dragging calculates the same share for dock and between-panel gap", () => {
    assert.equal(c.slotDragShare({ startPx: 300, base: 600, dy: -60, dir: -1 }), 0.6, "top edge dragged upward grows the band");
    assert.equal(c.slotDragShare({ startPx: 300, base: 600, dy: 60, dir: -1 }), 0.4, "top edge dragged downward shrinks the band");
    assert.equal(c.slotDragShare({ startPx: 300, base: 600, dy: 60, dir: 1 }), 0.6, "lower gap edge dragged downward grows the band");
    assert.equal(c.slotDragShare({ startPx: 300, base: 600, dy: 900, dir: 1 }), c.SLOT_MAX_SHARE);
    assert.equal(c.slotDragShare({ startPx: 300, base: 180, dy: 60, dir: -1 }), 0, "no drag below the minimum page height");
  });
  await test("gap geometry is not subtracted twice; bottom dock reserve is added back", () => {
    assert.equal(c.pagesWithoutSlotHeight({ pageHeight: 600, slotPx: 120, slotKind: "gap" }), 600);
    assert.equal(c.pagesWithoutSlotHeight({ pageHeight: 480, slotPx: 120, slotKind: "dock" }), 600);
    assert.equal(c.pagesWithoutSlotHeight({ pageHeight: 480, slotPx: 120, slotKind: "" }), 600);
  });
  await test("panel-follow target restores the remembered bar kind and falls back when Triple View closes", () => {
    assert.equal(c.followTarget({ want: "primary", kinds: ["primary", "triple"], triple: true }), "primary");
    assert.equal(c.followTarget({ want: "triple", kinds: ["primary", "triple"], triple: true }), "triple");
    assert.equal(c.followTarget({ want: "triple", kinds: ["primary"], triple: false }), "primary");
    assert.equal(c.followTarget({ want: "super", kinds: ["primary"], triple: false }), "");
    assert.equal(c.followTarget({ want: "", kinds: ["primary"], triple: false }), "");
  });
  await test("push page: the side follows the card, wide cards and cards far from an edge do not push", () => {
    const content = { left: 0, right: 1000 };
    same(c.pushAmount({ left: 560, width: 440 }, content), { side: "right", px: 448 });
    same(c.pushAmount({ left: 0, width: 400 }, content), { side: "left", px: 408 });
    assert.equal(c.pushAmount({ left: 100, width: 700 }, content), null, "wider than 60% of the page");
    assert.equal(c.pushAmount({ left: 0, width: 0 }, content), null);
    assert.equal(c.pushAmount({ left: 0, width: 300 }, { left: 0, right: 0 }), null, "no page rectangle");
  });
  console.log(`\n${passed} notes window tests passed`);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
