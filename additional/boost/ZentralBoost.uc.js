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

      function runLevel1() {
        if (level1Busy) return Promise.resolve(null);
        const beforeMB = memoryMB();
        level1Busy = true;
        return new Promise((resolve) => {
          const finish = (freedBy) => {
            level1Timer = setTimer(() => {
              level1Timer = 0;
              level1Busy = false;
              const afterMB = memoryMB();
              const result = {
                beforeMB,
                afterMB,
                freedMB:
                  beforeMB != null && afterMB != null ? Math.max(0, beforeMB - afterMB) : null,
                by: freedBy,
              };
              for (const listener of changeListeners) {
                try {
                  listener(result);
                } catch (_) {}
              }
              resolve(result);
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

      // Destroy while a Level 1 run is settling must not touch a disposed feature.
      onCleanup(() => {
        clearTimer(level1Timer);
        level1Timer = 0;
        level1Busy = false;
      });

      /* ---------------- sampling (only while someone is looking) ---------------- */

      const changeListeners = new Set();
      let sampleTimer = 0;
      let samplerUsers = 0; // the popup and the limiter (OW-92) are the only two callers
      let lastSampleMB = null;

      const sampleOnce = () => {
        const value = memoryMB();
        if (value != null) {
          lastSampleMB = value;
          for (const listener of changeListeners) {
            try {
              listener({ totalMB: value, kind: "sample" });
            } catch (_) {}
          }
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
      let trimDone = false;
      let lastInputAt = 0;

      const clearTrimTimers = () => {
        clearTimer(trimTimer);
        clearTimer(trimMaxTimer);
        trimTimer = 0;
        trimMaxTimer = 0;
      };

      const trimAllowed = () => !disposed && !trimDone && prefBool(PREF.STARTUP_TRIM, true);

      function armTrimQuietTimer() {
        if (!trimAllowed()) return;
        clearTimer(trimTimer);
        trimTimer = setTimer(runTrimIfQuiet, TRIM_QUIET_MS);
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
        const idle =
          typeof window.requestIdleCallback === "function"
            ? window.requestIdleCallback
            : (cb) => setTimer(cb, TRIM_IDLE_TIMEOUT_MS);
        try {
          idle(
            () => {
              if (!trimAllowed()) return;
              trimDone = true;
              clearTrimTimers();
              void runLevel1();
            },
            { timeout: TRIM_IDLE_TIMEOUT_MS },
          );
        } catch (_) {
          trimDone = true;
          clearTrimTimers();
          void runLevel1();
        }
      }

      const onUserInput = () => {
        lastInputAt = Date.now();
        if (!trimAllowed()) return;
        armTrimQuietTimer();
      };

      for (const type of INPUT_EVENTS) {
        window.addEventListener(type, onUserInput, { capture: true, passive: true });
        onCleanup(() => {
          try {
            window.removeEventListener(type, onUserInput, { capture: true, passive: true });
          } catch (_) {}
        });
      }

      function scheduleStartupTrim() {
        if (!trimAllowed()) return;
        clearTrimTimers();
        armTrimQuietTimer();
        trimMaxTimer = setTimer(() => {
          // The ceiling: if the browser was never quiet for 90 s (a first-run session with lots of input), one trim
          // still happens once, and never again.
          trimMaxTimer = 0;
          if (!trimAllowed()) return;
          trimDone = true;
          clearTrimTimers();
          void runLevel1();
        }, TRIM_MAX_WAIT_MS);
      }

      onCleanup(clearTrimTimers);

      /* ---------------- public API ---------------- */

      let disposed = false;
      const api = {
        memoryMB,
        runLevel1,
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
      window.addEventListener("unload", () => api.destroy(), { once: true });

      // A build without requestProcInfo has a memory meter that can never answer: say so once and stay out of the way
      // (the plan's B2.1). Level 1 is still useful on its own, so the module keeps running rather than disabling
      // everything.
      probeInfo = readProcInfo();
      if (!probeInfo) {
        memorySupport = false;
        warn(
          "this build does not expose ChromeUtils.requestProcInfo(); the RAM reading is unavailable, freeing memory still works",
        );
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
