# Pure geometry and URL checks

`ZentralPanelMath.js` adapts the mathematical ideas in original Zentral 1.1.0's separate geometry helper. It registers a factory under the shared loader and exports the same pure object to Node tests. It has no DOM, timers, browser startup or global geometry singleton.

Functions clamp finite rectangles, resize from edges/corners, compute edge docks/snap targets, choose a reachable pill side, validate saved placement, generate scoped keys and validate supported start URLs. Small viewports reduce minimum dimensions rather than overflowing impossibly. All active panel placement uses this implementation; the original upstream helper and its embedded fallback are reference-only.

Tests are in `tests/panel-math.test.cjs`. Base source/attribution and intentional differences are recorded in `docs/BASE-PATCHES.md` and `UPSTREAM.json`.
