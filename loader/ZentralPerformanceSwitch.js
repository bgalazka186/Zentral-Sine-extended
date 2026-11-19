// <Zentral> shared pause switch: "is the user gaming? then stop doing background work".
// <owner>Every module with a repeating timer: the video preview, the widgets, RSS, Notes, the panel fallback poll, and
//   ZentralBoost, which is what turns it on and off. Owned by `additional/boost/ZentralBoost.uc.js`, embedded in its
//   standalone build and loaded once by the runtime in the full pack.
// <contract>`paused` is a boolean, `subscribe(fn)` returns an unsubscribe function and is called synchronously on every
//   change, `setPaused(bool)` is idempotent, and `snapshot()` says what changed when. A module subscribes at start and
//   re-arms its timers itself: nothing here touches a timer, a pref or the DOM, so the switch is testable on its own.
// <cleanup>None of its own. `reset()` exists for a test and for a full pack being torn down while paused.
//
// OW-94 (plan B7.1): the plan asks for `ZentralRuntime.performance = { paused, setPaused, onChange }`. A getter for
// `paused` on a shared object would be a lie the moment a module cached it, so `paused` is a method (`isPaused()`) and
// `snapshot()` carries the value; both names the plan used (`setPaused`, `onChange`) are kept verbatim.
//
// The one rule that matters: a subscribed module must NOT re-arm while paused, and must re-arm when it resumes. A
// module that ignores the switch is not made slower by it — it is simply not paused, which is what the test in
// `tests/ow-94-pause.test.cjs` refuses to let happen silently.
(function () {
  "use strict";

  function createPerformanceSwitch({ now = () => Date.now() } = {}) {
    let paused = false;
    let lastChangeAt = 0;
    let changes = 0;
    const listeners = new Set();

    const snapshot = () => ({ paused, changes, lastChangeAt });

    function setPaused(next) {
      const target = Boolean(next);
      if (target === paused) return snapshot();
      paused = target;
      changes += 1;
      lastChangeAt = now();
      // A copy: a listener may unsubscribe itself (or another) while being notified.
      for (const listener of [...listeners]) {
        try {
          listener(paused, snapshot());
        } catch (error) {
          try {
            console.warn("[Zentral] pause listener failed", error);
          } catch (_) {}
        }
      }
      return snapshot();
    }

    function subscribe(listener) {
      if (typeof listener !== "function") return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    return Object.freeze({
      isPaused: () => paused,
      setPaused,
      // `toggle()` is what the Boost switch and the shortcut call: both want "the other state", not "true".
      toggle: () => setPaused(!paused),
      subscribe,
      // The plan's name for `subscribe`. Kept because a module written from the plan's text will call it.
      onChange: subscribe,
      snapshot,
      listenerCount: () => listeners.size,
      reset() {
        paused = false;
        changes = 0;
        lastChangeAt = 0;
        listeners.clear();
      },
    });
  }

  window.ZentralPerformanceSwitch = { create: createPerformanceSwitch };
})();
