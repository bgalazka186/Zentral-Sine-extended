"use strict";
/* UI4.8: Triple View divider drag strip (.bgalazka-triple-drag-handle) during and after panel autohide.
 * Runs the real ZentralSecondaryViews.uc.js and Notes in tests/helpers/fake-triple-view.cjs (real CSS cascade,
 * virtual clock, 0.2 s transform slide in both directions). */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createPanelWorld, noteText, DIR } = require("./helpers/fake-panel-window.cjs");
const { openTripleWindow } = require("./helpers/fake-triple-view.cjs");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("ok -", name);
}

const STARTUP = "zen.workspace.bgalazka.open_at_startup";
const round = (v) => Math.round(v * 10) / 10;

async function dragAt(t, world, x, y, dy, pointerId = 11) {
  const target = t.pointer.down(x, y, pointerId);
  for (let i = 1; i <= 4; i++) {
    t.pointer.move(x, y + (dy * i) / 4, pointerId);
    await world.advance(20);
  }
  t.pointer.up(x, y + dy, pointerId);
  await world.advance(600);
  return target;
}

(async () => {
  await test("panel slid away without Notes between the panels: press where the divider was reaches the page, and dragging works again once revealed", async () => {
    const world = createPanelWorld({ sharedGlobal: { Map, Object } });
    const t = openTripleWindow(world);
    const pair = t.link("mail", "chat", 0.5);
    t.autohide(true);
    t.w.start();
    t.openApp("mail");
    await world.advance(1000);

    const before = t.rect(t.parts().divider);
    const beforeHandle = t.rect(t.parts().handle);
    const cx = before.left + before.width / 2;
    const cy = before.top + before.height / 2;
    assert.ok(Math.abs(beforeHandle.left - before.left) <= 1, "handle starts aligned horizontally with the divider");
    assert.ok(Math.abs(beforeHandle.top - (before.top - 3)) <= 1, "handle extends 3 px above the divider when Notes is closed");
    assert.ok(Math.abs(beforeHandle.height - (before.height + 6)) <= 1, "handle extends 3 px below the divider too");
    const liveHit = t.hit(cx, cy);
    assert.ok(liveHit && liveHit._classes.has("bgalazka-triple-drag-handle"), "while shown, the handle takes the press");

    // Slide the panel away: neither immediately nor after the 0.2 s slide may the handle intercept presses over the page.
    t.hide();
    assert.ok(t.hit(cx, cy) === null, "as soon as autohide hides the panel, a press at the divider reaches the web page");
    await world.advance(500);
    for (const y of [before.top - 2, cy, before.bottom + 2]) {
      assert.ok(t.hit(cx, y) === null, `slid away, press at y=${round(y)} reaches the web page (not the invisible drag strip)`);
    }
    const pagePress = await dragAt(t, world, cx, cy, 80, 12);
    assert.ok(pagePress === null, "pressing and dragging over the web page hits the page");
    assert.equal(round(pair.share), 0.5, "dragging over the web page while hidden does not resize Triple View");

    // Reveal the panel (0.2 s transform slide back in) and drag the divider without any prior action.
    t.reveal();
    await world.advance(500);
    const shownDivider = t.rect(t.parts().divider);
    const shownHandle = t.rect(t.parts().handle);
    assert.ok(Math.abs(shownHandle.left - shownDivider.left) <= 1, "after reveal, handle lies on the divider horizontally");
    assert.ok(Math.abs(shownHandle.top - (shownDivider.top - 3)) <= 1, "after reveal, handle top lies 3 px above the divider");
    const upperBefore = t.rect(t.parts().upper).height;
    const grabbed = await dragAt(t, world, cx, shownDivider.bottom + 1.5, 60, 13);
    assert.ok(grabbed && grabbed._classes.has("bgalazka-triple-drag-handle"), "the 3 px lower extension of the handle grabs the divider");
    const upperAfter = t.rect(t.parts().upper).height;
    assert.ok(Math.abs((upperAfter - upperBefore) - 60) <= 1.5, `divider drag moved upper panel by 60 px (got ${round(upperAfter - upperBefore)})`);
    assert.ok(pair.share > 0.55, `pair share updated after divider drag (${pair.share})`);

    t.stop();
    await t.w.close();
  });

  await test("fit while slid away (Notes hideTrigger='click', notes read after panel left): reveal places the strip back on the divider after the 0.2 s slide and divider drags", async () => {
    const world = createPanelWorld({ sharedGlobal: { Map, Object } });
    world.disk.set(DIR + "/n1.md", noteText("One"));
    world.disk.set(DIR + "/meta.json", JSON.stringify({ openIn: "triple", hideTrigger: "click", folders: [] }));
    world.prefs.set(STARTUP, JSON.stringify({ id: "mail", mode: "triple" }));
    const t = openTripleWindow(world);
    const pair = t.link("mail", "chat", 0.68);
    t.autohide(true);
    const release = world.hold((op) => op === "makeDirectory" || op === "children" || op === "read");
    t.w.start();

    await world.advance(400);
    t.openApp("mail");
    await world.advance(1600);
    t.hide();
    await world.advance(1000);
    // Panel is now fully slid away (left = 1349); Notes finishes reading its store and opens its gap while off-screen.
    release();
    await world.advance(1000);
    assert.ok(t.slideOffset > 400, `panel is slid off-screen (${t.slideOffset})`);

    // Reveal the panel: the slide back takes 200 ms, so at +40 ms it is still mid-slide, and by +450 ms it is at rest.
    t.reveal();
    await world.advance(40);
    assert.ok(t.slideOffset > 50, `at 40 ms into reveal the panel is still sliding back (${round(t.slideOffset)} px)`);
    await world.advance(460);
    assert.equal(t.slideOffset, 0, "after 500 ms the reveal slide has finished");

    const divider = t.rect(t.parts().divider);
    const handle = t.rect(t.parts().handle);
    assert.ok(
      Math.abs(handle.left - divider.left) <= 1,
      `without any other action, handle.left (${round(handle.left)}) matches divider.left (${round(divider.left)})`,
    );
    assert.ok(
      Math.abs(handle.top - divider.top) <= 1,
      `while Notes holds the gap, handle.top (${round(handle.top)}) starts at divider.top (${round(divider.top)})`,
    );
    assert.ok(
      Math.abs(handle.height - (divider.height + 3)) <= 1,
      `handle extends 3 px below the divider (${round(handle.height)} vs ${round(divider.height)})`,
    );

    // Press in the 3 px strip BELOW the divider (outside the divider's own 14 px box!) so only a properly placed handle can catch it.
    const x = divider.left + divider.width / 2;
    const yBelowDivider = divider.bottom + 1.5;
    const upperBefore = t.rect(t.parts().upper).height;
    const grabbed = await dragAt(t, world, x, yBelowDivider, -40, 14);
    assert.ok(
      grabbed && grabbed._classes.has("bgalazka-triple-drag-handle"),
      "press 1.5 px below the divider reaches the repositioned .bgalazka-triple-drag-handle",
    );
    const upperAfter = t.rect(t.parts().upper).height;
    assert.ok(
      Math.abs((upperAfter - upperBefore) + 40) <= 1.5,
      `dragging the divider up by 40 px shrank the upper page by 40 px (got ${round(upperAfter - upperBefore)})`,
    );
    assert.ok(pair.share < 0.68, `saved pair share moved with the divider (${pair.share})`);

    // Leaving Triple View cleans up the handle and observers.
    const obsBefore = t.observers.counts();
    t.apps.closeApp("chat");
    await world.advance(200);
    assert.ok(t.parts().handle === null, "closing the second panel removes .bgalazka-triple-drag-handle");
    assert.ok(t.observers.counts().mutation <= obsBefore.mutation, "no extra MutationObserver left behind");

    t.stop();
    await t.w.close();
  });

  await test("hover reveal and secondary views share the scheduleSecondaryGeometryFit hook", () => {
    const hover = fs.readFileSync(
      path.resolve(__dirname, "../extension/panels/interaction/ZentralPanelHover.js"),
      "utf8",
    );
    const sv = fs.readFileSync(
      path.resolve(__dirname, "../extension/panels/secondary-views/ZentralSecondaryViews.uc.js"),
      "utf8",
    );
    assert.match(hover, /ctx\.scheduleSecondaryGeometryFit\?\.\(\)/, "setHoverPanelHidden schedules a secondary geometry fit on reveal");
    assert.match(sv, /ctx\.scheduleSecondaryGeometryFit = scheduleSecondaryGeometryFit/, "ZentralSecondaryViews exposes scheduleSecondaryGeometryFit on ctx");
    assert.match(sv, /delete ctx\.scheduleSecondaryGeometryFit/, "ZentralSecondaryViews cleans up ctx.scheduleSecondaryGeometryFit");
  });

  console.log(`\n${passed} Triple View autohide divider tests passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
