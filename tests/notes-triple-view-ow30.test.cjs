"use strict";
/* OW-30: Triple View start-up works without the optional ZentralStartup mod, and Notes remembers its height
 * (both px and share) across restarts for Triple View, docked panels, and the standalone card. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createPanelWorld, noteText, DIR } = require("./helpers/fake-panel-window.cjs");
const { openTripleWindow } = require("./helpers/fake-triple-view.cjs");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("ok -", name);
}

const STARTUP = "zen.workspace.bgalazka.open_at_startup";
const REPO = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
const cssPx = (el, name) => parseFloat(el.style.getPropertyValue(name)) || 0;
const round = (v) => Math.round(v * 10) / 10;

async function dragGapEdge(t, world, edge, dy) {
  const sheet = t.rect(t.parts().sheet);
  const x = sheet.left + sheet.width / 2;
  const y = edge === "n" ? sheet.top + 3 : sheet.bottom - 3;
  t.pointer.down(x, y, 31);
  for (let i = 1; i <= 4; i++) {
    t.pointer.move(x, y + (dy * i) / 4, 31);
    await world.advance(20);
  }
  t.pointer.up(x, y + dy, 31);
  await world.advance(800);
}

(async () => {
  const probeWorld = createPanelWorld({ sharedGlobal: { Map, Object } });
  const probe = probeWorld.openWindow({ id: "probe" });
  const core = probe.core;

  // =========================================================================
  // 1. Pure height & startup-pref functions
  // =========================================================================
  await test("pure helpers: resolveSlotHeight combines exact px on matching viewport and proportional share on resized viewport", async () => {
    assert.equal(typeof core.resolveSlotHeight, "function", "resolveSlotHeight exported");
    assert.equal(typeof core.cleanSlotPx, "function", "cleanSlotPx exported");
    assert.equal(typeof core.hasStartupPanelPref, "function", "hasStartupPanelPref exported");

    // Same / similar panel height -> exact saved px preserved (no rounding drift).
    assert.equal(
      core.resolveSlotHeight({ size: "peek", pref: 45, share: 0.34, px: 261, base: 766, room: 766, between: true }),
      261,
      "same viewport restores exact px height",
    );
    assert.equal(
      core.resolveSlotHeight({ size: "peek", pref: 45, share: 0.34, px: 261, base: 750, room: 750, between: true }),
      261,
      "slightly different chrome height still restores exact px height",
    );
    // Substantially resized window -> falls back to proportional share.
    assert.equal(
      core.resolveSlotHeight({ size: "peek", pref: 45, share: 0.34, px: 261, base: 460, room: 460, between: true }),
      156,
      "much shorter window adapts proportionally via saved share",
    );
    // Legacy share-only meta (px = 0) behaves identically to slotPx.
    assert.equal(
      core.resolveSlotHeight({ size: "peek", pref: 45, share: 0.32, px: 0, base: 766, room: 766, between: true }),
      245,
      "legacy share-only meta matches slotPx",
    );
    // px-only meta (share = 0) restores exact clamped px.
    assert.equal(
      core.resolveSlotHeight({ size: "peek", pref: 45, share: 0, px: 290, base: 766, room: 766, between: true }),
      290,
      "px-only meta restores exact px",
    );
    // Gap floor still caps tall remembered px on a short panel.
    assert.equal(
      core.resolveSlotHeight({ size: "peek", pref: 45, share: 0.85, px: 500, base: 520, room: 480, between: true }),
      240,
      "between-panels floor caps height so both pages keep 120 px",
    );
    // Larger ("full") and span ("span") are never overridden by peek px.
    assert.equal(
      core.resolveSlotHeight({ size: "full", pref: 45, share: 0.34, px: 261, base: 766, room: 766, between: false }),
      613,
      "full size still uses SLOT_LARGE_SHARE",
    );
    assert.equal(
      core.resolveSlotHeight({ size: "span", pref: 45, share: 0.34, px: 261, base: 766, room: 766, between: true }),
      0,
      "span size reserves no slot",
    );

    // hasStartupPanelPref validates without touching ZentralStartup.
    assert.equal(core.hasStartupPanelPref(JSON.stringify({ id: "mail", mode: "triple" })), true);
    assert.equal(core.hasStartupPanelPref(JSON.stringify({ id: "mail", mode: "single" })), true);
    assert.equal(core.hasStartupPanelPref("true"), true, "legacy truthy value accepted");
    assert.equal(core.hasStartupPanelPref("null"), false);
    assert.equal(core.hasStartupPanelPref(""), false);
    assert.equal(core.hasStartupPanelPref("false"), false);
    assert.equal(core.hasStartupPanelPref("{bad"), false);
    assert.equal(core.hasStartupPanelPref(JSON.stringify({ id: "", mode: "triple" })), false);
  });

  await test("pure helpers: resolveCardHeight combines exact px and proportional share for the standalone card", async () => {
    assert.equal(typeof core.resolveCardHeight, "function", "resolveCardHeight exported");
    assert.equal(
      core.resolveCardHeight({ px: 472, share: 0.524, areaH: 900, fallbackH: 550 }),
      472,
      "same viewport restores exact standalone card px height",
    );
    assert.equal(
      core.resolveCardHeight({ px: 472, share: 0.524, areaH: 520, fallbackH: 400 }),
      272,
      "substantially smaller viewport adapts proportionally via cardHShare",
    );
    assert.equal(
      core.resolveCardHeight({ px: 0, share: 0.6, areaH: 800, fallbackH: 400 }),
      480,
      "share-only card height scales cleanly",
    );
    assert.equal(
      core.resolveCardHeight({ px: 0, share: 0, areaH: 800, fallbackH: 410 }),
      410,
      "unset height uses fallback",
    );
    assert.equal(
      core.resolveCardHeight({ px: 90, share: 0.1, areaH: 800, fallbackH: 410 }),
      410,
      "out-of-range px/share ignored safely",
    );
  });

  // =========================================================================
  // 2. Loader contract: readStartupPanel & whenNativeReady work without ZentralStartup
  // =========================================================================
  await test("loader/ZentralRuntime.js and ZentralStandaloneShim.js expose and run startup-panel readiness without ZentralStartup", async () => {
    const rtSrc = read("loader/ZentralRuntime.js");
    const shimSrc = read("loader/standalone/ZentralStandaloneShim.js");
    const runLoader = (src, label, isShim = false) => {
      const prefMap = new Map();
      let resolveInit;
      const initPromise = new Promise((r) => { resolveInit = r; });
      const win = {
        document: {
          documentElement: {
            style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => "" },
            getAttribute() { return null; },
            hasAttribute() { return false; },
            setAttribute() {},
            removeAttribute() {},
            toggleAttribute() {},
            addEventListener() {},
            removeEventListener() {},
          },
          getElementById() { return null; },
          querySelector() { return null; },
        },
        gZenWorkspaces: { promiseInitialized: initPromise },
        ZentralModuleLoader: {
          rootURI: "file:///zentral/",
          load() { return false; },
          loadPart() { return false; },
          create() { return { MANIFEST: [], CSS_MANIFEST: [], settingsSupport: false }; },
        },
        addEventListener() {},
        removeEventListener() {},
        setTimeout: (fn) => { fn(); return 1; },
        clearTimeout() {},
      };
      win.window = win;
      const Services = {
        prefs: {
          getPrefType: (k) => (prefMap.has(k) ? 32 : 0),
          getStringPref: (k, d) => (prefMap.has(k) ? prefMap.get(k) : d),
          getBoolPref: (k, d) => (prefMap.has(k) ? !!prefMap.get(k) : d),
          getIntPref: (k, d) => (prefMap.has(k) ? Number(prefMap.get(k)) : d),
          setStringPref: (k, v) => prefMap.set(k, String(v)),
          addObserver() {},
          removeObserver() {},
        },
        io: {
          newURI: (spec, _c, base) => {
            let href = String(spec);
            try { href = new URL(String(spec), base?.spec).href; } catch (_) {}
            return { spec: href, scheme: href.split(":")[0] };
          },
        },
        obs: { addObserver() {}, removeObserver() {} },
        scriptloader: { loadSubScript() {} },
      };
      const Components = { classes: {}, interfaces: {}, utils: { getGlobalForObject: () => ({}) } };
      const ctx = { window: win, document: win.document, Services, Components, console, Promise, JSON, Map, Set, Object, Array, String, Number, Math, Date, URL, setTimeout: win.setTimeout, clearTimeout: win.clearTimeout };
      ctx.globalThis = ctx;
      const wrapped = isShim
        ? `const nativeSidebarElement=()=>null,nativeSidebarRect=()=>null,nativeSidebarSide=()=>"left",createSidebarHoverCard=()=>({}),createFeatureScope=()=>({});\n${src}\nwindow.ZentralRuntime = __zentralShim;`
        : src;
      vm.runInNewContext(wrapped, ctx, { filename: label });
      return { rt: win.ZentralRuntime, prefMap, resolveInit };
    };

    for (const [src, label, isShim] of [[rtSrc, "ZentralRuntime.js", false], [shimSrc, "ZentralStandaloneShim.js", true]]) {
      const { rt, prefMap, resolveInit } = runLoader(src, label, isShim);
      assert.equal(typeof rt.readStartupPanel, "function", `${label} exposes readStartupPanel`);
      assert.equal(typeof rt.whenNativeReady, "function", `${label} exposes whenNativeReady`);

      // readStartupPanel parses triple & single prefs and rejects garbage cleanly.
      assert.equal(rt.readStartupPanel(), null, `${label}: empty pref -> null`);
      prefMap.set(STARTUP, JSON.stringify({ id: "mail", mode: "triple" }));
      assert.deepEqual({ ...rt.readStartupPanel() }, { id: "mail", mode: "triple" }, `${label}: parses triple startup pref`);
      prefMap.set(STARTUP, JSON.stringify({ id: "mail", mode: "single" }));
      assert.deepEqual({ ...rt.readStartupPanel() }, { id: "mail", mode: "single" }, `${label}: parses single startup pref`);
      prefMap.set(STARTUP, JSON.stringify({ id: "mail", mode: "other" }));
      assert.equal(rt.readStartupPanel(), null, `${label}: rejects invalid mode`);
      prefMap.set(STARTUP, "{bad");
      assert.equal(rt.readStartupPanel(), null, `${label}: rejects malformed JSON`);

      // whenNativeReady waits for nativeReady and respects cancellation.
      let ranA = 0, ranB = 0;
      rt.whenNativeReady(() => { ranA++; });
      const cancelB = rt.whenNativeReady(() => { ranB++; });
      cancelB();
      assert.equal(ranA, 0, `${label}: callback waits for native readiness`);
      resolveInit();
      for (let i = 0; i < 10; i++) await Promise.resolve();
      assert.equal(ranA, 1, `${label}: active callback runs once nativeReady resolves`);
      assert.equal(ranB, 0, `${label}: cancelled callback does not run`);
    }

    // Full-pack coordination contract: ZentralPanels & ZentralCornerPanels do not depend on ZentralStartup.
    const panelsSrc = read("extension/panels/ZentralPanels.uc.js");
    const cornerSrc = read("extension/panels/corner-tiles/ZentralCornerPanels.uc.js");
    assert.match(panelsSrc, /openStartupTriplePair/, "ZentralPanels uses ctx.openStartupTriplePair");
    assert.match(panelsSrc, /startupPanelCoordinator/, "ZentralPanels coordinates ownership with ZentralSecondaryViews");
    assert.match(panelsSrc, /whenNativeReady/, "ZentralPanels schedules startup restore via ZentralRuntime.whenNativeReady");
    assert.match(panelsSrc, /syncCornerTiles/, "ZentralPanels syncs corner tiles before startup restore");
    assert.match(cornerSrc, /linkedPairFor/, "ZentralCornerPanels recovers sleeping Essential tab URLs from linkedPairFor");
  });

  // =========================================================================
  // 3. Self-sufficient ZentralSecondaryViews start-up WITHOUT ZentralStartup
  //    (sleeping Essential tabs, no ZentralStartup mod, no ZentralPanels startup loop)
  // =========================================================================
  await test("ZentralSecondaryViews restores a linked Triple View pair at launch without ZentralStartup (even for sleeping Essential tabs) and auto-opens Notes", async () => {
    const world = createPanelWorld({ sharedGlobal: { Map, Object } });
    world.disk.set(DIR + "/n1.md", noteText("Saved note"));
    world.disk.set(DIR + "/meta.json", JSON.stringify({ openIn: "triple", shareGap: 0.34, gapPx: 262, folders: [] }));
    // Explicitly disable ZentralStartup prefs — Startup mod is absent / off.
    world.prefs.set("zen.workspace.zentral.modules.startup.enabled", false);
    world.prefs.set("zen.workspace.zentral.startup.enabled", false);
    world.prefs.set(STARTUP, JSON.stringify({ id: "bgalazka-essential-100-1", mode: "triple" }));

    // Build a window whose ZentralRuntime exposes whenNativeReady + readStartupPanel,
    // without loading ZentralStartup at all.
    let resolveReady;
    const nativeReady = new Promise((r) => { resolveReady = r; });
    const t = openTripleWindow(world);
    // Install sleeping Essential pair (NOT in essentialPanels, NOT in sidebar.apps, only in linkedTriplePairs!).
    const essTop = "bgalazka-essential-100-1", essBot = "bgalazka-essential-100-2";
    const pair = {
      top: essTop,
      bottom: essBot,
      share: 0.5,
      apps: {
        [essTop]: { id: essTop, url: "https://mail.example.test/", title: "Mail" },
        [essBot]: { id: essBot, url: "https://chat.example.test/", title: "Chat" },
      },
    };
    t.ctx.linkedTriplePairs.push(pair);
    world.prefs.set("zen.workspace.apps.sidebar.apps", "[]");

    assert.equal(typeof t.ctx.openStartupTriplePair, "function", "ZentralSecondaryViews exports ctx.openStartupTriplePair");
    assert.equal(typeof t.ctx.openStartupSinglePanel, "function", "ZentralSecondaryViews exports ctx.openStartupSinglePanel");

    // Start Notes, then trigger self-sufficient Triple View startup via openStartupTriplePair (without ZentralStartup).
    t.w.start();
    await world.advance(200);
    const opened = t.ctx.openStartupTriplePair(essTop);
    assert.equal(opened, true, "openStartupTriplePair opens linked Essential pair even while tabs sleep");
    assert.equal(t.html.getAttribute("bgalazka-triple-view"), "true", "entered Triple View");
    // Sleeping Essential tabs must NOT be erroneously copied into normal sidebar.apps!
    assert.deepEqual(JSON.parse(world.prefs.get("zen.workspace.apps.sidebar.apps") || "[]"), [], "sleeping Essential tabs were not duplicated into sidebar.apps");

    await world.advance(1000);
    const p = t.parts();
    assert.ok(p.sheet && !p.sheet.hidden, "Notes auto-opened into Triple View without ZentralStartup");
    assert.equal(p.sheet.dataset.slot, "gap", "Notes is in the gap between panels");
    assert.equal(cssPx(t.html, "--zentral-notes-gap"), 262, "exact saved gapPx (262) restored at launch");

    // Verify recreateLoadedPanels also handles sleeping Essential pair browsers without ZentralStartup.
    t.ctx.recreateLoadedPanels([essTop, essBot]);
    await world.advance(200);
    assert.equal(t.html.getAttribute("bgalazka-triple-view"), "true", "recreateLoadedPanels preserves Triple View for Essential pair without ZentralStartup");

    resolveReady();
    await nativeReady;
    t.stop();
    await t.w.close();
  });

  await test("self-sufficient ZentralSecondaryViews auto-restores on ZentralRuntime.whenNativeReady without ZentralPanels or ZentralStartup", async () => {
    const world = createPanelWorld({ sharedGlobal: { Map, Object } });
    world.disk.set(DIR + "/n1.md", noteText("Auto note"));
    world.disk.set(DIR + "/meta.json", JSON.stringify({ openIn: "triple", shareGap: 0.36, gapPx: 276, folders: [] }));
    world.prefs.set("zen.workspace.zentral.modules.startup.enabled", false);
    world.prefs.set("zen.workspace.zentral.startup.enabled", false);
    world.prefs.set(STARTUP, JSON.stringify({ id: "mail", mode: "triple" }));

    // Provide a deferred nativeReady hook on ZentralRuntime BEFORE SecondaryViews activates.
    let resolveNative;
    const readyPromise = new Promise((r) => { resolveNative = r; });
    const t = openTripleWindow(world, {
      onRuntime(rt, ctx) {
        ctx.linkedTriplePairs.push({
          top: "mail",
          bottom: "chat",
          share: 0.5,
          apps: {
            mail: { id: "mail", url: "https://mail.test/" },
            chat: { id: "chat", url: "https://chat.test/" },
          },
        });
        world.prefs.set("zen.workspace.apps.sidebar.apps", JSON.stringify([
          { id: "mail", url: "https://mail.test/" },
          { id: "chat", url: "https://chat.test/" },
        ]));
        rt.readStartupPanel = () => {
          try { return JSON.parse(world.prefs.get(STARTUP) || "null"); } catch (_) { return null; }
        };
        rt.whenNativeReady = (fn) => {
          let cancelled = false;
          readyPromise.then(() => { if (!cancelled) fn(); });
          return () => { cancelled = true; };
        };
      },
    });
    t.w.start();
    await world.advance(200);
    assert.equal(t.root.hasAttribute("open"), false, "waits for nativeReady before opening Triple View");

    // nativeReady resolves — SecondaryViews restores Triple View all by itself (no ZentralStartup, no manual openApp)!
    resolveNative();
    await world.advance(1000);
    assert.equal(t.root.hasAttribute("open"), true, "Triple View opened automatically after nativeReady");
    assert.equal(t.html.getAttribute("bgalazka-triple-view"), "true", "Triple View active");
    assert.equal(world.prefs.get("zen.workspace.bgalazka.hover_reveal_panel"), true, "autohide forced on for startup panel");
    const p = t.parts();
    assert.ok(p.sheet && !p.sheet.hidden, "Notes restored into Triple View");
    assert.equal(cssPx(t.html, "--zentral-notes-gap"), 276, "exact saved height restored on self-sufficient startup");

    t.stop();
    await t.w.close();
  });

  // =========================================================================
  // 4. End-to-end height persistence across a restart: Triple View (same & resized window)
  // =========================================================================
  await test("Triple View Notes height (px and share) survives a full restart, both on same-size and resized windows, and with cold disk", async () => {
    const world = createPanelWorld({ sharedGlobal: { Map, Object } });
    world.disk.set(DIR + "/n1.md", noteText("Height test"));
    world.disk.set(DIR + "/meta.json", JSON.stringify({ openIn: "triple", folders: [] }));
    world.prefs.set("zen.workspace.zentral.modules.startup.enabled", false);
    world.prefs.set(STARTUP, JSON.stringify({ id: "mail", mode: "triple" }));

    // --- Session 1: open Triple View + Notes, drag top edge down by 85 px to shrink Notes ---
    const t1 = openTripleWindow(world);
    t1.link("mail", "chat", 0.5);
    t1.w.start();
    await world.advance(300);
    t1.openApp("mail");
    await world.advance(1000);
    const startGap = cssPx(t1.html, "--zentral-notes-gap");
    assert.ok(startGap > 300, "starts near default 45% (" + startGap + ")");
    await dragGapEdge(t1, world, "n", 85);
    const draggedGap = cssPx(t1.html, "--zentral-notes-gap");
    assert.ok(Math.abs((startGap - draggedGap) - 85) <= 2, `drag shrunk gap by 85 px (${startGap} -> ${draggedGap})`);

    const meta1 = world.meta();
    assert.equal(meta1.gapPx, draggedGap, "exact gapPx saved to meta.json");
    assert.ok(meta1.shareGap > 0 && meta1.shareGap < 0.45, `shareGap saved to meta.json (${meta1.shareGap})`);

    t1.stop();
    await t1.w.close();

    // --- Session 2a: restart at same window height with slow disk (meta.json arrives late) ---
    const release = world.hold((op) => op === "makeDirectory" || op === "children" || op === "read");
    const t2 = openTripleWindow(world);
    t2.link("mail", "chat", 0.5);
    t2.w.start();
    await world.advance(300);
    t2.openApp("mail");
    await world.advance(500);
    release();
    await world.advance(1200);
    const restoredGap = cssPx(t2.html, "--zentral-notes-gap");
    assert.equal(restoredGap, draggedGap, `same-height restart restores exact px (${restoredGap} vs ${draggedGap})`);
    const sheet2 = t2.parts().sheet;
    assert.ok(Math.abs(t2.rect(sheet2).height - (draggedGap - 12)) <= 1.5, "sheet visual height matches exact restored gap");
    t2.stop();
    await t2.w.close();

    // --- Session 2b: restart with panel slid away (autohide) before notes load, then reveal ---
    const release3 = world.hold((op) => op === "makeDirectory" || op === "children" || op === "read");
    const t3 = openTripleWindow(world);
    t3.link("mail", "chat", 0.5);
    t3.autohide(true);
    t3.w.start();
    await world.advance(300);
    t3.openApp("mail");
    await world.advance(1200);
    t3.hide();
    await world.advance(400);
    release3();
    await world.advance(1200);
    t3.reveal();
    await world.advance(1000);
    assert.equal(cssPx(t3.html, "--zentral-notes-gap"), draggedGap, "panel reveal after cold startup restores exact gapPx");
    t3.stop();
    await t3.w.close();

    // --- Session 2c: restart on a much shorter window (height 500) -> proportional shareGap applies ---
    const t4 = openTripleWindow(world, { height: 500 });
    t4.link("mail", "chat", 0.5);
    t4.w.start();
    await world.advance(300);
    t4.openApp("mail");
    await world.advance(1200);
    const shortGap = cssPx(t4.html, "--zentral-notes-gap");
    assert.ok(shortGap < draggedGap, `shorter window scales down proportionally via shareGap (${shortGap} < ${draggedGap})`);
    assert.ok(shortGap >= 140, `still usable (${shortGap} px)`);
    assert.equal(world.meta().gapPx, draggedGap, "shorter launch does not overwrite user's saved gapPx");
    t4.stop();
    await t4.w.close();
  });

  // =========================================================================
  // 5. Standalone Notes ONLY (no panel suite, no ZentralStartup): card height survives restart
  // =========================================================================
  await test("standalone Notes only (no panel suite, no Startup mod): card height (px & share) survives restart and viewport resize", async () => {
    const world = createPanelWorld({ sharedGlobal: { Map, Object } });
    world.disk.set(DIR + "/n1.md", noteText("Standalone card"));
    world.prefs.set("zen.workspace.zentral.modules.startup.enabled", false);

    const pressToggle = (w) => {
      const ev = { type: "keydown", key: "N", code: "KeyN", altKey: true, shiftKey: true, ctrlKey: false, metaKey: false, repeat: false, defaultPrevented: false, target: w.html, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, stopImmediatePropagation() {} };
      for (const l of w.listeners.filter((x) => x.type === "keydown")) l.fn(ev);
    };

    // --- Session 1: open standalone card (no panel DOM at all), resize bottom edge ---
    const w1 = world.openWindow({ id: "card-1" });
    w1.win.innerWidth = 1280;
    w1.win.innerHeight = 900;
    w1.start();
    await world.advance(100);
    pressToggle(w1);
    await world.advance(500);
    const s1 = w1.openSheets()[0];
    assert.ok(s1, "standalone card opened without panel suite");
    assert.equal(s1.dataset.host, "float");

    const rect1 = {
      left: parseFloat(s1.style.left) || 0,
      top: parseFloat(s1.style.top) || 0,
      width: parseFloat(s1.style.width) || 460,
      height: parseFloat(s1.style.height) || 550,
    };
    s1.getBoundingClientRect = () => ({
      left: rect1.left, top: rect1.top, width: rect1.width, height: rect1.height,
      right: rect1.left + rect1.width, bottom: rect1.top + rect1.height, x: rect1.left, y: rect1.top,
    });
    const south = s1.querySelectorAll(".zn-rz").find((g) => g.getAttribute("data-h") === "s");
    assert.ok(south, "standalone card has bottom resize grip");
    const Ev = w1.Ev;
    south.dispatchEvent(new Ev("pointerdown", { bubbles: true, button: 0, clientX: rect1.left + 100, clientY: rect1.top + rect1.height, pointerId: 71 }));
    s1.dispatchEvent(new Ev("pointermove", { bubbles: true, clientX: rect1.left + 100, clientY: rect1.top + rect1.height - 140, pointerId: 71 }));
    await world.advance(50);
    s1.dispatchEvent(new Ev("pointerup", { bubbles: true, clientX: rect1.left + 100, clientY: rect1.top + rect1.height - 140, pointerId: 71 }));
    await world.advance(200);

    const resizedH = Math.round(parseFloat(s1.style.height));
    assert.ok(Math.abs((rect1.height - resizedH) - 140) <= 2, `card height shrunk by 140 px (${rect1.height} -> ${resizedH})`);
    const saved = world.meta();
    assert.equal(saved.cardH, resizedH, "standalone cardH (px) saved immediately on release");
    assert.ok(saved.cardHShare > 0.2 && saved.cardHShare < 0.9, `standalone cardHShare saved (${saved.cardHShare})`);
    await w1.close();

    // --- Session 2: restart on same 900 px viewport (slow disk!) -> exact px height restored ---
    const release = world.hold((op) => op === "makeDirectory" || op === "children" || op === "read");
    const w2 = world.openWindow({ id: "card-2" });
    w2.win.innerWidth = 1280;
    w2.win.innerHeight = 900;
    w2.start();
    pressToggle(w2);
    await world.advance(100);
    release();
    await world.advance(400);
    const s2 = w2.openSheets()[0];
    assert.equal(Math.round(parseFloat(s2.style.height)), resizedH, "same-size restart restores exact standalone card px height after store loads");
    await w2.close();

    // --- Session 3: restart on a smaller 560 px viewport -> proportional cardHShare restored ---
    const w3 = world.openWindow({ id: "card-3" });
    w3.win.innerWidth = 1280;
    w3.win.innerHeight = 560;
    w3.start();
    pressToggle(w3);
    await world.advance(400);
    const s3 = w3.openSheets()[0];
    const h3 = Math.round(parseFloat(s3.style.height));
    const expected3 = Math.round(560 * saved.cardHShare);
    assert.ok(Math.abs(h3 - expected3) <= 2, `resized viewport uses proportional cardHShare (${h3} vs ${expected3})`);
    await w3.close();
  });

  // =========================================================================
  // 6. Install shapes: with Startup mod vs without Startup mod; docked primary panel height
  // =========================================================================
  await test("both install shapes (with and without ZentralStartup) and docked primary panel height survive restart", async () => {
    for (const withStartupMod of [false, true]) {
      const world = createPanelWorld({ sharedGlobal: { Map, Object } });
      world.disk.set(DIR + "/n1.md", noteText("Shape " + withStartupMod));
      world.disk.set(DIR + "/meta.json", JSON.stringify({ openIn: "triple", shareGap: 0.35, gapPx: 268, folders: [] }));
      world.prefs.set("zen.workspace.zentral.modules.startup.enabled", withStartupMod);
      world.prefs.set("zen.workspace.zentral.startup.enabled", withStartupMod);
      world.prefs.set(STARTUP, JSON.stringify({ id: "mail", mode: "triple" }));

      let resolveNative;
      const ready = new Promise((r) => { resolveNative = r; });
      const t = openTripleWindow(world, {
        onRuntime(rt, ctx) {
          ctx.linkedTriplePairs.push({
            top: "mail",
            bottom: "chat",
            share: 0.5,
            apps: {
              mail: { id: "mail", url: "https://mail.test/" },
              chat: { id: "chat", url: "https://chat.test/" },
            },
          });
          world.prefs.set("zen.workspace.apps.sidebar.apps", JSON.stringify([
            { id: "mail", url: "https://mail.test/" },
            { id: "chat", url: "https://chat.test/" },
          ]));
          rt.readStartupPanel = () => JSON.parse(world.prefs.get(STARTUP));
          rt.whenNativeReady = (fn) => {
            let off = false;
            ready.then(() => { if (!off) fn(); });
            return () => { off = true; };
          };
        },
      });
      t.w.start();
      resolveNative();
      await world.advance(1000);
      assert.equal(t.html.getAttribute("bgalazka-triple-view"), "true", `Triple View restored (startupMod=${withStartupMod})`);
      assert.equal(cssPx(t.html, "--zentral-notes-gap"), 268, `exact gapPx restored (startupMod=${withStartupMod})`);
      t.stop();
      await t.w.close();
    }

    // Docked primary panel height (dockPx & shareDock) survives restart.
    const world = createPanelWorld({ sharedGlobal: { Map, Object } });
    world.disk.set(DIR + "/n1.md", noteText("Docked panel"));
    world.disk.set(DIR + "/meta.json", JSON.stringify({ openIn: "primary", shareDock: 0.42, dockPx: 252, folders: [] }));
    world.prefs.set(STARTUP, JSON.stringify({ id: "app", mode: "single" }));
    const w = world.openWindow({ id: "dock-restore" });
    const panel = w.buildPanel({ open: true });
    panel.slider.getBoundingClientRect = () => ({ left: 10, top: 40, width: 420, height: 636, right: 430, bottom: 676 });
    panel.toolbar.getBoundingClientRect = () => ({ left: 10, top: 40, width: 420, height: 36, right: 430, bottom: 76 });
    panel.page.getBoundingClientRect = () => {
      const res = cssPx(w.html, "--zentral-notes-panel-reserve");
      const h = Math.max(0, 600 - res);
      return { left: 10, top: 76, width: 420, height: h, right: 430, bottom: 76 + h };
    };
    w.start();
    await world.advance(1000);
    assert.equal(cssPx(w.html, "--zentral-notes-panel-reserve"), 252, "docked panel restores exact dockPx at launch on matching 600 px base");
    await w.close();
  });

  await probe.close();
  console.log(`\n${passed} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
