# additional/video/content

Owner and local file guide for Extended 3.0.0. Original Zentral reference: 1.1.0.

| File                        | Responsibility                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| `ZentralVideoActor.sys.mjs` | Versioned Gecko window actor classes and content-side media/renderer implementation with    |
| `ZentralVideoBasicFrame.js` | Simpler frame-message fallback for source discovery, playback controls and caption watching |
| `ZentralVideoFrame.js`      | Content frame-message implementation for discovery/control/captions and authorized sidebar  |

Entrypoints and dependencies are declared in `loader/ZentralCatalog.js`. Load registration-only sources through the loader, and keep cleanup in the owning feature. Read the nearest parent README and `docs/BASE-PATCHES.md` before changing cross-owner behavior.
