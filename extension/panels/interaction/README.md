# extension/panels/interaction

Owner and local file guide for Extended 3.1.3. Original Zentral reference: 1.1.0.

| File                          | Responsibility                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| `ZentralPanelAudio.js`        | Tracks owned panel media controllers, builds native mute/unmute controls and performs bounded   |
| `ZentralPanelHover.js`        | Owns extended panel hover reveal/hide, pinned offscreen geometry, edge/pill reveal controls and |
| `ZentralPanelInput.js`        | Scopes panel pointer/navigation/context-menu input and delegates native Back/Forward commands   |
| `ZentralPanelPopupRouting.js` | Optional adapter for opening links/popups into owned panels while delegating normal browser     |

Entrypoints and dependencies are declared in `loader/ZentralCatalog.js`. Load registration-only sources through the loader, and keep cleanup in the owning feature. Read the nearest parent README and `docs/BASE-PATCHES.md` before changing cross-owner behavior.
