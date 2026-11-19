# Zentral Notes — Performance & Resource Hygiene Audit (T4.2)

## Scope & Guarantees

- **Zero polling:** Neither `additional/notes/ZentralNotes.uc.js` nor `additional/notes/calendar/ZentralNotesCalendar.js` uses `setInterval` (none / zero). All scheduled wakes use bounded one-shot `setTimeout` timers aligned to the next real deadline (autosave idle/max-wait, next minute boundary while a time-sensitive view is visible, next reminder stage deadline, or ephemeral toast/hover hide).
- **Zero persistent background messaging channels:** Neither file creates `BroadcastChannel` or `WebSocket` instances. Cross-window synchronization uses Gecko's `Services.obs` topic (`zentral-notes-changed`) registered inside the window's `onCleanup` lifecycle.
- **Deterministic teardown:** `sheet.close()`, `sheet.destroy()`, `reminders.dispose()`, `store.close()`, and `start()` window unload cleanup cancel pending timers, animation frames, `ResizeObserver`s, `MutationObserver`s, DOM event listeners, and Gecko observers via a single centralized resource registry (`createResourceRegistry`).

## Active Timer, Listener & Observer Registry

Every active resource category owned by Notes & Calendar is catalogued in `ACTIVE_RESOURCE_INVENTORY` (`additional/notes/ZentralNotes.uc.js`) and audited by `tests/notes-perf-resource-audit.test.cjs`:

| Resource ID | File | Kind | Scope | Owner / Teardown |
| --- | --- | --- | --- | --- |
| `store.autosave` | `ZentralNotes.uc.js` | `setTimeout` | `store` | `createStore.close()` |
| `timeTick.minuteWake` | `ZentralNotes.uc.js` | `setTimeout` | `window` | `start().onCleanup()` |
| `timeTick.visibilityWake` | `ZentralNotes.uc.js` | `listener+Services.obs` | `window/document` | `start().onCleanup()` |
| `reminders.scheduler` | `ZentralNotesCalendar.js` | `setTimeout` | `window` | `reminders.dispose()` |
| `sheet.openWindowPointer` | `ZentralNotes.uc.js` | `window.addEventListener` | `sheet:open` | `sheet.close()` & `sheet.destroy()` |
| `sheet.popupGuard` | `ZentralNotes.uc.js` | `window.addEventListener` | `sheet` | `sheet.destroy()` |
| `sheet.splitAndFitRO` | `ZentralNotes.uc.js` | `ResizeObserver` | `sheet` | `sheet.destroy()` |
| `sheet.dialogCardRO` | `ZentralNotes.uc.js` | `ResizeObserver` | `sheet:dialog` | `closeDialog()`, `sheet.close()` & `sheet.destroy()` |
| `sheet.parentPanelMO` | `ZentralNotes.uc.js` | `MutationObserver` | `sheet:open` | `unwatchParentPanelHidden()`, `sheet.close()` & `sheet.destroy()` |
| `sheet.debouncedTimersAndRafs` | `ZentralNotes.uc.js` | `setTimeout+rAF` | `sheet:open` | `cancelAllAsync()` in `sheet.close()` & `sheet.destroy()` |
| `sheet.readHoldActions` | `ZentralNotes.uc.js` | `setTimeout` | `sheet:read` | `resetRead()`, `sheet.close()` & `sheet.destroy()` |
| `adapter.barWatch` | `ZentralNotes.uc.js` | `ResizeObserver+MutationObserver+listener` | `sheet:open` | `adapter.watch()` unwatch on `sheet.close()` |
| `adapter.slotReserveRetry` | `ZentralNotes.uc.js` | `setTimeout+rAF` | `window:slot` | `releaseSlot()` |
| `host.prefsAndServicesObs` | `ZentralNotes.uc.js` | `Services.prefs+Services.obs` | `window` | `start().onCleanup()` |
| `host.zenAndAgendaSidebar` | `ZentralNotes.uc.js` | `setTimeout+tabListeners` | `window:sidebar` | `start().onCleanup()` & `bindZen`/`bindAgenda` |
| `host.hoverCardAndToast` | `ZentralNotes.uc.js` | `setTimeout` | `window:ephemeral` | `start().onCleanup()` |

## Automated Verification

- `tests/notes-perf-resource-audit.test.cjs` verifies:
  1. Zero `setInterval`, `BroadcastChannel`, or `WebSocket` usage across Notes and Calendar sources.
  2. `createResourceRegistry` tracks and disposes listeners, timers, rAF callbacks, and observers without leaks.
  3. Repeated sheet open/close cycles, dialog open/close cycles, and full `sheet.destroy()` return active resource counts to zero.
  4. `tests/resize-perf.test.cjs`, `tests/notes-perf-budget.test.cjs`, `tests/notes-agenda-dom-perf.test.cjs`, `tests/notes-calendar-render-perf.test.cjs`, and `tests/notes-missed-digest-perf.test.cjs` enforce CPU and DOM budgets.
