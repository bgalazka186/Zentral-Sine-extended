"use strict";
/* OW-26: Notes between the two pages of a Triple View that the panel suite restored at start-up.
 * The real Notes script and the real extension/panels/secondary-views/ZentralSecondaryViews.uc.js run together in one
 * fake window (tests/helpers/fake-triple-view.cjs): Notes asks for a gap, the suite's own code sizes the two pages, and
 * boxes come from the real style sheets. tests/notes-slot-geometry.test.cjs cannot show this fault: its model sizes
 * the pages with a formula of its own and always starts from an evenly divided panel.
 *
 * The fault: the suite keeps a saved height share for a linked pair, and Notes comes back at start-up with its band
 * centred on the divider. When that asks more of one page than it can give (a pair that is not divided evenly, or a
 * divider that was saved while the band sat elsewhere), the suite held that page at a floor of a quarter of what the
 * two pages had LEFT, which changes with every px of the band, and Notes went on believing the split it had asked
 * for. Dragging the top edge then moved the bottom edge too; "Swap top and bottom panels" hid it by closing and
 * reopening Notes. With a large band the pages fell under 40 px, Notes stopped counting them and the sheet stayed
 * where an earlier pass had put it.
 *
 * This does NOT prove Gecko layout, remote browsers, native hit-testing or pointer capture: the owner checks the
 * drag in the app. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createPanelWorld, noteText, DIR } = require("./helpers/fake-panel-window.cjs");
const { openTripleWindow } = require("./helpers/fake-triple-view.cjs");

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("ok -", name); }
const STARTUP = "zen.workspace.bgalazka.open_at_startup";
const OPEN_AT = 400, HIDE_AT = 2000; // the suite opens the start-up panel, asks it to leave 1.2 s later, and it slides away 0.4 s after that
const round = (v) => Math.round(v * 10) / 10;

// The pure split maths of the suite, taken from its source (they live inside a larger closure).
function suiteMath() {
  const sv = fs.readFileSync(path.resolve(__dirname, "../extension/panels/secondary-views/ZentralSecondaryViews.uc.js"), "utf8");
  const grab = (name) => {
    const i = sv.indexOf("function " + name + "(");
    assert.ok(i >= 0, name + " exists in the secondary views");
    let depth = 0;
    for (let k = sv.indexOf("}) {", i) + 3; k < sv.length; k++) { if (sv[k] === "{") depth++; else if (sv[k] === "}" && --depth === 0) return sv.slice(i, k + 1); }
    throw new Error("unbalanced " + name);
  };
  const names = ["tripleFloor", "tripleHeights", "tripleShareFor", "tripleGapUp", "tripleShareAfterNotes"];
  return new Function(names.map(grab).join("\n") + "\nreturn { " + names.join(", ") + " };")();
}

// An application that was closed with Notes open between the pages of the linked pair "mail" / "chat", and that opens
// this pair at start-up. `share` = the upper page's part of the two pages, as the suite saved it.
async function startUp({ share = 0.5, meta = {}, hide = true, revealAt = 0, storeMs = 0, window: windowOptions = {} } = {}) {
  const world = createPanelWorld({ sharedGlobal: { Map, Object } });
  world.disk.set(DIR + "/n1.md", noteText("One"));
  world.disk.set(DIR + "/meta.json", JSON.stringify({ openIn: "triple", folders: [], ...meta }));
  world.prefs.set(STARTUP, JSON.stringify({ id: "mail", mode: "triple" }));
  const t = openTripleWindow(world, windowOptions);
  const pair = t.link("mail", "chat", share);
  t.autohide(true); // "Open at Startup" turns the panel's autohide on
  const release = storeMs ? world.hold((op) => op === "makeDirectory" || op === "children" || op === "read") : null;
  t.w.start();
  let now = 0;
  const until = async (ms) => { if (ms > now) { await world.advance(ms - now); now = ms; } };
  const events = [[OPEN_AT, () => t.openApp("mail")]];
  if (storeMs) events.push([OPEN_AT + storeMs, release]);
  if (hide) events.push([HIDE_AT, () => t.hide()]);
  if (revealAt) events.push([revealAt, () => t.reveal()]);
  events.sort((a, b) => a[0] - b[0]);
  for (const [at, run] of events) { await until(at); run(); await world.advance(0); }
  await until(Math.max(HIDE_AT, revealAt, OPEN_AT + storeMs) + 2000);
  const end = async () => { t.stop(); await t.w.close(); };
  return { world, t, pair, end };
}
const cssPx = (el, name) => parseFloat(el.style.getPropertyValue(name)) || 0;
// The stack as a person sees it: where the band of Notes begins and ends, and how high the two pages are.
function stack(t) {
  const p = t.parts(), gap = cssPx(t.html, "--zentral-notes-gap"), divider = t.rect(p.divider).top, sheet = p.sheet ? t.rect(p.sheet) : null;
  return {
    gap, up: cssPx(t.html, "--zentral-notes-gap-up"), bandTop: round(divider - gap), bandBottom: round(divider),
    upper: round(t.rect(p.upper).height), lower: round(t.rect(p.lower).height),
    sheetTop: sheet ? round(sheet.top) : NaN, sheetBottom: sheet ? round(sheet.bottom) : NaN,
    slot: p.sheet ? p.sheet.dataset.slot || "" : "none", folded: !!p.sheet && p.sheet.dataset.collapsed === "true",
  };
}
// What holds when Notes is open between the pages of a panel that is on screen and has come to rest.
function assertAtRest(t, label) {
  const p = t.parts(), s = stack(t), panel = t.rect(t.slider);
  assert.equal(s.slot, "gap", label + ": the sheet is the band between the pages");
  assert.equal(s.folded, false, label + ": the sheet is open");
  const lowest = Math.max(...[p.upper, p.lower, p.second, p.toolbar, p.divider].map((el) => t.rect(el).bottom));
  assert.ok(Math.abs(lowest - (panel.bottom - 1)) <= 1.01, `${label}: the stack fills the panel exactly (ends at ${round(lowest)}, the panel at ${round(panel.bottom - 1)})`);
  assert.ok(Math.abs(s.sheetTop - (s.bandTop + 6)) <= 1.01 && Math.abs(s.sheetBottom - (s.bandBottom - 6)) <= 1.01, `${label}: the sheet ${s.sheetTop}..${s.sheetBottom} lies in its band ${s.bandTop}..${s.bandBottom}`);
  const handle = t.rect(p.handle), divider = t.rect(p.divider);
  assert.ok(Math.abs(handle.top - divider.top) <= 1.01 && Math.abs(handle.left - divider.left) <= 1.01, `${label}: the divider's handle lies on the divider, below the sheet`);
  return s;
}
// A drag of one edge of the sheet, by a real press on what is on top at that point. edge: "n" (top grip), "head"
// (the title bar, which is the top edge of a band) or "s" (bottom grip). Returns how far everything moved.
async function dragEdge(t, world, edge, dy) {
  const sheet = t.rect(t.parts().sheet), x = sheet.left + sheet.width / 2;
  const y = edge === "n" ? sheet.top + 3 : edge === "s" ? sheet.bottom - 3 : sheet.top + 16;
  const before = stack(t);
  const target = t.pointer.down(x, y, 7);
  const hit = target ? (target._classes.has("zn-rz") ? "grip-" + target.getAttribute("data-h") : target._classes.has("zn-head") ? "title bar" : target.tag + "." + target.className) : "the page";
  for (let i = 1; i <= 4; i++) { t.pointer.move(x, y + (dy * i) / 4, 7); await world.advance(20); }
  const during = stack(t);
  t.pointer.up(x, y + dy, 7);
  await world.advance(1500);
  const after = stack(t);
  const moved = (a) => ({ top: round(a.bandTop - before.bandTop), bottom: round(a.bandBottom - before.bandBottom), upper: round(a.upper - before.upper), lower: round(a.lower - before.lower) });
  return { hit, before, during: moved(during), after: moved(after) };
}
// The contract of an edge drag: the dragged boundary follows the pointer, the other one stays, the sheet stays in its band.
async function assertEdgeOnly(t, world, edge, dy, label) {
  const d = await dragEdge(t, world, edge, dy);
  const top = edge !== "s", wantHit = edge === "n" ? "grip-n" : edge === "s" ? "grip-s" : "title bar";
  assert.equal(d.hit, wantHit, `${label}: the press reaches Notes' own ${wantHit}`);
  for (const [when, m] of [["while dragging", d.during], ["after the release", d.after]]) {
    const own = top ? m.top : m.bottom, other = top ? m.bottom : m.top;
    assert.ok(Math.abs(other) <= 1.01, `${label}, ${when}: the other edge stays (it moved ${other}; this edge ${own}; from ${JSON.stringify(d.before)})`);
    assert.ok(Math.abs(own - dy) <= 1.01, `${label}, ${when}: the edge follows the pointer by ${dy} (it moved ${own}; from ${JSON.stringify(d.before)})`);
    assert.ok(Math.abs((top ? m.lower : m.upper)) <= 1.01, `${label}, ${when}: the page on the other side keeps its height`);
  }
  assertAtRest(t, label + ", afterwards");
  return d;
}
// The part of the band the upper page gave: what it would have without Notes minus what it has.
const upperGave = (t, pair) => { const s = stack(t); return (s.upper + s.lower + s.gap) * pair.share - s.upper; };

(async () => {
  const M = suiteMath();
  const world0 = createPanelWorld({ sharedGlobal: { Map, Object } }), probe = world0.openWindow({ id: "probe" });
  const core = probe.core;

  // =====================================================================================================================
  // 1. One rule for both sides
  // =====================================================================================================================
  await test("Notes and the panel suite keep the same floor for a page, and it does not depend on the height of Notes", async () => {
    assert.equal(typeof core.gapPageFloor, "function", "Notes exports its floor");
    for (const room of [200, 280, 400, 479, 480, 481, 716, 916, 1400]) {
      const floor = core.gapPageFloor(room), max = core.gapMaxPx(room);
      assert.equal(floor, Math.min(120, room / 4), "120 px, or a quarter of the two pages when that is less (" + room + ")");
      assert.equal(max, Math.floor(room - 2 * floor), "the tallest band leaves two floors (" + room + ")");
      for (const gap of [10, 140, Math.floor(max / 2), max]) {
        if (!(gap > 0) || gap > max) continue;
        assert.equal(M.tripleFloor({ usable: room - gap, gap }), floor, `the suite holds the same floor at any band height (room ${room}, band ${gap})`);
      }
      assert.equal(core.clampGapPx(max + 500, room), max, "a taller wish is cut down to it");
      assert.equal(core.clampGapPx(max - 1, room), max - 1, "anything smaller passes");
    }
    assert.equal(core.clampGapPx(300, 0), 300, "pages that were not measured set no limit");
    assert.equal(M.tripleFloor({ usable: 586 }), 146.5, "without Notes the suite's own rule is untouched: 160 px or a quarter");
    assert.equal(M.tripleFloor({ usable: 1000 }), 160);
    assert.equal(M.tripleFloor({ usable: 60, gap: 656 }), 30, "a band that leaves less than two floors (the panel just shrank): the pages halve what is left");
  });

  await test("a split that leaves both pages their floor is applied exactly; any other is brought back to the nearest one that does", async () => {
    let seed = 20261115;
    const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    let literal = 0, held = 0;
    for (let i = 0; i < 4000; i++) {
      const room = 220 + Math.floor(random() * 1400), floor = core.gapPageFloor(room), max = core.gapMaxPx(room);
      const gap = 1 + Math.floor(random() * max), share = 0.05 + random() * 0.9, up = Math.floor(random() * (gap + 1));
      const usable = room - gap, wantTop = room * share - up;
      const { top, bottom } = M.tripleHeights({ usable, gap, share, up });
      assert.ok(Math.abs(top + bottom - usable) < 1e-9, "the two pages always use what is left");
      assert.ok(top >= floor - 1e-9 && bottom >= floor - 1e-9, `no page under its floor (room ${room}, band ${gap}, share ${share}, up ${up}: ${top} / ${bottom})`);
      const applied = M.tripleGapUp({ usable, gap, share, top });
      if (wantTop >= floor && usable - wantTop >= floor) {
        literal++;
        assert.ok(Math.abs(top - wantTop) < 1e-9, "a possible split is applied as asked");
        assert.ok(Math.abs(applied - up) < 1e-6, "and reported as asked");
      } else {
        held++;
        assert.ok(Math.abs(top - floor) < 1e-9 || Math.abs(bottom - floor) < 1e-9, "an impossible one stops where a page reaches its floor");
        // The reported split is the one on screen (cut to the band when even the whole band is not enough).
        assert.ok(applied >= 0 && applied <= gap, "the reported part lies inside the band");
        if (applied > 0 && applied < gap) assert.ok(Math.abs(room * share - applied - top) < 1e-6, "and is what the upper page really gave");
      }
    }
    assert.ok(literal > 500 && held > 500, `both kinds were tried (${literal} possible, ${held} not)`);
    // The fault in one line: a page on its floor used to move when only the band's height changed.
    const a = M.tripleHeights({ usable: 371, gap: 345, share: 0.29, up: 173 }), b = M.tripleHeights({ usable: 401, gap: 315, share: 0.29, up: 173 });
    assert.equal(a.top, b.top, "the upper page rests on the same floor at a band of 345 px and of 315 px");
  });

  await test("dragging the divider while Notes is open still lands where the pointer is, within the same floors", async () => {
    for (const [usable, gap, up] of [[466, 250, 125], [371, 345, 173], [716, 0, -1], [300, 140, 30]]) {
      const floor = M.tripleFloor({ usable, gap });
      for (const topPx of [floor, floor + 17, usable / 2, usable - floor]) {
        const share = M.tripleShareFor({ usable, gap, topPx, up });
        assert.ok(Math.abs(M.tripleHeights({ usable, gap, share, up }).top - topPx) < 1e-6, `round trip at ${topPx} (pages ${usable}, band ${gap})`);
      }
      assert.ok(Math.abs(M.tripleHeights({ usable, gap, share: M.tripleShareFor({ usable, gap, topPx: -50, up }), up }).top - floor) < 1e-6, "a pointer above the range stops at the floor");
    }
  });

  // =====================================================================================================================
  // 2. Start-up with the panel left on screen
  // =====================================================================================================================
  await test("an evenly divided pair is exactly as before: 45% of the pages for Notes, half from each page", async () => {
    const { world, t, pair, end } = await startUp({ hide: false });
    const s = assertAtRest(t, "even pair");
    assert.deepEqual([s.gap, s.up, s.upper, s.lower], [345, 173, 185, 186]);
    assert.ok(Math.abs(upperGave(t, pair) - s.up) <= 1, "what Notes holds as its upper part is what the upper page gave");
    await assertEdgeOnly(t, world, "n", -40, "even pair, top edge up");
    await assertEdgeOnly(t, world, "s", 30, "even pair, bottom edge down");
    assert.deepEqual(world.warnings, []);
    await end();
  });

  for (const [share, small] of [[0.29, "upper"], [0.68, "lower"]]) {
    await test(`start-up, panel on screen, the ${small} page is the smaller one (share ${share}): each edge of Notes moves only its own boundary`, async () => {
      const { world, t, pair, end } = await startUp({ share, hide: false });
      const s = assertAtRest(t, "restored");
      // Centred on the divider, the band would take 173 px from a page that has only about 208, so that page stops at
      // its floor and the other page gives the rest. Notes has to hold THAT split, not the one it asked for.
      assert.ok(Math.abs(upperGave(t, pair) - s.up) <= 1, `Notes holds the split that is on screen (it holds ${s.up}, the upper page gave ${round(upperGave(t, pair))})`);
      assert.equal(s.gap, 345, "Notes keeps its height");
      assert.equal(pair.share, share, "restoring Notes does not move the saved divider");
      const floorBefore = s[small];
      await assertEdgeOnly(t, world, "n", 30, "top grip down");
      await assertEdgeOnly(t, world, "n", -20, "top grip up");
      await assertEdgeOnly(t, world, "head", 24, "title bar down");
      await assertEdgeOnly(t, world, "s", -20, "bottom grip up");
      await assertEdgeOnly(t, world, "s", 16, "bottom grip down");
      assert.equal(floorBefore, 120, `the ${small} page had come to rest on a floor of 120 px`);
      assert.deepEqual(world.warnings, []);
      await end();
    });
  }

  await test("a page on its floor gives no more: the edge on its side stops, the other edge is still free", async () => {
    const { world, t, end } = await startUp({ share: 0.29, hide: false });
    const floor = stack(t).upper;
    const up = await dragEdge(t, world, "n", -40);
    assert.deepEqual([up.hit, up.during.top, up.during.bottom], ["grip-n", 0, 0], "dragging the top edge further up moves nothing at all");
    assert.deepEqual([up.after.top, up.after.bottom], [0, 0]);
    // Growing downward takes from the larger page only. Before, the upper page's floor shrank with the band and the top edge crept up.
    await assertEdgeOnly(t, world, "s", 40, "the bottom edge still takes room from the larger page");
    assert.equal(stack(t).upper, floor, "the page on its floor has not moved");
    assert.equal(floor, 120);
    await end();
  });

  await test("a divider saved while the band sat elsewhere (the split of the last session is not kept): same contract", async () => {
    // Last session: the band was dragged up and the divider with it; the suite saved share 0.29 and Notes its height (32% of the pages).
    const { world, t, pair, end } = await startUp({ share: 0.29, meta: { shareGap: 0.32 }, hide: false });
    const s = assertAtRest(t, "restored");
    assert.equal(s.gap, 245);
    assert.ok(Math.abs(upperGave(t, pair) - s.up) <= 1, `Notes holds the split that is on screen (it holds ${s.up}, the upper page gave ${round(upperGave(t, pair))})`);
    await assertEdgeOnly(t, world, "n", 30, "top grip down");
    await assertEdgeOnly(t, world, "s", -20, "bottom grip up");
    assert.equal(s.upper, 120);
    await end();
  });

  // =====================================================================================================================
  // 3. Start-up with the panel sliding away and being shown again
  // =====================================================================================================================
  for (const storeMs of [0, 2600]) {
    await test(`start-up, the panel slides away and is shown again (notes read ${storeMs ? "after" : "before"} it left): Notes opens between the pages and its edges are independent`, async () => {
      const { world, t, end } = await startUp({ share: 0.29, storeMs, revealAt: 5000 });
      assertAtRest(t, "shown again");
      await assertEdgeOnly(t, world, "n", 30, "top grip down");
      await assertEdgeOnly(t, world, "n", -20, "top grip up");
      await assertEdgeOnly(t, world, "s", -20, "bottom grip up");
      assert.deepEqual(world.warnings, []);
      await end();
    });
  }

  await test("Notes with its own autohide: the strip between the pages opens the sheet, and the edges are independent", async () => {
    const { world, t, end } = await startUp({ share: 0.68, meta: { dock: "hover" }, revealAt: 5000 });
    let s = stack(t);
    assert.deepEqual([s.folded, s.gap], [true, 10], "shown again, Notes is its thin strip between the pages");
    const strip = t.rect(t.parts().strip);
    t.pointer.down(strip.left + strip.width / 2, strip.top + strip.height / 2, 3);
    t.pointer.up(strip.left + strip.width / 2, strip.top + strip.height / 2, 3);
    await world.advance(1500);
    s = assertAtRest(t, "opened from the strip");
    assert.equal(s.gap, 345);
    await assertEdgeOnly(t, world, "n", 30, "top grip down");
    await assertEdgeOnly(t, world, "s", -20, "bottom grip up");
    await end();
  });

  await test("Notes that does not fold with the panel (it hides on an outside click): restored inside the hidden panel, same contract once the panel is shown", async () => {
    const { world, t, pair, end } = await startUp({ share: 0.68, meta: { hideTrigger: "click" }, storeMs: 2600, revealAt: 5000 });
    const s = stack(t);
    assert.deepEqual([s.slot, s.folded, s.gap], ["gap", false, 345]);
    assert.ok(Math.abs(upperGave(t, pair) - s.up) <= 1, `Notes holds the split that is on screen (it holds ${s.up}, the upper page gave ${round(upperGave(t, pair))})`);
    await assertEdgeOnly(t, world, "n", 30, "top grip down");
    await assertEdgeOnly(t, world, "s", -20, "bottom grip up");
    assert.equal(s.lower, 120);
    await end();
  });

  // =====================================================================================================================
  // 4. "Swap top and bottom panels" is not needed, and changes nothing about the edges
  // =====================================================================================================================
  await test("the same drag gives the same result before and after \"Swap top and bottom panels\"", async () => {
    const { world, t, end } = await startUp({ share: 0.68, hide: false });
    const before = await assertEdgeOnly(t, world, "n", 30, "before the swap");
    const swap = t.parts().swap;
    assert.ok(swap, "the second panel's bar has the swap button");
    swap.click();
    await world.advance(2000);
    const s = assertAtRest(t, "after the swap");
    assert.equal(s.gap, before.before.gap - 30, "the swap keeps the height Notes was dragged to");
    const after = await assertEdgeOnly(t, world, "n", 30, "after the swap");
    assert.deepEqual([after.during.top, after.during.bottom], [before.during.top, before.during.bottom]);
    await end();
  });

  await test("\"Swap top and bottom panels\" leaves Notes as it is: the same sheet, the text and the caret, the pages trade their heights", async () => {
    const { world, t, end } = await startUp({ share: 0.4, hide: false });
    const sheet = t.parts().sheet, bar = t.parts().bar, editor = sheet.querySelector(".zn-editor");
    editor.value = "half a sentence"; editor.selectionStart = editor.selectionEnd = 6;
    const before = stack(t);
    t.parts().swap.click();
    await world.advance(2000);
    const p = t.parts(), after = assertAtRest(t, "after the swap");
    assert.ok(p.bar !== bar, "the suite built a new bar for the second panel");
    assert.ok(p.sheet === sheet, "Notes is still the same sheet (it used to be closed with the old bar and opened again on the new one)");
    assert.equal(t.w.sheets().length, 1, "and there is no second one");
    assert.deepEqual([editor.value, editor.selectionStart], ["half a sentence", 6], "the text being typed and the caret are untouched");
    assert.ok(t.w.isNotesButton(p.bar.firstElementChild), "the Notes button moved to the new bar");
    assert.deepEqual([after.gap, after.upper, after.lower], [before.gap, before.lower, before.upper], "Notes keeps its height, the two pages trade theirs");
    assert.ok(Math.abs(after.bandTop - before.bandTop - (before.lower - before.upper)) <= 1.01, "so the band moves by exactly the difference of the two pages");
    // The button on the new bar still belongs to this sheet: it closes it, and opens it again.
    p.bar.firstElementChild.click(); await world.advance(500);
    assert.equal(t.w.openSheets().length, 0, "the button on the new bar closes this Notes");
    p.bar.firstElementChild.click(); await world.advance(1500);
    assertAtRest(t, "opened again from the new bar");
    assert.deepEqual(world.warnings, []);
    await end();
  });

  await test("\"Swap top and bottom panels\" does not open a Notes that was folded away", async () => {
    const { world, t, end } = await startUp({ meta: { dock: "hover" }, revealAt: 5000 });
    const sheet = t.parts().sheet;
    assert.deepEqual([stack(t).folded, stack(t).gap], [true, 10], "before: Notes is its thin strip between the pages");
    t.parts().swap.click();
    await world.advance(2000);
    const s = stack(t), p = t.parts();
    assert.ok(p.sheet === sheet, "the same sheet");
    assert.deepEqual([s.folded, s.gap, !!p.strip], [true, 10, true], "still folded to its strip (the swap used to bring it back fully open)");
    const strip = t.rect(p.strip), divider = t.rect(p.divider);
    assert.ok(Math.abs(strip.bottom - divider.top) <= 1.01, "the strip lies just above the divider");
    await end();
  });

  // =====================================================================================================================
  // 5. A band that would leave the pages nothing
  // =====================================================================================================================
  for (const [name, attrs] of [["bars below their pages", {}], ["both bars at the divider", { "bgalazka-triple-inward-toolbars": "true" }], ["bars above their pages", { "bgalazka-webtoolbar-top": "true" }]]) {
    await test(`"Larger" on a panel of ordinary height (${name}): both pages keep their floor and the sheet lies in its band`, async () => {
      for (const height of [640, 800]) {
        const { world, t, end } = await startUp({ meta: { size: "full" }, hide: false, window: { height, rootAttrs: { "bgalazka-webtoolbar": "true", ...attrs } } });
        const s = assertAtRest(t, `${height} px`);
        const room = s.upper + s.lower + s.gap;
        assert.ok(s.upper >= 119 && s.lower >= 119, `${height} px: each page keeps 120 px (they have ${s.upper} and ${s.lower}; before, they were left a few px and Notes lost its place)`);
        assert.ok(Math.abs(s.gap - core.gapMaxPx(room)) <= 1, `${height} px: Notes takes all the rest (${s.gap} of ${room})`);
        // Both pages are on their floor: Notes cannot grow, and shrinking it from the top gives the room to the upper page only.
        await assertEdgeOnly(t, world, "n", 30, `${height} px, top grip down`);
        assert.deepEqual(world.warnings, []);
        await end();
      }
    });
  }

  await test("a remembered height of 85% of the pages on a short panel: the same floor applies, the stored share is not rewritten", async () => {
    const { world, t, end } = await startUp({ meta: { shareGap: 0.85 }, hide: false, window: { height: 560 } });
    const s = assertAtRest(t, "restored");
    assert.ok(s.upper >= 119 && s.lower >= 119, `each page keeps its floor (${s.upper} / ${s.lower})`);
    assert.equal(world.meta().shareGap, 0.85, "the height the person chose is kept for a taller panel");
    await assertEdgeOnly(t, world, "s", -20, "bottom grip up");
    await end();
  });

  await test("a very low panel: the floor is a quarter of the two pages, Notes takes at most half of them", async () => {
    const { t, end } = await startUp({ meta: { shareGap: 0.85 }, hide: false, window: { height: 400 } });
    const s = assertAtRest(t, "restored");
    const room = s.upper + s.lower + s.gap;
    assert.ok(room < 480, "the two pages share less than 480 px (" + room + ")");
    assert.ok(Math.abs(s.upper - room / 4) <= 1 && Math.abs(s.lower - room / 4) <= 1, `each page has a quarter (${s.upper} / ${s.lower} of ${room})`);
    await end();
  });

  // =====================================================================================================================
  // 6. Nothing creeps: Notes that goes away and comes back leaves the pages where they were
  // =====================================================================================================================
  // How a pair came to be divided unevenly without anybody dragging it. Notes takes Math.round(px / 2) from the upper
  // page; when the band went away the suite gave each page exactly half of it back. With a band of an odd height
  // (345 px in a panel of 800) the divider therefore moved half a px up at every round, and the suite saves the split
  // each time. A panel that slides away and returns with Notes open is one round.
  const place = (t) => { const s = stack(t); return [s.gap, s.bandTop, s.bandBottom, s.upper, s.lower]; };
  const pressStrip = async (t, world) => {
    const strip = t.rect(t.parts().strip);
    t.pointer.down(strip.left + strip.width / 2, strip.top + strip.height / 2, 3);
    t.pointer.up(strip.left + strip.width / 2, strip.top + strip.height / 2, 3);
    await world.advance(1500);
  };
  const pressOutside = async (t, world) => { t.pointer.down(100, 300, 9); t.pointer.up(100, 300, 9); await world.advance(1500); };

  for (const [name, options, gap] of [
    ["a panel of 800 px", {}, 345],
    ["a short panel", { window: { height: 560 } }, 237],
    ["a pair divided 60 / 40", { share: 0.6, window: { height: 1000 } }, 435],
  ]) {
    await test(`the panel slides away and returns thirty times with Notes open (${name}, a band of ${gap} px): the pages keep their split`, async () => {
      const { world, t, pair, end } = await startUp({ ...options, revealAt: 5000 });
      assertAtRest(t, "shown again");
      assert.equal(stack(t).gap, gap, "the band has an odd height, which is what used to creep");
      const share = pair.share, before = place(t), saved = options.share || 0.5;
      assert.ok(Math.abs(share - saved) < 1e-9, `start-up itself (one round) left the saved split at ${saved} (it is ${share})`);
      for (let i = 0; i < 30; i++) { t.hide(); await world.advance(1500); t.reveal(); await world.advance(1500); }
      assertAtRest(t, "after thirty rounds");
      assert.ok(Math.abs(pair.share - share) < 1e-9, `the saved split is unchanged (${share} before, ${pair.share} after)`);
      assert.deepEqual(place(t), before, "and so are the band of Notes and the heights of both pages");
      assert.deepEqual(world.warnings, []);
      await end();
    });
  }

  await test("the button on the bar closes and opens Notes ten times: Notes and the pages come back to the same place each time", async () => {
    const { world, t, pair, end } = await startUp({ hide: false });
    await dragEdge(t, world, "n", -40); // a band of an odd height that is not centred on the divider
    const button = () => t.parts().bar.firstElementChild, open = place(t);
    let closed = null, share = NaN;
    for (let i = 0; i < 10; i++) {
      button().click(); await world.advance(800);
      const pages = [stack(t).upper, stack(t).lower];
      // Closing gives each page half of the band back, so the first close moves the divider to the middle of the band.
      if (!closed) { closed = pages; share = pair.share; }
      assert.deepEqual(pages, closed, "closed, round " + (i + 1) + ": the pages have the heights of the first close");
      button().click(); await world.advance(1500);
      assert.deepEqual(place(t), open, "open, round " + (i + 1) + ": the band and both pages are where they were before the first close");
    }
    assert.ok(Math.abs(pair.share - share) < 1e-9, "the saved split is the one of the first close");
    assert.equal(open[0] % 2, 1, "(the band had an odd height, " + open[0] + " px: an even one never crept)");
    await end();
  });

  // A sheet that hides on a press outside folds to a 10 px strip between the pages and keeps its gap. The strip's own
  // split can hold the band's split to one tenth only, so the band's is kept beside it.
  await test("a sheet whose top edge was dragged folds to its strip and opens again exactly where it was", async () => {
    const { world, t, end } = await startUp({ meta: { dock: "hover", hideTrigger: "click" }, hide: false });
    if (stack(t).folded) await pressStrip(t, world);
    await assertEdgeOnly(t, world, "n", -40, "top grip up");
    const open = place(t), sheet = t.parts().sheet;
    assert.ok(Math.abs(stack(t).up - open[0] / 2) > 15, "the band is not centred on the divider any more (its upper part is " + stack(t).up + " of " + open[0] + ")");
    for (let i = 0; i < 3; i++) {
      await pressOutside(t, world);
      assert.deepEqual([stack(t).folded, stack(t).gap, !!t.parts().strip], [true, 10, true], "a press outside folds it to its strip, round " + (i + 1));
      await pressStrip(t, world);
      assertAtRest(t, "opened from the strip, round " + (i + 1));
      assert.deepEqual(place(t), open, `the band and both pages are where they were, round ${i + 1} (it used to come back 18 px higher)`);
    }
    assert.ok(t.parts().sheet === sheet, "the same sheet throughout");
    await end();
  });

  await test("the panels are swapped while Notes is folded to its strip: it stays folded and opens as the mirror image", async () => {
    const { world, t, end } = await startUp({ meta: { dock: "hover", hideTrigger: "click" }, hide: false });
    if (stack(t).folded) await pressStrip(t, world);
    await dragEdge(t, world, "n", -40);
    const open = stack(t);
    // What a swap does to an open sheet: the pages trade their heights, the band keeps its height.
    t.parts().swap.click(); await world.advance(2000);
    const mirrored = place(t);
    assert.deepEqual([mirrored[0], mirrored[3], mirrored[4]], [open.gap, open.lower, open.upper], "open: the pages trade their heights");
    t.parts().swap.click(); await world.advance(2000);
    assert.deepEqual(place(t), [open.gap, open.bandTop, open.bandBottom, open.upper, open.lower], "a second swap brings everything back");
    // The same swap while the sheet is folded.
    await pressOutside(t, world);
    assert.equal(stack(t).folded, true);
    t.parts().swap.click(); await world.advance(2000);
    assert.deepEqual([stack(t).folded, stack(t).gap, !!t.parts().strip], [true, 10, true], "the swap leaves it folded");
    await pressStrip(t, world);
    assertAtRest(t, "opened after the swap");
    assert.deepEqual(place(t), mirrored, "it opens exactly as a sheet that was open during the swap");
    assert.deepEqual(world.warnings, []);
    await end();
  });

  await probe.close();
  console.log(`\n${passed} Triple View start-up tests passed`);
})().catch((error) => { console.error(error); process.exit(1); });
