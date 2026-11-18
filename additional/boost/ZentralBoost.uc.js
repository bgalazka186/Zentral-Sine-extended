/*
 * ZENTRAL FILE GUIDE - additional/boost/ZentralBoost.uc.js
 *
 * Purpose: Memory Boost - read total browser RAM on demand, free memory losslessly, and trim once after startup.
 *   The owner measured his own browser (docs/PLAN_CODING_AGENT.md): the whole window including every Zentral script is
 *   ~49 MB, so this module never refactors code for size. What it can do is ask Gecko to give memory back, and later
 *   (OW-91/OW-92) unload what is not in use at all.
 * Interaction / execution: Runtime registers boost; standalone mode can start after browser readiness (requestProcInfo
 *   and the memory reporter manager must both exist). Every timer goes through the scope/lifecycle helpers and is
 *   cancelled on destroy: there is no interval anywhere in this file.
 * Ownership / failure: Owns its own timers, its listeners and the public API. Missing this feature does not affect
 *   tabs, panels, Notes or widgets; a build without `ChromeUtils.requestProcInfo()` disables the module with one
 *   console warning instead of failing the window.
 * Registration: boost
 * Loaded/created by: loader/ZentralCatalog.js
 * Literal DOM event subscriptions: none (it only listens to the window for user input while the startup trim waits)
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  const Services =
    globalThis.Services ||
    ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs")
      .Services;
  const ZentralRuntime = window.ZentralRuntime || window.__zentralStandaloneRuntime;

  const PREF = Object.freeze({
    ENABLED: "zen.workspace.zentral.boost.enabled",
    STARTUP_TRIM: "zen.workspace.zentral.boost.startup_trim",
    // B4 (OW-91): pinned and Essential tabs are the person's shortlist. Off by default: they restore on demand like
    // any other tab, so a deep run may include them only when asked.
    KEEP_PINNED: "zen.workspace.zentral.boost.keep_pinned",
    // B4.6: the one shortcut that runs the light pass. Empty means none, and an empty shortcut installs no listener.
    SHORTCUT: "zen.workspace.zentral.boost.shortcut",
    // B5 (OW-92): the RAM limiter. Off by default: a browser that unloads things on its own is a promise about the
    // person's work, and that promise is theirs to make.
    LIMIT_ENABLED: "zen.workspace.zentral.boost.limit_enabled",
    LIMIT_MB: "zen.workspace.zentral.boost.limit_mb",
    LIMIT_MODE: "zen.workspace.zentral.boost.limit_mode",
    LIMIT_COOLDOWN_S: "zen.workspace.zentral.boost.limit_cooldown_s",
    LIMIT_TARGET_PCT: "zen.workspace.zentral.boost.limit_target_pct",
    // B7 (OW-94): Game Mode, the Level 3 TOGGLE. Off by default and not remembered across a restart: a browser that
    // comes back from a restart still paused would look broken to anyone who forgot they turned it on.
    GAME_MODE: "zen.workspace.zentral.boost.game_mode",
    // B7.2: "Stronger saver" also sleeps the records marked `live` (WhatsApp, Messenger). A separate switch, OFF by
    // default, because sleeping a notification app is the one thing the mode may not decide on its own.
    STRONGER_SAVER: "zen.workspace.zentral.boost.stronger_saver",
  });
  // B2.1: sample only on demand. These are the two situations the plan allows a 2 s sampler.
  const SAMPLE_INTERVAL_MS = 2000;
  // B2.2: Level 1 measures "after" this long after the reporter manager answers, because Gecko frees on its own
  // schedule and an immediate reading only sees the request, not the result.
  const LEVEL1_SETTLE_MS = 3000;
  // B2.3: after restore, one trim once the browser has been quiet this long. Every deferral is a fresh one-shot timer
  // that a new input cancels and re-arms; nothing polls.
  const TRIM_QUIET_MS = 90000;
  const TRIM_IDLE_TIMEOUT_MS = 30000;
  const TRIM_MAX_WAIT_MS = 6 * 60 * 1000;
  const INPUT_EVENTS = ["keydown", "mousedown", "wheel", "touchstart", "pointerdown"];
  // B4.5: Restore remembers what it put to sleep, for this session only. The cap keeps the record bounded; the state is
  // deliberately lost on restart, because a restored tab is the browser's own job after that.
  const UNDO_CAP = 50;
  // B4.3: what a panel record may do in the background. `live` is the default for every existing record.
  const BACKGROUND_MODES = Object.freeze(["live", "throttled", "asleep-allowed"]);
  // B5/OW-92: the limiter's own numbers. Two cadences, both one-shot chains: a slow idle check and a faster one while
  // above 70 % of the limit. Nothing here is an interval.
  const LIMIT_IDLE_MS = 60000;
  const LIMIT_HOT_MS = 10000;
  const LIMIT_HOT_SHARE = 0.7; // "above 70 % of the limit" is the plan's own line
  const LIMIT_BATCH = 3;       // tabs per batch in a hard run, re-sampled after each
  const LIMIT_NAG_MS = 10 * 60000; // nothing eligible: at most one toast per ten minutes
  // B7/OW-94: the two tab attributes that decide whether a browser may be deactivated in Game Mode. An audible tab
  // keeps playing a podcast; the video preview's own source tab keeps its picture. Everything else may go inactive.
  const GAME_MODE_EXEMPT = Object.freeze(["audible", "video-source"]);
  const DEFAULT_LIMIT = Object.freeze({
    mb: 4096,
    mode: "soft",
    cooldownS: 60,
    targetPct: 85,
  });

  function standaloneReady(start) {
    let started = false;
    const run = () => {
      if (started || !window.gBrowser) return;
      started = true;
      try {
        Services.obs.removeObserver(observer, "browser-delayed-startup-finished");
      } catch (_) {}
      start();
    };
    const observer = {
      observe(subject, topic) {
        if (subject === window && topic === "browser-delayed-startup-finished") run();
      },
    };
    if (window.gBrowser && (!window.gBrowserInit || window.gBrowserInit.delayedStartupFinished)) run();
    else {
      Services.obs.addObserver(observer, "browser-delayed-startup-finished");
      window.addEventListener(
        "unload",
        () => {
          try {
            Services.obs.removeObserver(observer, "browser-delayed-startup-finished");
          } catch (_) {}
        },
        { once: true },
      );
      if (window.gBrowserInit?.delayedStartupFinished) run();
    }
  }

  (function () {
    function start() {
      if (window.ZentralBoost) return window.ZentralBoost.destroy;

      /* ---------------- preferences (read live, never cached at startup) ---------------- */

      const prefBool = (key, fallback) => {
        try {
          return Services.prefs.getBoolPref(key, fallback);
        } catch (_) {
          return fallback;
        }
      };
      const prefString = (key, fallback) => {
        try {
          return Services.prefs.getStringPref(key, fallback);
        } catch (_) {
          return fallback;
        }
      };
      const prefInt = (key, fallback) => {
        try {
          return Services.prefs.getIntPref(key, fallback);
        } catch (_) {
          return fallback;
        }
      };

      /* ---------------- teardown ---------------- */

      const cleanups = [];
      const onCleanup = (fn) => {
        if (typeof fn === "function") cleanups.push(fn);
        return fn;
      };
      const timers = new Set();
      const setTimer = (fn, ms) => {
        let id = 0;
        id = window.setTimeout(() => {
          timers.delete(id);
          try {
            fn();
          } catch (error) {
            warn(error);
          }
        }, Math.max(0, Number(ms) || 0));
        timers.add(id);
        return id;
      };
      const clearTimer = (id) => {
        if (!id) return;
        timers.delete(id);
        try {
          window.clearTimeout(id);
        } catch (_) {}
      };

      const warn = (message) => {
        try {
          (window.console || console).warn("[Zentral Boost]", message);
        } catch (_) {}
      };

      /* ---------------- B2.1 memory meter ---------------- */

      let probeInfo = null;
      const readProcInfo = () => {
        try {
          if (typeof ChromeUtils?.requestProcInfo !== "function") return null;
          return ChromeUtils.requestProcInfo();
        } catch (_) {
          return null;
        }
      };

      // Sum of the parent and every child's `memory`, in MB. Pure enough to test directly: the caller hands in the
      // object a browser returned, so nothing here talks to Gecko.
      function memoryMBFrom(info) {
        if (!info || typeof info !== "object") return null;
        let total = 0;
        let seen = 0;
        const add = (proc) => {
          const value = Number(proc?.memory);
          if (!Number.isFinite(value) || value < 0) return;
          total += value;
          seen += 1;
        };
        add(info);
        const children = Array.isArray(info.children) ? info.children : [];
        for (const child of children) add(child);
        return seen ? Math.round(total) : null;
      }

      let memorySupport = null; // null = not probed yet, false = the build cannot answer

      function applyAsyncProcInfo(promise) {
        memorySupport = true;
        Promise.resolve(promise)
          .then((resolved) => {
            if (disposed) return;
            const mb = memoryMBFrom(resolved);
            if (mb != null) {
              lastSampleMB = mb;
              emit(mb);
            }
          })
          .catch(() => {});
      }

      function memoryMB() {
        // One probe at most: the startup check's own answer is used as the first reading rather than thrown away and
        // re-read (a browser that answers costs one read, a build that cannot answer warns once).
        const info = probeInfo || readProcInfo();
        probeInfo = null;
        if (!info) {
          if (memorySupport !== false) {
            memorySupport = false;
            warn(
              "this build does not expose ChromeUtils.requestProcInfo(); the memory reading is unavailable",
            );
          }
          return null;
        }
        if (typeof info.then === "function") {
          applyAsyncProcInfo(info);
          return lastSampleMB;
        }
        memorySupport = true;
        return memoryMBFrom(info);
      }

      /* ---------------- B2.2 Level 1: free memory without losing anything ---------------- */

      // Cc/Ci are window globals in a chrome window; both are looked up lazily because a test harness has neither.
      const reporterManager = () => {
        try {
          const C = globalThis.Cc || window.Cc;
          const I = globalThis.Ci || window.Ci;
          if (!C || !I) return null;
          return C["@mozilla.org/memory-reporter-manager;1"].getService(
            I.nsIMemoryReporterManager,
          );
        } catch (_) {
          return null;
        }
      };

      // Gecko's minimizeMemoryUsage takes a callback; some builds reject a bare function strictly, so it is wrapped in
      // an object with run() (the plan's own instruction) and every step is separately guarded: GC/CC that a build
      // refuses must not turn "free memory" into an error a person sees.
      let level1Busy = false;
      let level1Timer = 0;
      let cancelLevel1 = null;

      function runLevel1() {
        if (disposed || level1Busy) return Promise.resolve(null);
        const beforeMB = memoryMB();
        if (beforeMB != null) lastSampleMB = beforeMB;
        level1Busy = true;
        return new Promise((resolve) => {
          let settled = false;
          const settle = (value) => {
            if (settled) return;
            settled = true;
            cancelLevel1 = null;
            level1Busy = false;
            resolve(value);
          };
          cancelLevel1 = () => settle(null);
          const finish = (freedBy) => {
            if (disposed) {
              settle(null);
              return;
            }
            level1Timer = setTimer(() => {
              level1Timer = 0;
              if (disposed) {
                settle(null);
                return;
              }
              const afterMB = memoryMB();
              const result = {
                beforeMB,
                afterMB,
                freedMB:
                  beforeMB != null && afterMB != null ? Math.max(0, beforeMB - afterMB) : null,
                by: freedBy,
              };
              lastSampleMB = afterMB != null ? afterMB : lastSampleMB;
              emit(afterMB != null ? afterMB : lastSampleMB);
              settle(result);
            }, LEVEL1_SETTLE_MS);
          };
          const cycle = (freedBy) => {
            try {
              if (typeof ChromeUtils?.forceGC === "function") ChromeUtils.forceGC();
            } catch (_) {}
            try {
              if (typeof ChromeUtils?.forceCC === "function") ChromeUtils.forceCC();
            } catch (_) {}
            finish(freedBy);
          };
          let manager = null;
          try {
            manager = reporterManager();
          } catch (_) {}
          if (!manager || typeof manager.minimizeMemoryUsage !== "function") {
            cycle("gc-cc-only");
            return;
          }
          let answered = false;
          const answer = () => {
            if (answered) return;
            answered = true;
            cycle("minimize");
          };
          try {
            manager.minimizeMemoryUsage({ run: answer });
          } catch (_) {
            cycle("gc-cc-only");
          }
        });
      }

      // The GC/CC pair on its own, for Level 2's settle (the manager's minimize already ran as Level 1's part of a deep
      // pass only when a caller asks for both halves; a deep pass keeps its own numbers honest by doing the same work).
      function runGcCc() {
        try {
          if (typeof ChromeUtils?.forceGC === "function") ChromeUtils.forceGC();
        } catch (_) {}
        try {
          if (typeof ChromeUtils?.forceCC === "function") ChromeUtils.forceCC();
        } catch (_) {}
      }

      // Destroy while a Level 1 run is settling must not touch a disposed feature.
      onCleanup(() => {
        clearTimer(level1Timer);
        level1Timer = 0;
        level1Busy = false;
        cancelLevel1?.();
      });

      /* ---------------- sampling (only while someone is looking) ---------------- */

      const changeListeners = new Set();
      let sampleTimer = 0;
      let samplerUsers = 0; // the popup and the limiter (OW-92) are the only two callers
      let lastSampleMB = null;

      // One door for "the total changed": a sample and a run both report here, so a card cannot tell them apart by
      // accident. A listener that throws is one listener's problem, never the module's.
      const emit = (value) => {
        for (const listener of changeListeners) {
          try {
            listener(value);
          } catch (_) {}
        }
      };

      const sampleOnce = () => {
        const value = memoryMB();
        if (value != null) {
          lastSampleMB = value;
          emit(value);
        }
        return value;
      };

      function armSampler() {
        if (sampleTimer || !samplerUsers) return;
        const tick = () => {
          sampleTimer = 0;
          if (!samplerUsers || disposed) return;
          sampleOnce();
          if (samplerUsers) sampleTimer = setTimer(tick, SAMPLE_INTERVAL_MS);
        };
        sampleOnce();
        sampleTimer = setTimer(tick, SAMPLE_INTERVAL_MS);
      }

      function stopSampler() {
        clearTimer(sampleTimer);
        sampleTimer = 0;
      }

      // "Someone is looking": the popup opened, or the limiter (later) asked for readings. Balanced by stopSampling.
      function startSampling() {
        if (disposed) return;
        samplerUsers += 1;
        armSampler();
      }

      function stopSampling() {
        samplerUsers = Math.max(0, samplerUsers - 1);
        if (!samplerUsers) stopSampler();
      }

      function onChange(cb) {
        if (typeof cb !== "function") return () => {};
        changeListeners.add(cb);
        return () => changeListeners.delete(cb);
      }

      /* ---------------- B2.3 post-startup trim ---------------- */

      // A tab is playing when Gecko or Zen says so. Both are read live and both are optional: a build without them
      // simply has no audible tab.
      function mediaPlaying() {
        try {
          const tabs = [...(window.gBrowser?.tabs || [])];
          if (typeof window.gBrowser?.getTabsWithoutMediaBlocked === "function") {
            const unblocked = window.gBrowser.getTabsWithoutMediaBlocked();
            if (Array.isArray(unblocked) && unblocked.length) return true;
          }
          return tabs.some((tab) => {
            if (tab?.soundPlaying) return true;
            try {
              return tab?.linkedBrowser?.browser?.isPlaying?.() === true;
            } catch (_) {
              return false;
            }
          });
        } catch (_) {
          return false;
        }
      }

      let trimTimer = 0;
      let trimMaxTimer = 0;
      let trimIdleId = 0;
      let trimDone = false;
      let lastInputAt = 0;
      let inputListenersAttached = false;

      const clearTrimTimers = () => {
        clearTimer(trimTimer);
        clearTimer(trimMaxTimer);
        trimTimer = 0;
        trimMaxTimer = 0;
        if (trimIdleId) {
          try {
            window.cancelIdleCallback?.(trimIdleId);
          } catch (_) {}
          trimIdleId = 0;
        }
      };

      const trimAllowed = () => !disposed && !trimDone && prefBool(PREF.STARTUP_TRIM, true);

      function armTrimQuietTimer() {
        if (!trimAllowed()) return;
        clearTimer(trimTimer);
        trimTimer = setTimer(runTrimIfQuiet, TRIM_QUIET_MS);
      }

      const onUserInput = () => {
        lastInputAt = Date.now();
        if (!trimAllowed()) return;
        armTrimQuietTimer();
      };

      const detachInputListeners = () => {
        if (!inputListenersAttached) return;
        inputListenersAttached = false;
        for (const type of INPUT_EVENTS) {
          try {
            window.removeEventListener(type, onUserInput, { capture: true, passive: true });
          } catch (_) {}
        }
      };

      function finishStartupTrim() {
        trimDone = true;
        clearTrimTimers();
        detachInputListeners();
        void runLevel1();
      }

      function runTrimIfQuiet() {
        trimTimer = 0;
        if (!trimAllowed()) return;
        // Two reasons to wait rather than run: the person is typing/clicking, or something is playing. Both re-arm one
        // timer; nothing is polled, and the hard ceiling (TRIM_MAX_WAIT_MS) stops the wait from outliving the session.
        if (mediaPlaying()) {
          armTrimQuietTimer();
          return;
        }
        if (typeof window.requestIdleCallback === "function") {
          try {
            trimIdleId = window.requestIdleCallback(
              () => {
                trimIdleId = 0;
                if (!trimAllowed()) return;
                finishStartupTrim();
              },
              { timeout: TRIM_IDLE_TIMEOUT_MS },
            );
            return;
          } catch (_) {
            trimIdleId = 0;
          }
        }
        finishStartupTrim();
      }

      for (const type of INPUT_EVENTS) {
        window.addEventListener(type, onUserInput, { capture: true, passive: true });
      }
      inputListenersAttached = true;
      onCleanup(detachInputListeners);

      function scheduleStartupTrim() {
        if (!trimAllowed()) return;
        clearTrimTimers();
        armTrimQuietTimer();
        trimMaxTimer = setTimer(() => {
          // The ceiling: if the browser was never quiet for 90 s (a first-run session with lots of input), one trim
          // still happens once, and never again.
          trimMaxTimer = 0;
          if (!trimAllowed()) return;
          finishStartupTrim();
        }, TRIM_MAX_WAIT_MS);
      }

      onCleanup(clearTrimTimers);

      /* ---------------- B4/OW-91: Level 2, what may go to sleep, and Restore ---------------- */

      // The policy table is shared with TabUnload: `loader/ZentralTabPolicy.js`, embedded in the standalone build and
      // loaded once by the runtime in the full pack. Without it (an old full pack) the module refuses to run a deep
      // pass rather than guessing: unloading a tab that is playing music is not something to re-derive here.
      const policy = () => window.ZentralTabPolicy || null;

      // The panel side. `ZentralPanels` publishes these on the window in the full pack; a standalone Boost has no
      // panels at all, which is why every use is guarded and a missing panel layer is normal, not an error.
      const panels = () => {
        const api = window.Zentral;
        const ctx = api?.Panels || api?.panels || null;
        return ctx && typeof ctx === "object" ? ctx : null;
      };
      const essentialRecords = () => {
        try {
          const map = panels()?.essentialPanels;
          if (!map || typeof map.values !== "function") return [];
          return [...map.values()].filter((record) => record?.tab);
        } catch (_) {
          return [];
        }
      };

      // The video preview's source tab, when the video module is up: unloading it would blank the preview, so it is one
      // of the policy's never-rules.
      const videoSourceTab = () => {
        try {
          const source = window.Zentral?.Video?.sourceTab || window.__zentralVideoSourceTab;
          return source?.isConnected ? source : null;
        } catch (_) {
          return null;
        }
      };

      const modeOf = (record) => {
        const raw = String(record?.backgroundMode || "");
        return BACKGROUND_MODES.includes(raw) ? raw : "live";
      };

      // The undo record: what a deep run put to sleep, newest last, capped. Panels and tabs are kept apart because
      // Restore treats them differently (panels wake now, tabs wake when clicked).
      const undoState = { panels: [], tabs: [] };
      const rememberUndone = (kind, entry) => {
        const list = undoState[kind];
        list.push(entry);
        while (list.length > UNDO_CAP) list.shift();
      };
      const undoSize = () => undoState.panels.length + undoState.tabs.length;

      // One tab's verdict, with every input the policy cannot read passed in. `opts.panelRecord` marks a tab that
      // backs an Essential-panel record and `opts.panelConsent` is that record's explicit permission to sleep it
      // (OW-111): the mode belongs to the panel loop, not to the `keep_pinned` pref or a generic tab sweep.
      const canUnload = (tab, ctx, opts = {}) => {
        const table = policy();
        if (!table) return { allowed: false, reason: "no-policy" };
        return table.isUnloadable(tab, {
          keepPinned: prefBool(PREF.KEEP_PINNED, false),
          videoSourceTab: ctx.videoSourceTab,
          selectedTab: ctx.selectedTab,
          sessionUrl: ctx.sessionUrlFor?.(tab) || "",
          isHostTab: ctx.isHostTab,
          isPrivate: ctx.isPrivate,
          isPanelRecord: Boolean(opts.panelRecord),
          panelConsent: Boolean(opts.panelConsent),
        });
      };

      // A deep run, in three steps that can each say no: tabs by the policy (oldest first), then panel records whose
      // mode allows sleep, then the wake-up list for Restore. The counts and the freed number are the result.
      let level2Busy = false;
      let cancelLevel2Wait = null;
      onCleanup(() => {
        cancelLevel2Wait?.();
        cancelLevel2Wait = null;
        level2Busy = false;
      });

      async function runLevel2(options = {}) {
        if (disposed || level2Busy) return null;
        if (!policy()) {
          warn("the tab policy is not loaded, so the deep pass is not offered in this build");
          return null;
        }
        const gBrowser = window.gBrowser;
        if (!gBrowser || !Array.isArray(gBrowser.tabs)) return null;
        if (options.allowTabs !== false && typeof gBrowser.explicitUnloadTabs !== "function" && typeof gBrowser.discardBrowser !== "function") {
          // A build that cannot put a tab to sleep gets the light pass and an honest zero, never a fake count.
          return runLevel1();
        }
        level2Busy = true;
        try {
          const beforeMB = memoryMB();
          if (beforeMB != null) lastSampleMB = beforeMB;
          const ctx = {
            videoSourceTab: videoSourceTab(),
            selectedTab: gBrowser.selectedTab,
            sessionUrlFor: (tab) => {
              try {
                const liveSpec = tab?.linkedBrowser?.currentURI?.spec;
                if (liveSpec && liveSpec !== "about:blank") return String(liveSpec);
                const state = JSON.parse(window.SessionStore?.getTabState?.(tab) || "{}");
                const entries = Array.isArray(state.entries) ? state.entries : [];
                const index = entries.length ? Math.max(0, Math.min(entries.length - 1, (Number(state.index) || 1) - 1)) : -1;
                return index >= 0 ? String(entries[index]?.url || "") : "";
              } catch (_) {
                return "";
              }
            },
            isHostTab: (tab) => Boolean(tab?.hasAttribute?.("bgalazka-addon-host") || tab?.hasAttribute?.("bgalazka-addon-host-fallback")),
          };
          const unloaded = { tabs: 0, panels: 0 };
          const skipped = [];
          // OW-111: the tabs behind Essential-panel records are read ONCE, before either loop. A record tab belongs
          // to its record's `backgroundMode`: the TAB loop must never decide for it (that was how a `live` WhatsApp
          // could be unloaded just because `keep_pinned` was on), and the PANEL loop may sleep it only with the
          // mode's consent even though the tab is pinned/Essential.
          const records = essentialRecords();
          const recordTabs = new Set(records.map((r) => r.tab).filter(Boolean));
          // Tabs: oldest `lastAccessed` first, so the tab nobody has looked at for hours goes before the one from a
          // minute ago. Selection never moves: a tab that would need a successor is not unloaded by a deep run.
          if (options.allowTabs !== false) {
            const candidates = [...gBrowser.tabs].sort(policy().byOldestFirst);
            // A limiter run takes one batch at a time and re-reads memory after it; a manual deep pass takes all of
            // them. `batch` is the only difference, so both go through the same policy.
            const limit = Number(options.batch) > 0 ? Number(options.batch) : Infinity;
            for (const tab of candidates) {
              if (disposed || unloaded.tabs >= limit) break;
              // A record tab is owned ONLY by the panel loop below; the policy says so with its own named reason,
              // so a live record stays loaded whatever the `keep_pinned` pref says.
              const verdict = canUnload(tab, ctx, { panelRecord: recordTabs.has(tab) });
              if (!verdict.allowed) {
                if (verdict.reason !== "selected" && verdict.reason !== "panel-record" && skipped.length < 5) skipped.push(verdict.reason);
                continue;
              }
              try {
                if (typeof gBrowser.explicitUnloadTabs === "function") await gBrowser.explicitUnloadTabs([tab]);
                else {
                  await gBrowser.prepareDiscardBrowser?.(tab);
                  gBrowser.discardBrowser?.(tab, true);
                }
                if (disposed) return null;
                unloaded.tabs += 1;
                rememberUndone("tabs", {
                  tab: null, // the element is gone from the session's point of view; the URL is what Restore lists
                  url: String(tab.linkedBrowser?.currentURI?.spec || ""),
                  title: String(tab.label || ""),
                  when: Date.now(),
                });
              } catch (_) {
                skipped.push("unload-failed");
              }
            }
          }
          // Panels: only records the person marked `asleep-allowed`. `live` and `throttled` stay exactly as they are —
          // the mode is theirs, and this pass does not read it as advice.
          if (!disposed && options.allowPanels !== false) {
            // A manual deep pass and the limiter sleep only `asleep-allowed` records — the mode is the person's advice
            // and this pass does not read it as consent. A Stronger-saver Game Mode pass passes `allowModes` with every
            // mode, because that switch IS the consent (plan B7.2).
            const modes = Array.isArray(options.allowModes) ? options.allowModes : ["asleep-allowed"];
            for (const record of records) {
              if (disposed) break;
              if (!modes.includes(modeOf(record))) continue;
              // OW-111: consent comes from THIS record's mode (or Stronger saver's all-modes switch), not from
              // `keep_pinned`. It waives only the pinned/Essential rule; audible/selected/PiP/etc. still win.
              const verdict = canUnload(record.tab, ctx, { panelRecord: true, panelConsent: true });
              if (!verdict.allowed) {
                if (skipped.length < 8) skipped.push("panel:" + verdict.reason);
                continue;
              }
              try {
                if (typeof gBrowser.explicitUnloadTabs === "function") await gBrowser.explicitUnloadTabs([record.tab]);
                else gBrowser.discardBrowser?.(record.tab, true);
                if (disposed) return null;
                unloaded.panels += 1;
                rememberUndone("panels", { appId: record.app?.id || record.appId, title: String(record.app?.name || ""), when: Date.now() });
              } catch (_) {
                skipped.push("panel-unload-failed");
              }
            }
          }
          if (disposed) return null;
          // Gecko frees after the sleep, not during it: the same 3 s settle as Level 1, for the same reason.
          const afterMB = await new Promise((resolve) => {
            let done = false;
            let t1 = 0;
            let t2 = 0;
            const settle = (value) => {
              if (done) return;
              done = true;
              cancelLevel2Wait = null;
              clearTimer(t1);
              clearTimer(t2);
              resolve(value);
            };
            cancelLevel2Wait = () => settle(undefined);
            t1 = setTimer(() => {
              t1 = 0;
              if (disposed) {
                settle(undefined);
                return;
              }
              runGcCc();
              t2 = setTimer(() => {
                t2 = 0;
                settle(disposed ? undefined : memoryMB());
              }, LEVEL1_SETTLE_MS);
            }, LEVEL1_SETTLE_MS);
          });
          if (disposed || afterMB === undefined) return null;
          const freedMB = beforeMB != null && afterMB != null ? Math.max(0, beforeMB - afterMB) : null;
          if (afterMB != null) {
            lastSampleMB = afterMB;
            emit(afterMB);
          }
          return { beforeMB, afterMB, freedMB, by: "level2", unloaded, skipped, undoSize: undoSize() };
        } finally {
          cancelLevel2Wait = null;
          level2Busy = false;
        }
      }

      // Restore: wakes what a deep run put to sleep. Panel records wake immediately (that is the promise Restore makes),
      // tabs are listed — waking them all at once would undo the run and cost the memory back in one go.
      function restore() {
        const restored = { panels: 0, tabs: 0 };
        const ctx = panels();
        for (const record of undoState.panels.splice(0)) {
          try {
            const live = essentialRecords().find((r) => (r.app?.id || r.appId) === record.appId);
            if (live && typeof ctx?.loadEssentialInBackground === "function") {
              ctx.loadEssentialInBackground(live, false);
              restored.panels += 1;
            }
          } catch (_) {}
        }
        // The tab list is what remains: Restore reports how many URLs are waiting for a click, and clears the record.
        restored.tabs = undoState.tabs.length;
        undoState.tabs.length = 0;
        return restored;
      }

      // The panel tile's menu reads and writes one record's mode through the panel module's own store, so a mode set
      // here is the mode everyone else sees. `saveEssentialSettings` is the documented writer.
      function setBackgroundMode(appId, mode) {
        if (!BACKGROUND_MODES.includes(mode)) return null;
        const record = essentialRecords().find((r) => (r.app?.id || r.appId) === appId);
        if (!record) return null;
        record.backgroundMode = mode;
        try {
          panels()?.saveEssentialSettings?.(record);
        } catch (_) {
          return null;
        }
        return { appId, mode };
      }

      // ---- B4.6: the one shortcut, following the app-shortcut module's own parser ----
      const isMac = () => {
        try {
          return Services.appinfo.OS === "Darwin";
        } catch (_) {
          return false;
        }
      };
      const KEY_ALIASES = { esc: "Escape", escape: "Escape", space: "Space", enter: "Enter", tab: "Tab", delete: "Delete" };
      const normalizeKey = (rawKey, code = "") => {
        const c = String(code || "");
        if (/^Key([A-Z])$/.test(c)) return c.slice(3);
        if (/^Digit([0-9])$/.test(c)) return c.slice(5);
        if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(c)) return c.toUpperCase();
        const k = String(rawKey || "");
        if (/^[a-zA-Z]$/.test(k)) return k.toUpperCase();
        if (/^[0-9]$/.test(k)) return k;
        if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(k)) return k.toUpperCase();
        return KEY_ALIASES[k.toLowerCase()] || "";
      };
      // "Accel+Shift+B" -> a spec. The same token set the app shortcuts accept, minus the ones a single-key shortcut
      // would need: a boost shortcut must combine at least two keys, so it can never swallow ordinary typing.
      function parseShortcut(text) {
        if (!text || typeof text !== "string") return null;
        const spec = { ctrl: false, alt: false, shift: false, meta: false, key: "" };
        for (const token of String(text).split("+").map((t) => t.trim()).filter(Boolean)) {
          const lower = token.toLowerCase();
          if (lower === "ctrl" || lower === "control") spec.ctrl = true;
          else if (lower === "alt" || lower === "option" || lower === "opt") spec.alt = true;
          else if (lower === "shift") spec.shift = true;
          else if (["meta", "cmd", "command", "super", "os"].includes(lower)) spec.meta = true;
          else if (["accel", "mod", "primary"].includes(lower)) {
            if (isMac()) spec.meta = true;
            else spec.ctrl = true;
          } else {
            const key = normalizeKey(token);
            if (!key || spec.key) return null;
            spec.key = key;
          }
        }
        if (!spec.key) return null;
        const count = (spec.ctrl ? 1 : 0) + (spec.alt ? 1 : 0) + (spec.shift ? 1 : 0) + (spec.meta ? 1 : 0) + 1;
        return count >= 2 ? spec : null;
      }
      function matchesShortcut(event, spec) {
        if (!event || !spec?.key) return false;
        if (!!event.ctrlKey !== spec.ctrl || !!event.altKey !== spec.alt) return false;
        if (!!event.shiftKey !== spec.shift || !!event.metaKey !== spec.meta) return false;
        return normalizeKey(event.key, event.code) === spec.key;
      }
      let shortcutSpec = null;
      let shortcutObserver = null;
      function readShortcut() {
        shortcutSpec = parseShortcut(prefString(PREF.SHORTCUT, ""));
      }
      function installShortcut() {
        readShortcut();
        // One listener for the whole window, registered with the module's cleanups. It runs the light pass only: the
        // deep pass closes nothing on a keystroke.
        const onKey = (event) => {
          if (!shortcutSpec || !matchesShortcut(event, shortcutSpec)) return;
          if (event.repeat) return;
          event.preventDefault?.();
          event.stopPropagation?.();
          void runLevel1();
        };
        window.addEventListener("keydown", onKey, true);
        onCleanup(() => {
          window.removeEventListener("keydown", onKey, true);
        });
        // A pref change re-reads the combination without a restart, like every other Boost setting.
        try {
          shortcutObserver = {
            observe(_subject, _topic, data) {
              if (!data || data === PREF.SHORTCUT) readShortcut();
            },
          };
          Services.prefs.addObserver(PREF.SHORTCUT, shortcutObserver);
          onCleanup(() => {
            try {
              Services.prefs.removeObserver(PREF.SHORTCUT, shortcutObserver);
            } catch (_) {}
            shortcutObserver = null;
          });
        } catch (_) {}
      }

      /* ---------------- B5/OW-92: the RAM limiter ---------------- */

      // Every decision is made here, as a pure function of the numbers, so the state machine can be proven without a
      // browser: hysteresis (the hot cadence starts at 70 % of the limit and the slow one returns below the target),
      // the cooldown, and the "nothing eligible" nag limit.
      //
      // @param {object} input
      //   - `totalMB`      the current reading, or null when the build cannot measure
      //   - `settings`     {enabled, limitMB, mode, cooldownS, targetPct}
      //   - `lastRunAt`    when the limiter last acted (0 = never)
      //   - `lastNagAt`    when it last said "nothing to do"
      //   - `now`
      // @returns {{action, cadenceMs, reason, targetMB}}
      function decideLimiter(input = {}) {
        const settings = {
          enabled: input.settings?.enabled !== false,
          limitMB: Number(input.settings?.limitMB) > 0 ? Number(input.settings.limitMB) : DEFAULT_LIMIT.mb,
          mode: input.settings?.mode === "hard" ? "hard" : "soft",
          cooldownS: Number.isFinite(Number(input.settings?.cooldownS)) ? Math.max(0, Number(input.settings.cooldownS)) : DEFAULT_LIMIT.cooldownS,
          targetPct: Number(input.settings?.targetPct) > 0 ? Math.min(100, Number(input.settings.targetPct)) : DEFAULT_LIMIT.targetPct,
        };
        const cadenceIdle = settings.targetPct ? LIMIT_IDLE_MS : LIMIT_IDLE_MS;
        const decide = (action, cadenceMs, reason) => ({
          action, cadenceMs, reason, targetMB: Math.round((settings.limitMB * settings.targetPct) / 100),
        });
        if (!settings.enabled) return decide("none", LIMIT_IDLE_MS, "off");
        const total = Number(input.totalMB);
        if (!Number.isFinite(total) || total <= 0) return decide("none", LIMIT_IDLE_MS, "no-reading");
        // Below the limit: a slow check, and specifically below the target so the two cadences do not oscillate.
        if (total <= settings.limitMB) return decide("none", total > settings.limitMB * LIMIT_HOT_SHARE ? LIMIT_HOT_MS : LIMIT_IDLE_MS, "under-limit");
        // Over the limit. The cooldown is a hard "do not act again yet", whatever the mode.
        const since = Number(input.now || 0) - Number(input.lastRunAt || 0);
        if (input.lastRunAt && since < settings.cooldownS * 1000) {
          return decide("none", Math.max(1000, settings.cooldownS * 1000 - since), "cooldown");
        }
        if (settings.mode === "soft") return decide("notify", LIMIT_HOT_MS, "soft");
        return decide("unload", LIMIT_HOT_MS, "hard");
      }

      // The nag rule, kept apart because it is about a person's attention rather than about memory: when a hard run
      // can do nothing, say it once per ten minutes, not every ten seconds.
      function shouldNag(lastNagAt, now) {
        if (!lastNagAt) return true;
        return Number(now) - Number(lastNagAt) >= LIMIT_NAG_MS;
      }

      const limiterSettings = () => ({
        enabled: prefBool(PREF.LIMIT_ENABLED, false),
        limitMB: prefInt(PREF.LIMIT_MB, DEFAULT_LIMIT.mb),
        mode: prefString(PREF.LIMIT_MODE, DEFAULT_LIMIT.mode),
        cooldownS: prefInt(PREF.LIMIT_COOLDOWN_S, DEFAULT_LIMIT.cooldownS),
        targetPct: prefInt(PREF.LIMIT_TARGET_PCT, DEFAULT_LIMIT.targetPct),
      });

      const limiter = {
        timer: 0,
        lastRunAt: 0,
        lastNagAt: 0,
        lastAction: "",
        lastReason: "",
        runs: 0,
        busy: false,
      };

      // One tick: read, decide, act, and arm exactly one more timer. The chain stops the moment the pref is off or the
      // feature is destroyed, so a limiter that is not asked for costs nothing.
      function limiterTick() {
        limiter.timer = 0;
        if (disposed) return;
        const settings = limiterSettings();
        if (!settings.enabled) {
          limiter.lastAction = "none";
          limiter.lastReason = "off";
          return;
        }
        const totalMB = memoryMB();
        const decision = decideLimiter({
          totalMB,
          settings,
          lastRunAt: limiter.lastRunAt,
          now: Date.now(),
        });
        limiter.lastAction = decision.action;
        limiter.lastReason = decision.reason;
        if (decision.action === "notify") {
          limiter.lastRunAt = Date.now();
          limiter.runs += 1;
          for (const listener of limiterListeners) {
            try {
              listener({ kind: "limit", action: "notify", totalMB, limitMB: settings.limitMB, targetMB: decision.targetMB });
            } catch (_) {}
          }
        } else if (decision.action === "unload" && !limiter.busy) {
          limiter.lastRunAt = Date.now();
          limiter.runs += 1;
          void limiterRunHard(settings, decision, totalMB);
        }
        armLimiter(decision.cadenceMs);
      }

      // A hard run in batches: three tabs, re-read, stop at the target or when nothing is left. `runLevel2` already
      // does the policy work; this only decides when to stop, which is the part that makes a hard mode safe.
      async function limiterRunHard(settings, decision, totalMB) {
        if (limiter.busy) return;
        limiter.busy = true;
        try {
          let current = totalMB;
          let rounds = 0;
          let unloaded = { tabs: 0, panels: 0 };
          // A hard run is a deep pass repeated until the number is where the person wants it, with a bounded number of
          // rounds so a page that refuses to sleep cannot make this loop forever.
          while (!disposed && limiterSettings().enabled && rounds < 12 && current > decision.targetMB) {
            rounds += 1;
            const result = await runLevel2({ batch: LIMIT_BATCH });
            if (!result || result.by !== "level2") break;
            unloaded.tabs += result.unloaded?.tabs || 0;
            unloaded.panels += result.unloaded?.panels || 0;
            const after = Number(result.afterMB);
            if (!Number.isFinite(after) || after >= current) break; // nothing changed: stop rather than spin
            current = after;
            if (!(result.unloaded?.tabs || result.unloaded?.panels)) break;
          }
          if (disposed || !limiterSettings().enabled) return;
          for (const listener of limiterListeners) {
            try {
              listener({ kind: "limit", action: "hard-done", totalMB: current, unloaded, runs: rounds });
            } catch (_) {}
          }
          // Still above the limit with nothing eligible: one quiet line per ten minutes, never a loop of them.
          if (current > decision.targetMB && !unloaded.tabs && !unloaded.panels && shouldNag(limiter.lastNagAt, Date.now())) {
            limiter.lastNagAt = Date.now();
            for (const listener of limiterListeners) {
              try {
                listener({ kind: "limit", action: "nothing-eligible", totalMB: current, limitMB: settings.limitMB });
              } catch (_) {}
            }
          }
        } finally {
          limiter.busy = false;
        }
      }

      function armLimiter(ms) {
        clearTimer(limiter.timer);
        limiter.timer = 0;
        if (disposed) return;
        if (!limiterSettings().enabled) return;
        limiter.timer = setTimer(limiterTick, Math.max(1000, Number(ms) || LIMIT_IDLE_MS));
      }

      const limiterListeners = new Set();
      function onLimiterEvent(cb) {
        if (typeof cb !== "function") return () => {};
        limiterListeners.add(cb);
        return () => limiterListeners.delete(cb);
      }

      // Live settings: switching the limiter on starts the chain, switching it off stops it, and a changed number
      // re-reads itself on the next tick (no restart, and no extra work now).
      function installLimiter() {
        armLimiter(LIMIT_IDLE_MS);
        const observers = [];
        for (const key of [PREF.LIMIT_ENABLED, PREF.LIMIT_MB, PREF.LIMIT_MODE, PREF.LIMIT_COOLDOWN_S, PREF.LIMIT_TARGET_PCT]) {
          const observer = {
            observe(_subject, _topic, data) {
              if (!data || data === key) armLimiter(LIMIT_IDLE_MS);
            },
          };
          try {
            Services.prefs.addObserver(key, observer);
            observers.push([key, observer]);
          } catch (_) {}
        }
        onCleanup(() => {
          for (const [key, observer] of observers) {
            try {
              Services.prefs.removeObserver(key, observer);
            } catch (_) {}
          }
        });
        onCleanup(() => {
          clearTimer(limiter.timer);
          limiter.timer = 0;
          limiterListeners.clear();
        });
      }

      /* ---------------- B7/OW-94: Game Mode, the Level 3 toggle ---------------- */

      // The plan's shape: Level 2 + pause every timer + deactivate every kept browser except the exempt ones. The
      // decision is a pure function so the rule can be read and tested on its own; the acting part can then only do
      // what that function said.
      const performanceSwitch = () => window.ZentralRuntime?.performance || null;

      // Which of these may be deactivated. `exempt` is the podcast (an audible tab) and the video preview's source tab:
      // the plan's own exception list, and the owner gate is exactly that a podcast keeps playing.
      //
      // A target is `{ id, exempt, kind }`. `kept` carries the reason, so a live check can say why a tab survived.
      function decideGameMode({ targets = [] } = {}) {
        const act = [];
        const kept = [];
        for (const target of targets) {
          if (!target || target.id == null) continue;
          if (target.exempt) kept.push({ id: target.id, reason: target.why || "exempt" });
          else act.push({ id: target.id, kind: target.kind || "tab" });
        }
        return { act, kept };
      }

      // Is this tab exempt from Game Mode? Two facts, both from the shared policy so there is one definition of
      // "audible" in the whole project.
      function gameModeExemptReason(tab, videoSource) {
        const table = policy();
        if (table?.isAudible?.(tab)) return "audible";
        if (videoSource && tab === videoSource) return "video-source";
        if (tab === window.gBrowser?.selectedTab) return "selected";
        return "";
      }

      // Everything Game Mode may touch: the browsers of open tabs (never the selected one) and ONLY already-loaded panel
      // browsers. Never call `getOrCreateAppBrowser` here: creating browsers for unloaded apps would spin up and load
      // every Zentra/Essential app on demand when turning Game Mode on.
      function gameModeTargets() {
        const bodies = [];
        const seen = new Set();
        const videoSource = videoSourceTab();
        const gBrowser = window.gBrowser;
        try {
          for (const tab of gBrowser?.tabs || []) {
            const browser = tab?.linkedBrowser;
            if (!browser || !tab.isConnected || seen.has(browser)) continue;
            seen.add(browser);
            const why = gameModeExemptReason(tab, videoSource);
            bodies.push({ id: browser, kind: "tab", exempt: Boolean(why), why });
          }
        } catch (_) {}
        try {
          const panelCtx = panels();
          const apps = window.Zentral?.Apps;
          const recordsByAppId = new Map();
          for (const record of essentialRecords()) {
            const appId = record?.app?.id || record?.appId;
            if (appId) recordsByAppId.set(appId, record);
          }
          const addPanelBrowser = (browser, record) => {
            if (!browser?.isConnected || seen.has(browser)) return;
            seen.add(browser);
            let why = record?.tab ? gameModeExemptReason(record.tab, videoSource) : "";
            if (!why && browser.audioPlaying) why = "audible";
            if (!why && videoSource && browser === videoSource.linkedBrowser) why = "video-source";
            bodies.push({ id: browser, kind: "panel", exempt: Boolean(why), why: why || "panel" });
          };
          const liveBrowsers =
            typeof panelCtx?.getAllAppBrowsers === "function" ? panelCtx.getAllAppBrowsers() : [];
          for (const browser of liveBrowsers || []) {
            const appId = browser?._bgalazkaAppId;
            addPanelBrowser(browser, appId ? recordsByAppId.get(appId) : null);
          }
          for (const record of recordsByAppId.values()) {
            const appId = record?.app?.id || record?.appId;
            const browser =
              (typeof apps?.getAppBrowser === "function" ? apps.getAppBrowser(appId) : null) ||
              apps?.appBrowsers?.get?.(appId) ||
              record?.tab?.linkedBrowser ||
              null;
            addPanelBrowser(browser, record);
          }
        } catch (_) {}
        return bodies;
      }

      // The state Game Mode owns. `saved` is everything it changed, so switching it off puts the session back instead of
      // guessing; `woke` is what a Stronger-saver pass put to sleep, so Restore can bring it back.
      const gameMode = { on: false, saved: new Map(), woke: [], pausedBy: false, run: 0, lastActed: 0, lastResult: null };

      function rememberBrowser(browser) {
        if (!browser || gameMode.saved.has(browser)) return;
        try {
          gameMode.saved.set(browser, {
            docShellIsActive: browser.docShellIsActive,
            renderLayers: browser.renderLayers,
          });
        } catch (_) {}
      }

      // One pass over the live session. Returns what it did, for `gameModeState()` and for a test.
      function deactivateForGameMode(targets) {
        const decision = decideGameMode({ targets });
        let acted = 0;
        for (const entry of decision.act) {
          const browser = entry.id;
          try {
            rememberBrowser(browser);
            if (browser.docShellIsActive !== false) browser.docShellIsActive = false;
            if (browser.isRemoteBrowser && browser.renderLayers !== false) browser.renderLayers = false;
            acted += 1;
          } catch (_) {}
        }
        gameMode.lastActed = acted;
        return { acted, kept: decision.kept };
      }

      // B7.2's "Stronger saver": sleep every panel record, whatever its mode, by running the deep pass with the modes
      // opened up. It goes through `runLevel2` rather than a second unload path, so the policy still decides what may go
      // (audible, selected, pending, video source...) and `undoState` is filled by the same code Restore reads.
      async function strongerSaverSleep() {
        const result = await runLevel2({ allowTabs: false, allowModes: [...BACKGROUND_MODES] });
        const slept = Number(result?.unloaded?.panels) || 0;
        for (let i = 0; i < slept; i++) gameMode.woke.push("panel");
        return slept;
      }

      function restoreGameModeActivity() {
        let restored = 0;
        for (const [browser, state] of gameMode.saved) {
          try {
            if (!browser?.isConnected) continue;
            if (browser.docShellIsActive !== state.docShellIsActive) browser.docShellIsActive = state.docShellIsActive;
            if (browser.isRemoteBrowser && browser.renderLayers !== state.renderLayers)
              browser.renderLayers = state.renderLayers;
            restored += 1;
          } catch (_) {}
        }
        gameMode.saved.clear();
        return restored;
      }

      // B7.3: switching off unpauses, restores the SELECTED tab, and lets everything else reload lazily. Reactivating
      // every browser on the way out of a game would cost exactly the memory the mode was saving.
      function restoreSelectedTabActivity() {
        const gBrowser = window.gBrowser;
        const browser = gBrowser?.selectedTab?.linkedBrowser || gBrowser?.selectedBrowser;
        if (!browser) return 0;
        try {
          if (browser.docShellIsActive !== true) browser.docShellIsActive = true;
          if (browser.isRemoteBrowser && browser.renderLayers !== true) browser.renderLayers = true;
          return 1;
        } catch (_) {
          return 0;
        }
      }

      function syncPanelActivity() {
        try {
          panels()?.syncAppPanelBrowserActivity?.();
        } catch (_) {}
      }

      // One writer. `setGameMode` sets the pref, and the pref observer is what actually runs the change, so a switch in
      // the widget and a checkbox in Settings do the identical thing and neither can drift from the other.
      function setGameMode(on) {
        const target = Boolean(on);
        if (prefBool(PREF.GAME_MODE, false) !== target) {
          try {
            Services.prefs.setBoolPref(PREF.GAME_MODE, target);
          } catch (_) {}
        }
        return applyGameMode(target);
      }

      function applyGameMode(on) {
        const target = Boolean(on);
        // Already in that state: a second switch, the pref observer having just done the work, or a restart with the
        // pref set. The caller still wants to know what the last real pass did, so that is what it gets.
        if (target === gameMode.on) return gameMode.lastResult || gameModeState();
        if (target) {
          gameMode.on = true;
          gameMode.run += 1;
          const switchApi = performanceSwitch();
          if (switchApi && !switchApi.isPaused()) {
            switchApi.setPaused(true);
            gameMode.pausedBy = true;
          }
          // Level 2 first (the plan's "Level 2 +"), then the activity pass. Level 2 is async and must not block the
          // switch: the activity pass is what the person feels, and it is synchronous by design. Do NOT call
          // `syncPanelActivity()` here on turn-on: `deactivateForGameMode` already idled background panels, whereas
          // `syncPanelActivity()` would reactivate preload `live` notification panels right back.
          const level2 = runLevel2({ allowPanels: false });
          if (level2 && typeof level2.catch === "function") level2.catch(() => {});
          const activity = deactivateForGameMode(gameModeTargets());
          if (prefBool(PREF.STRONGER_SAVER, false)) {
            Promise.resolve(level2)
              .then(() => {
                if (disposed || !gameMode.on || !prefBool(PREF.STRONGER_SAVER, false)) return null;
                return strongerSaverSleep();
              })
              .catch(() => {});
          }
          gameMode.lastResult = { ...gameModeState(), acted: activity.acted, kept: activity.kept.length };
          return gameMode.lastResult;
        }
        gameMode.on = false;
        const restored = restoreGameModeActivity();
        const selected = restoreSelectedTabActivity();
        gameMode.woke.length = 0;
        const switchApi = performanceSwitch();
        if (gameMode.pausedBy && switchApi) {
          switchApi.setPaused(false);
          gameMode.pausedBy = false;
        }
        syncPanelActivity();
        gameMode.lastResult = { ...gameModeState(), restored, selected };
        return gameMode.lastResult;
      }

      function gameModeState() {
        return {
          on: gameMode.on,
          paused: Boolean(performanceSwitch()?.isPaused?.()),
          stronger: prefBool(PREF.STRONGER_SAVER, false),
          saved: gameMode.saved.size,
          woke: gameMode.woke.length,
          acted: gameMode.lastActed,
          run: gameMode.run,
        };
      }

      // The pref is the switch, so Settings and the widget write the same thing and only one path acts on it.
      function installGameMode() {
        if (prefBool(PREF.GAME_MODE, false)) applyGameMode(true);
        const observer = {
          observe(_subject, _topic, data) {
            if (data && data !== PREF.GAME_MODE) return;
            const next = prefBool(PREF.GAME_MODE, false);
            if (next === gameMode.on) return;
            applyGameMode(next);
          },
        };
        try {
          Services.prefs.addObserver(PREF.GAME_MODE, observer);
          onCleanup(() => {
            try {
              Services.prefs.removeObserver(PREF.GAME_MODE, observer);
            } catch (_) {}
          });
        } catch (_) {}
        // Leaving a window that is in Game Mode must not leave the browser deactivated or persist the pref across a
        // restart: turning it off on teardown restores activity and clears the pref so the next launch starts normal.
        onCleanup(() => {
          if (gameMode.on) applyGameMode(false);
          if (prefBool(PREF.GAME_MODE, false)) {
            try {
              Services.prefs.setBoolPref(PREF.GAME_MODE, false);
            } catch (_) {}
          }
        });
      }

      /* ---------------- public API ---------------- */

      let disposed = false;
      const api = {
        memoryMB,
        runLevel1,
        // B4/OW-91: the deep pass, its undo record, and the panel modes. Each refuses politely when its layer is
        // missing (no shared policy, no panel module) instead of throwing at a caller that only wanted a button.
        runLevel2,
        restore,
        undoSize,
        setBackgroundMode,
        backgroundModeOf: (record) => modeOf(record),
        BACKGROUND_MODES,
        // B7/OW-94: Game Mode. `setGameMode(true/false)` is what the widget's switch and the pref both call; the pref
        // observer is the only other entry point.
        setGameMode,
        applyGameMode,
        gameModeState,
        decideGameMode,
        gameModeTargets,
        // B5/OW-92: the limiter's decisions and its live state, for a caller (the widget, a live check) that wants to
        // show them. The deciding itself is pure and tested on its own.
        decideLimiter,
        onLimiterEvent,
        limiterState: () => ({
          enabled: prefBool(PREF.LIMIT_ENABLED, false),
          settings: limiterSettings(),
          armed: Boolean(limiter.timer),
          lastAction: limiter.lastAction,
          lastReason: limiter.lastReason,
          runs: limiter.runs,
        }),
        onChange,
        startSampling,
        stopSampling,
        // The last sampled value, for a widget that must show something before it samples (OW-90).
        lastMB: () => lastSampleMB,
        isSupported: () => memoryMB() != null,
        // Diagnostics for a live check: what the trim has decided, in one object.
        state: () => ({
          disposed,
          trimDone,
          trimArmed: !!trimTimer,
          sampling: !!sampleTimer,
          samplerUsers,
          lastInputAt,
          memorySupport,
          level2Busy,
          undoSize: undoSize(),
          shortcut: shortcutSpec ? "set" : "",
          policy: Boolean(policy()),
          panels: essentialRecords().length,
        }),
        destroy,
      };

      function destroy() {
        if (disposed) return;
        disposed = true;
        for (const fn of cleanups.splice(0).reverse()) {
          try {
            fn();
          } catch (_) {}
        }
        for (const id of [...timers]) clearTimer(id);
        changeListeners.clear();
        delete window.ZentralBoost;
      }

      window.ZentralBoost = api;
      const onWindowUnload = () => api.destroy();
      window.addEventListener("unload", onWindowUnload, { once: true });
      onCleanup(() => {
        try {
          window.removeEventListener("unload", onWindowUnload);
        } catch (_) {}
      });
      installShortcut();
      installLimiter();
      installGameMode();

      // A build without requestProcInfo has a memory meter that can never answer: say so once and stay out of the way
      // (the plan's B2.1). Level 1 is still useful on its own, so the module keeps running rather than disabling
      // everything.
      probeInfo = readProcInfo();
      if (!probeInfo) {
        memorySupport = false;
        warn(
          "this build does not expose ChromeUtils.requestProcInfo(); the RAM reading is unavailable, freeing memory still works",
        );
      } else if (typeof probeInfo.then === "function") {
        const pendingProbe = probeInfo;
        probeInfo = null;
        applyAsyncProcInfo(pendingProbe);
      }

      // B2.3: after session restore, once per browser start. The runtime activates features only after its own
      // native-ready barrier (session restore, delayed startup, Zen workspaces/pinned tabs), so `start()` already runs
      // after restoration in the full pack; the standalone path waits for the same barrier itself. The extra session
      // promise is the one case the barrier cannot cover: a window that starts while another window restores.
      function scheduleAfterRestore() {
        if (disposed) return;
        const session = globalThis.SessionStore?.promiseInitialized;
        if (session && typeof session.then === "function") {
          Promise.resolve(session)
            .then(() => {
              if (!disposed) scheduleStartupTrim();
            })
            .catch(() => {});
          return;
        }
        scheduleStartupTrim();
      }
      scheduleAfterRestore();

      return () => api.destroy();
    }

    if (ZentralRuntime) ZentralRuntime.register({ id: "boost", init: start });
    else standaloneReady(start);
  })();
})();
