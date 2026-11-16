# tools

Owner and local file guide for Extended 3.3.184. Original Zentral reference: 1.1.0.

| File                    | Responsibility                        |
| ----------------------- | ------------------------------------- |
| `build-preferences.cjs` | Local source/contract; see its header |
| `update-provenance.py`  | Local source/contract; see its header |

Entrypoints and dependencies are declared in `loader/ZentralCatalog.js`. Load registration-only sources through the loader, and keep cleanup in the owning feature. Read the nearest parent README and `docs/BASE-PATCHES.md` before changing cross-owner behavior.

## build-standalone.cjs

Builds the Sine-installable standalone packages (`additional/**/standalone.json`). `--check` fails if generated files are stale; `--bump` raises the patch version when content changed. Run `node tests/standalone.test.cjs` after. See `docs/SINE-MODULAR-INSTALL.md`.

## sync-version.cjs

Keeps the main mod and every standalone module on one version (rule in `AGENTS.md`, "Version bumps"). Without arguments it raises every version marker (root `theme.json`, `UPSTREAM.json`, loader headers, the settings badge, `INSTALL.md`, `.github/README.md`, the local guide READMEs and every `additional/**/standalone.json`) to the highest version found; `--set X.Y.Z` picks the version; `--check` only reports drift. Run it between `build-standalone.cjs --bump` and a second `build-standalone.cjs`, which regenerates the bundles. `tests/version-sync.test.cjs` fails while anything lags behind.

## audit-standalone.cjs

Informational dependency report for standalone-capable modules (foreign prefs, attributes, CSS variables, other files styling a module's attributes). The build enforces the hard checks; run this when adding or changing a standalone module.

## audit-notes-settings-layout.cjs

Measures the Notes settings dialogs (Quick settings, every tab of Settings, Toolbar buttons, Keyboard shortcuts, the table creator, the code language list) in a headless Chromium, for every text size from 8 to 40 px, sheets from 240 to 700 px wide, a short and a tall sheet, and scrollbars that do and do not take room. It fails when two items share pixels, an item sticks out of its row or the card, text is wider than its button, a list needs a sideways scrollbar, or the controls of one row are spread over two lines. Not part of `node tests/run-all.cjs` and not run by CI: it needs a browser, installed outside the repository (`mkdir /tmp/ch && cd /tmp/ch && npm i @sparticuz/chromium puppeteer-core`, then `AWS_EXECUTION_ENV=AWS_Lambda_nodejs22.x NODE_PATH=/tmp/ch/node_modules node tools/audit-notes-settings-layout.cjs`; about a quarter of an hour for the whole grid of 240 cells, `--fonts 13,28 --widths 420` for a part of it, `--details` to list the findings, `--shots DIR` for pictures, `--css FILE --js FILE` to measure another version). Run it after changing the style of a dialog; `tests/notes-settings-layout.test.cjs` holds in place what the result rests on (the cascade for the real elements, one unit per row) but cannot measure. Zen draws with Gecko and this measures Blink: see the header of the file for what that does and does not cover.

## audit-notes-calendar-fit.cjs

Measures the size of the Notes calendar (`OW-03`) in a headless Chromium: for text sizes 8 to 28 px, sheets 330 to 1000 px high and 620 or 1100 px wide (panes side by side, one above the other, or as tabs) and scrollbars that do and do not take room, it draws Month, Week and Day with the size on **Fit**, adds and removes all-day items, limits the hours to 08:00–20:00, and makes the sheet lower and higher again. It fails when fitted hours scroll, when a timeline scrolls although its hours are higher than the smallest ones, when room stays empty under the last hour, when the timeline has no height, when the title of an event or a line of a Month cell is cut off, when the Month grid begins above the pane or its weeks differ in height, when a resize or an update leaves something else than a fresh draw gives, or when the page reports an error. Not part of `node tests/run-all.cjs` and not run by CI: it needs a browser, installed outside the repository as for the settings audit (`AWS_EXECUTION_ENV=AWS_Lambda_nodejs22.x NODE_PATH=/tmp/ch/node_modules node tools/audit-notes-calendar-fit.cjs`; about five minutes for the whole grid of 160 cells, `--fonts 13 --widths 1100 --heights 560,720` for a part of it, `--details` to list what was measured in every cell, `--shots DIR` for pictures, `--css FILE --js FILE --calendar FILE` to measure another version). Run it after changing the calendar's layout or its style; `tests/notes-calendar-scale.test.cjs` holds the rules in place (the fitted hour, the lines of a Month cell, the cascade for the real elements) but has no layout engine. Zen draws with Gecko and this measures Blink: see the header of the file.
