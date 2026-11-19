"use strict";
/* F0.11: what two windows of one application share, on every platform.
 * Firefox keeps a hidden window on macOS only, and CustomizableUI is a frozen module object. Both facts are modelled by
 * tests/helpers/fake-panel-window.cjs: `Services.appShell.hiddenDOMWindow` throws and the fake CustomizableUI is frozen.
 * Each window runs its own copy of the real Notes source and of the calendar part.
 * Covers: one alert claim per stage across windows, note saves of two windows one after the other (the later one sees
 * the earlier one and keeps it in recovery), a window that died while it held a turn, a window with nothing shared,
 * and the single toolbar widget (created once, handed over when its window closes, removed with the last window).
 * This does NOT prove Gecko's module global, real window teardown or the real CustomizableUI. */
const assert = require("node:assert/strict");
const { createPanelWorld, DIR } = require("./helpers/fake-panel-window.cjs");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("ok -", name); }
const sharedGlobal = () => ({ Map, Object });
// One occurrence at a fixed time: two claims are the same alert only when their start is the same.
const AT = Date.UTC(2026, 10, 20, 9, 0);
const entry = (stage = "due") => ({ itemId: "item", occurrenceId: "occ", stage, start: { dateTime: new Date(AT).toISOString() }, at: AT });
const onDisk = (world, text) => [...world.disk.entries()].filter(([, v]) => typeof v === "string" && v.includes(text)).map(([k]) => k.slice(DIR.length + 1));
async function twoWindows(world) {
  const a = world.openWindow({ id: "a" }), b = world.openWindow({ id: "b" });
  a.start(); b.start();
  await a.seam.ensureStore(); await b.seam.ensureStore();
  return { a, b };
}

(async () => {
  await test("pure: a turn waits for the one before it; with a limit it stops waiting for a holder that never finishes", async () => {
    const registry = new Map(), order = [];
    const lock = C.createHistoryCoordinator(registry);
    let finishFirst;
    const first = lock("k", () => new Promise((r) => { finishFirst = () => { order.push("first done"); r(1); }; }));
    const second = lock("k", async () => { order.push("second runs"); return 2; });
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(order, [], "no limit: the second turn waits for as long as the first takes");
    finishFirst();
    assert.deepEqual(await Promise.all([first, second]), [1, 2]);
    assert.deepEqual(order, ["first done", "second runs"]);
    assert.equal(registry.size, 0, "nothing is kept once the last turn has finished");

    // A holder that never finishes (its window is gone): the next turn starts after the limit, later turns are not delayed.
    const timers = [];
    const timedOut = [];
    const limited = C.createHistoryCoordinator(registry, {
      waitMs: 500, onTimeout: (key) => timedOut.push(key),
      setTimer: (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length; }, clearTimer: (id) => { if (timers[id - 1]) timers[id - 1].live = false; },
    });
    limited("k", () => new Promise(() => {}));
    const next = limited("k", async () => "ran");
    let settled = false; next.then(() => { settled = true; });
    await new Promise((r) => setImmediate(r));
    assert.equal(settled, false, "it waits first");
    assert.deepEqual(timers.filter((t) => t.live).map((t) => t.ms), [500]);
    timers.find((t) => t.live).fn();
    assert.equal(await next, "ran");
    assert.deepEqual(timedOut, ["k"], "the caller is told that it stopped waiting");
    assert.equal(await limited("k", async () => "again"), "again", "the turn after it waits for a live holder only");
    // A holder that finishes in time cancels the timer.
    timers.length = 0;
    let finish; const live = limited("j", () => new Promise((r) => (finish = r)));
    const after = limited("j", async () => "after");
    await new Promise((r) => setImmediate(r));
    finish(); await live; assert.equal(await after, "after");
    assert.equal(timers.filter((t) => t.live).length, 0, "no timer is left behind");
    assert.equal(registry.has("j"), false);
  });

  // A gate that can no longer be touched (a dead object: every access throws "can't access dead object"). Fake windows
  // cannot die, so the object is modelled: a proxy that throws on any access (optionally only after `kill()`).
  const deadGate = (promise = null) => {
    let dead = !promise;
    const proxy = new Proxy(promise || {}, {
      get(target, prop) {
        if (dead) throw new TypeError("can't access dead object");
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
      has() { if (dead) throw new TypeError("can't access dead object"); return false; },
    });
    return { proxy, kill: () => { dead = true; } };
  };
  const fakeTimers = () => {
    const timers = [];
    return { timers, live: () => timers.filter((t) => t.live).map((t) => t.ms),
      fire: (ms) => { const t = timers.find((x) => x.live && x.ms === ms); assert.ok(t, "a live timer of " + ms + " ms"); t.live = false; t.fn(); },
      setTimer: (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length; },
      clearTimer: (id) => { if (timers[id - 1]) timers[id - 1].live = false; } };
  };

  await test("pure: a closed window is never waited for; its unfinished turn is skipped at once, or within a second when the wait had begun", async () => {
    const registry = new Map(), clock = fakeTimers(), timedOut = [];
    const options = { waitMs: 8000, setTimer: clock.setTimer, clearTimer: clock.clearTimer, onTimeout: (key) => timedOut.push(key) };
    let aOpen = true;
    const windowA = C.createHistoryCoordinator(registry, { ...options, isAlive: () => aOpen });
    const windowB = C.createHistoryCoordinator(registry, { ...options, isAlive: () => true });
    // Window A is in the middle of reading the folder; window B queues behind it with the long start-up limit.
    windowA("startup:/notes", () => new Promise(() => {}));
    let loaded = false;
    const second = windowB("startup:/notes", async () => { loaded = true; return "loaded"; }, { waitMs: 120000 });
    await new Promise((r) => setImmediate(r));
    clock.fire(1000); await new Promise((r) => setImmediate(r));
    assert.equal(loaded, false, "window A is open and busy: wait");
    aOpen = false; // window A is closed; the browser never runs the rest of its turn
    clock.fire(1000);
    assert.equal(await second, "loaded", "one second, not two minutes");
    assert.deepEqual(clock.live(), [], "the long timer is cancelled");
    // A turn that finds the unfinished turn of a closed window does not wait at all (the save window A began at its
    // own closing is such a turn).
    windowA("note:/a.md", () => new Promise(() => {}));
    await new Promise((r) => setImmediate(r));
    assert.equal(await windowB("note:/a.md", async () => "saved"), "saved");
    assert.deepEqual(clock.live(), []);
    assert.deepEqual(timedOut, [], "neither was a time-out");
    // The same without timers (a coordinator nobody gave a clock).
    const plainA = C.createHistoryCoordinator(registry, { isAlive: () => false }), plainB = C.createHistoryCoordinator(registry);
    plainA("k", () => new Promise(() => {}));
    assert.equal(await plainB("k", async () => "ran"), "ran");
    // A window that is open and slow is still waited for: only the limit ends that wait.
    const slow = C.createHistoryCoordinator(registry, { ...options, isAlive: () => true });
    slow("slow", () => new Promise(() => {}));
    let late = false; windowB("slow", async () => { late = true; });
    await new Promise((r) => setImmediate(r));
    clock.fire(1000); clock.fire(1000); await new Promise((r) => setImmediate(r));
    assert.equal(late, false);
    clock.fire(8000); await new Promise((r) => setImmediate(r));
    assert.equal(late, true);
    assert.deepEqual(timedOut, ["slow"]);
  });

  await test("pure: a gate that cannot be touched any more counts as released; the work runs at once, nothing is reported", async () => {
    for (const mode of ["no limit", "limit"]) {
      const registry = new Map(), clock = fakeTimers(), timedOut = [];
      const lock = mode === "limit"
        ? C.createHistoryCoordinator(registry, { waitMs: 8000, setTimer: clock.setTimer, clearTimer: clock.clearTimer, onTimeout: (key) => timedOut.push(key) })
        : C.createHistoryCoordinator(registry);
      registry.set("note:/n.md", deadGate().proxy); // left behind by a window that was closed in the middle of its save
      let ran = 0;
      assert.equal(await lock("note:/n.md", async () => { ran++; return "saved"; }), "saved", mode + ": the save is not lost");
      assert.equal(ran, 1);
      assert.deepEqual(clock.live(), [], mode + ": no timer is left armed");
      assert.deepEqual(timedOut, [], mode + ": this is not a time-out");
      assert.equal(registry.size, 0, mode + ": the dead gate is gone, later turns see a clean key");
      assert.equal(await lock("note:/n.md", async () => "again"), "again");
    }
  });

  await test("pure: a gate that stops being touchable while another turn waits for it is noticed within a second", async () => {
    const registry = new Map(), clock = fakeTimers(), timedOut = [];
    const lock = C.createHistoryCoordinator(registry, { waitMs: 8000, setTimer: clock.setTimer, clearTimer: clock.clearTimer, onTimeout: (key) => timedOut.push(key) });
    const owner = deadGate(new Promise(() => {})); // alive and busy
    registry.set("k", owner.proxy);
    let done = false;
    const turn = lock("k", async () => "ran").then((v) => { done = true; return v; });
    await new Promise((r) => setImmediate(r));
    assert.equal(done, false, "the holder is alive: wait");
    assert.deepEqual(clock.live().sort((a, b) => a - b), [1000, 8000], "the limit, and one look per second");
    clock.fire(1000); await new Promise((r) => setImmediate(r));
    assert.equal(done, false, "still alive after a second: keep waiting");
    assert.deepEqual(clock.live().sort((a, b) => a - b), [1000, 8000]);
    owner.kill(); // its window is closed now
    clock.fire(1000);
    assert.equal(await turn, "ran");
    assert.deepEqual(clock.live(), [], "both timers are cancelled");
    assert.deepEqual(timedOut, [], "noticed, not timed out");
    // A short limit does not need the extra look.
    const quick = C.createHistoryCoordinator(new Map([["q", new Promise(() => {})]]), { waitMs: 500, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    quick("q", async () => 1); await new Promise((r) => setImmediate(r));
    assert.deepEqual(clock.live(), [500]);
  });

  await test("pure: one call can wait longer than the others (reading a whole folder at start-up)", async () => {
    const registry = new Map(), clock = fakeTimers(), timedOut = [];
    const lock = C.createHistoryCoordinator(registry, { waitMs: 8000, setTimer: clock.setTimer, clearTimer: clock.clearTimer, onTimeout: (key) => timedOut.push(key) });
    lock("startup:/notes", () => new Promise(() => {}));
    const second = lock("startup:/notes", async () => "loaded", { waitMs: 120000 });
    lock("note:/a.md", () => new Promise(() => {}));
    const save = lock("note:/a.md", async () => "saved");
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(clock.live().filter((ms) => ms !== 1000).sort((a, b) => a - b), [8000, 120000], "each call waits for its own limit");
    clock.fire(8000);
    assert.equal(await save, "saved");
    let loaded = false; second.then(() => { loaded = true; });
    await new Promise((r) => setImmediate(r));
    assert.equal(loaded, false, "the start-up turn is still waiting after the ordinary limit");
    clock.fire(120000);
    assert.equal(await second, "loaded");
    assert.deepEqual(timedOut, ["note:/a.md", "startup:/notes"]);
  });

  await test("no hidden window: two windows claim one alert stage once, through the global the system modules share", async () => {
    const home = sharedGlobal(), world = createPanelWorld({ sharedGlobal: home });
    const { a, b } = await twoWindows(world);
    const claims = await Promise.all([a.seam.store.items.history.claimAlert(entry()), b.seam.store.items.history.claimAlert(entry())]);
    assert.equal(claims.filter(Boolean).length, 1, "exactly one window shows the alert");
    assert.ok(home.__zentralNotesHistoryLocksV1 instanceof Map, "the turns live on the shared global");
    assert.equal(home.__zentralNotesHistoryLocksV1.size, 0, "and nothing stays there afterwards");
    assert.ok(await b.seam.store.items.history.claimAlert(entry("followup")), "a later stage is still free");
    assert.deepEqual(world.warnings, []);
    await a.close(); await b.close();
  });

  await test("two windows save the same note: the later save sees the earlier one and keeps it in recovery", async () => {
    const world = createPanelWorld({ sharedGlobal: sharedGlobal() });
    const { a, b } = await twoWindows(world);
    const note = a.seam.store.create("# Shared\nfirst text\n");
    await a.seam.store.flush();
    b.seam.store.onRemoteMessage(JSON.stringify({ origin: "a-window", id: note.id }));
    await world.settle();
    assert.match(b.seam.store.get(note.id).body, /first text/);
    const conflicts = [];
    a.seam.store.on((e) => { if (e.type === "conflict") conflicts.push("a"); });
    b.seam.store.on((e) => { if (e.type === "conflict") conflicts.push("b"); });
    a.seam.store.update(note.id, "# Shared\nwritten in window A\n");
    b.seam.store.update(note.id, "# Shared\nwritten in window B\n");
    // Window A is in the middle of its save when window B starts its own.
    const release = world.hold((op, p, id) => id === "a" && op === "write" && p.endsWith("/" + note.id + ".md"));
    const savedA = a.seam.store.flush(); await world.settle();
    const savedB = b.seam.store.flush(); await world.settle();
    release(); await savedA; await savedB; await world.settle();
    const text = world.disk.get(DIR + "/" + note.id + ".md");
    assert.match(text, /written in window B/, "the later save is the file");
    assert.ok(conflicts.includes("b"), "the later writer noticed the save that happened in between");
    const kept = onDisk(world, "written in window A").filter((p) => p.startsWith("backup/"));
    assert.ok(kept.length >= 1, "the displaced text is in the recovery area, not lost");
    await a.close(); await b.close();
  });

  await test("a window that died in the middle of a save delays the next save for a bounded time only", async () => {
    const world = createPanelWorld({ sharedGlobal: sharedGlobal() });
    const { a, b } = await twoWindows(world);
    assert.ok(a.core.SHARED_TURN_WAIT_MS >= 2000 && a.core.SHARED_TURN_WAIT_MS <= 30000, "the limit is a few seconds");
    const note = a.seam.store.create("# Stuck\nfirst\n");
    await a.seam.store.flush();
    b.seam.store.onRemoteMessage(JSON.stringify({ origin: "a-window", id: note.id }));
    await world.settle();
    a.seam.store.update(note.id, "# Stuck\nnever lands\n");
    world.hold((op, p, id) => id === "a" && op === "write" && p.endsWith("/" + note.id + ".md")); // never released
    a.seam.store.flush().catch(() => {});
    await world.settle();
    b.seam.store.update(note.id, "# Stuck\nfrom the window that is still alive\n");
    let done = false;
    const saved = b.seam.store.flush().then(() => { done = true; });
    await world.settle();
    assert.equal(done, false, "it waits for the other window first");
    await world.advance(a.core.SHARED_TURN_WAIT_MS + 50);
    await saved;
    assert.match(world.disk.get(DIR + "/" + note.id + ".md"), /still alive/, "then it saves on its own");
    b.seam.store.update(note.id, "# Stuck\nsecond save\n");
    let again = false;
    b.seam.store.flush().then(() => { again = true; });
    await world.settle(); await world.settle();
    assert.equal(again, true, "the save after that is not delayed again");
    assert.ok(world.warnings.some((w) => w.window === "b" && /another window/i.test(w.text)), "the wait that was given up is reported once");
    await b.close();
  });

  await test("nothing shared (no module global, no hidden window): each window still works on its own", async () => {
    const world = createPanelWorld();
    const { a, b } = await twoWindows(world);
    const note = a.seam.store.create("# Alone\ntext\n");
    await a.seam.store.flush();
    assert.match(world.disk.get(DIR + "/" + note.id + ".md"), /text/);
    assert.ok(await a.seam.store.items.history.claimAlert(entry()), "a claim works without any shared object");
    assert.deepEqual(world.warnings, []);
    await a.close(); await b.close();
  });

  await test("macOS: without the module global the hidden window carries the turns, as before", async () => {
    const hidden = { Map }, world = createPanelWorld({ hiddenWindow: hidden });
    const { a, b } = await twoWindows(world);
    const claims = await Promise.all([a.seam.store.items.history.claimAlert(entry()), b.seam.store.items.history.claimAlert(entry())]);
    assert.equal(claims.filter(Boolean).length, 1);
    assert.ok(hidden.__zentralNotesHistoryLocksV1 instanceof Map);
    await a.close(); await b.close();
  });

  await test("both exist: every window picks the module global, so two windows can never use different places", async () => {
    const home = sharedGlobal(), hidden = { Map }, world = createPanelWorld({ sharedGlobal: home, hiddenWindow: hidden });
    const { a, b } = await twoWindows(world);
    await Promise.all([a.seam.store.items.history.claimAlert(entry()), b.seam.store.items.history.claimAlert(entry())]);
    assert.ok(home.__zentralNotesHistoryLocksV1 instanceof Map);
    assert.equal(hidden.__zentralNotesHistoryLocksV1, undefined);
    await a.close(); await b.close();
  });

  await test("toolbar widget: registered once although CustomizableUI is frozen; a second window leaves it alone", async () => {
    const world = createPanelWorld({ sharedGlobal: sharedGlobal() });
    assert.ok(Object.isFrozen(world.cui), "like the real module object");
    const a = world.openWindow({ id: "a" }); a.start();
    assert.deepEqual(world.cuiLog, ["create", "place:a"], "created and put where the person placed it, in every open window");
    const b = world.openWindow({ id: "b" }); b.start();
    assert.deepEqual(world.cuiLog, ["create", "place:a"], "the second window neither removes nor re-creates the widget");
    assert.deepEqual(world.warnings, [], "no error about a property that cannot be added");
    // The widget's command reaches the window that was clicked.
    let toggledB = 0; const real = b.win.__zentralNotesToggle; b.win.__zentralNotesToggle = () => { toggledB++; };
    world.widgets.get([...world.widgets.keys()][0]).onCommand({ target: { ownerGlobal: b.win } });
    assert.equal(toggledB, 1);
    b.win.__zentralNotesToggle = real;

    // Its callbacks belong to window a: when that window closes, the next window registers it again.
    await a.close();
    assert.deepEqual(world.cuiLog, ["create", "place:a", "destroy", "create", "place:b"]);
    assert.equal(world.widgets.size, 1);
    await b.close();
    assert.deepEqual(world.cuiLog.slice(-1), ["destroy"], "it goes with the last window that runs Notes");
    assert.equal(world.widgets.size, 0);
  });

  await test("toolbar widget: switching Notes off removes it once, switching it on brings one back", async () => {
    const world = createPanelWorld({ sharedGlobal: sharedGlobal() });
    const a = world.openWindow({ id: "a" }), b = world.openWindow({ id: "b" });
    a.start(); b.start();
    const P = "zen.workspace.zentral.notes.enabled";
    const tell = () => { for (const w of [a, b]) w.prefObservers.slice().forEach((o) => o.observe(null, "nsPref:changed", P)); };
    world.prefs.set(P, false); tell();
    assert.equal(world.widgets.size, 0);
    assert.deepEqual(world.cuiLog, ["create", "place:a", "place:b", "destroy"]);
    world.prefs.set(P, true); tell();
    assert.equal(world.widgets.size, 1);
    assert.equal(world.cuiLog.filter((x) => x === "create").length, 2, "one registration, not one per window");
    assert.deepEqual(world.warnings, []);
    await a.close(); await b.close();
    assert.equal(world.widgets.size, 0);
  });

  console.log(`\n${passed} shared-window tests passed`);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
