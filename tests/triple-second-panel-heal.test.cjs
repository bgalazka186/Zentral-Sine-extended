"use strict";
/* Triple View: the lower panel that stays empty after a cold start-up, or after an autohidden panel comes back.
 *
 * The fault (owner report): the lower Zentral panel showed no web content on the first launch ("Open at Startup"),
 * and a revealed autohidden panel sometimes did not recover; "Swap top and bottom panels" (which rebuilds the lower
 * shell) always fixed it. The bounded retries of the panel suite (2 tries, 500 ms apart) ended before a cold start
 * had finished, nothing looked again at the reveal, and the start-up let the panel slide away 1.2 s after it opened
 * whatever state the lower page was in.
 *
 * The real ZentralSecondaryViews.uc.js runs in the fake window of tests/helpers/fake-triple-view.cjs on a virtual
 * clock. The dropped first loads below are a stand-in for the cold start: the real browser is not here, so this does
 * NOT prove Gecko's remote browsers, only that the panel suite now looks again, at the right moments, and then
 * leaves a healthy pair alone. The owner checks the real start-up and reveal in the app. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createPanelWorld } = require("./helpers/fake-panel-window.cjs");
const { openTripleWindow } = require("./helpers/fake-triple-view.cjs");

const REPO = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("ok -", name); }

// A Triple View "mail" / "chat" whose lower page loses every load it is asked for before `until` ms (a cold start
// that has not finished). `loads` counts what each page was really asked to load.
async function coldPair({ until = 3100, hideAt = 0, revealAt = 0, runTo = 9000 } = {}) {
  const world = createPanelWorld({ sharedGlobal: { Map, Object } });
  const t = openTripleWindow(world, {});
  t.link("mail", "chat", 0.5);
  t.autohide(true);
  const loads = { mail: 0, chat: 0 };
  const events = { settled: 0 };
  t.document.addEventListener("zentral-triple-settled", () => { events.settled++; });
  const make = t.apps.getOrCreateAppBrowser.bind(t.apps);
  t.apps.getOrCreateAppBrowser = (app) => {
    const made = make(app);
    if (made.isNew) {
      const real = made.browser.loadURI;
      made.browser.loadURI = (uri) => {
        loads[app.id]++;
        if (app.id === "chat" && world.now < until) return; // the cold start swallows it
        real(uri);
      };
    }
    return made;
  };
  let now = 0;
  const until2 = async (ms) => { if (ms > now) { await world.advance(ms - now); now = ms; } };
  await until2(400);
  t.openApp("mail");
  await world.advance(0);
  const plan = [];
  if (hideAt) plan.push([hideAt, () => t.hide()]);
  if (revealAt) plan.push([revealAt, () => t.reveal()]);
  plan.sort((a, b) => a[0] - b[0]);
  for (const [at, run] of plan) { await until2(at); run(); await world.advance(0); }
  await until2(runTo);
  const chat = () => t.ctx.getAllAppBrowsers().find((b) => b._bgalazkaAppId === "chat");
  return { world, t, loads, events, chat, end: async () => { t.stop(); await t.w.close(); } };
}
const spec = (browser) => browser?.currentURI?.spec;

(async () => {
  await test("a lower page whose first loads were lost is loaded again while the panel is on screen", async () => {
    const s = await coldPair({ until: 3100 });
    try {
      assert.equal(t_mode(s.t), "true", "the pair is open as a Triple View");
      assert.equal(spec(s.chat()), "https://chat.test/", "the lower page ended up with its content (not about:blank)");
      assert.ok(s.loads.chat >= 3, "it was asked again after the cold start's own tries ended (" + s.loads.chat + " loads)");
      assert.ok(s.loads.chat <= 8, "and not in a loop (" + s.loads.chat + " loads)");
    } finally { await s.end(); }
  });

  await test("an autohidden panel does not load behind the user's back and heals as soon as it is revealed", async () => {
    const s = await coldPair({ until: 5000, hideAt: 2000, runTo: 5900 });
    try {
      const while_hidden = spec(s.chat());
      assert.equal(s.t.hidden, true, "the panel is slid away");
      assert.notEqual(while_hidden, "https://chat.test/", "nothing was forced while the panel was out of sight");
      const before = s.loads.chat;
      s.t.reveal();
      await s.world.advance(1500);
      assert.equal(spec(s.chat()), "https://chat.test/", "the reveal brought the lower page's content");
      assert.ok(s.loads.chat > before, "the reveal looked again");
    } finally { await s.end(); }
  });

  await test("a healthy pair is left exactly as it is (no extra loads, no extra work)", async () => {
    const s = await coldPair({ until: 0 });
    try {
      assert.equal(spec(s.chat()), "https://chat.test/");
      const mail = s.loads.mail, chat = s.loads.chat;
      s.t.hide(); await s.world.advance(300); s.t.reveal(); await s.world.advance(9000);
      assert.equal(s.loads.mail, mail, "the upper page was not loaded again");
      assert.equal(s.loads.chat, chat, "the lower page was not loaded again");
    } finally { await s.end(); }
  });

  await test("Notes is told once that the pages have their final size, and only while the panel is on screen", async () => {
    const hidden = await coldPair({ until: 0, hideAt: 600, runTo: 9000 });
    try {
      assert.equal(hidden.t.hidden, true);
      assert.equal(hidden.events.settled, 0, "nothing is announced for a panel nobody can see");
      hidden.t.reveal();
      await hidden.world.advance(1500);
      assert.equal(hidden.events.settled, 1, "the reveal announces it, once");
      await hidden.world.advance(9000);
      assert.equal(hidden.events.settled, 1, "and not again");
    } finally { await hidden.end(); }
    const shown = await coldPair({ until: 0 });
    try { assert.equal(shown.events.settled, 1, "a start-up that stays on screen announces it, once"); } finally { await shown.end(); }
  });

  await test("a lower page that never loads is reported in the console, not swallowed", async () => {
    const warns = [], real = console.warn;
    console.warn = (...a) => { warns.push(a.map(String).join(" ")); };
    let s;
    try { s = await coldPair({ until: 1e9, runTo: 9000 }); } finally { console.warn = real; }
    try {
      assert.ok(warns.some((w) => /blank; loading it again/.test(w)), "each reload is logged");
      assert.ok(warns.some((w) => /reload limit reached/.test(w)), "the reload limit is logged");
      assert.ok(warns.some((w) => /still not showing content after recovery/.test(w)), "giving up is logged with the page's state");
    } finally { await s.end(); }
  });

  await test("start-up hides the panel only after a Triple View's lower page has content (or after 6 s)", () => {
    const src = read("extension/panels/ZentralPanels.uc.js");
    assert.match(src, /secondaryContentReady\?\.\(\) !== false/, "the hide asks the secondary views");
    assert.match(src, /waited >= 6000/, "and gives up waiting after 6 s");
    assert.match(src, /setTimeout\(hideWhenReady, 1200\)/, "the first look is still 1.2 s after the open");
    assert.doesNotMatch(src, /if \(opened\) setTimeout\(onHoverRootLeave, 1200\)/, "the fixed 1.2 s hide is gone");
  });

  await test("every reveal wakes the pages, and the retry helper can be asked for more tries", () => {
    const hover = read("extension/panels/interaction/ZentralPanelHover.js");
    const reveal = hover.slice(hover.indexOf("function setHoverPanelHidden"), hover.indexOf("function syncHoverPanelAvailability"));
    assert.match(reveal, /if \(autohideEnabled\) apps\?\.startPositionTracking\?\.\(\);\s*[\s\S]*?ctx\.requestPanelActivity\?\.\(\);/, "requestPanelActivity no longer depends on the saved autohide preference");
    assert.doesNotMatch(reveal, /if \(autohideEnabled\) \{\s*apps\?\.startPositionTracking\?\.\(\);\s*ctx\.requestPanelActivity/, "the old gated form is gone");
    assert.match(reveal, /ctx\.healSecondaryPanel\?\.\(\)/, "a reveal heals the second panel");
    const panels = read("extension/panels/ZentralPanels.uc.js");
    assert.match(panels, /ctx\.retryPanelTask = \(key, task, \{ minAttempts = 0 \} = \{\}\)/, "retryPanelTask takes minAttempts");
    assert.match(panels, /Math\.min\(12, Math\.trunc\(Number\(minAttempts\) \|\| 0\)\)/, "capped at 12 tries");
    assert.match(panels, /options\.attempts\s*\?/, "a limit of 0 still turns retries off");
    assert.match(read("extension/panels/interaction/ZentralPanelAudio.js"), /\{ minAttempts: 8 \}/, "panel activity asks for 8 tries");
    const notes = read("additional/notes/ZentralNotes.uc.js");
    assert.match(notes, /document\.addEventListener\("zentral-triple-settled", cb\)/, "Notes measures its band again when the pages settle");
    assert.match(notes, /document\.removeEventListener\("zentral-triple-settled", cb\)/, "and lets go of it");
  });

  console.log(`\n${passed} passed`);
})().catch((error) => { console.error(error); process.exit(1); });

function t_mode(t) { return t.html.getAttribute("bgalazka-triple-view"); }
