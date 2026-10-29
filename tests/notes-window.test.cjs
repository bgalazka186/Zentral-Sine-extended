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
    same(c.SHORTCUT_ACTIONS.filter((a) => a.global).map((a) => a.id).sort(), ["openFloating", "quickNew"]);
    const defs = c.SHORTCUT_ACTIONS.map((a) => a.def).filter(Boolean);
    assert.equal(new Set(defs).size, defs.length, "no two defaults share a combination");
    const list = c.effectiveShortcuts(c.parseShortcutMap(JSON.stringify({ span: "Ctrl+Alt+J", quickNew: "Alt+Shift+Q" })));
    assert.equal(list.find((x) => x.id === "span").combo, "Ctrl+Alt+J");
    assert.equal(c.findShortcutConflict(list, "larger", "Ctrl+Alt+J"), "span", "conflicts are found across sheet and global actions");
  });
  console.log(`\n${passed} notes window tests passed`);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
