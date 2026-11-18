# Menu baseline (OW-77)

Measured by `tools/audit-notes-menus.cjs` in headless Chromium 153.
Each cell is one menu at one text size, sheet size and scrollbar kind; `height` is the menu's own box and `rows` the
smallest row. Regenerate with `--baseline`; check with `--compare docs/MENU_BASELINE.md`.

| menu | text | sheet | scrollbar | rows | height (px) | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| calendar: View | 13 px | 1100x560 | 0 | 5 | 157.5 | ok |
| calendar: Size | 13 px | 1100x560 | 0 | 1 | 129.47 | ok |
| calendar: Snap | 13 px | 1100x560 | 0 | 5 | 157.5 | ok |
| calendar: Days | 13 px | 1100x560 | 0 | 4 | 128 | ok |
| calendar: Kind filter | 13 px | 1100x560 | 0 | 3 | 98.5 | ok |
| calendar: Category filter | 13 px | 1100x560 | 0 | 6 | 187 | ok |
| calendar: Tools | 13 px | 1100x560 | 0 | 6 | 196 | ok |
| calendar: month cell | 13 px | 1100x560 | 0 | 10 | 343.5 | ok |
| calendar: calendar item | 13 px | 1100x560 | 0 | 8 | 255 | ok |
| notes: + menu | 13 px | 1100x560 | 0 | 6 | 196 | ok |
| notes: note row | 13 px | 1100x560 | 0 | 13 | 311 | ok |
| calendar: View | 13 px | 1100x720 | 0 | 5 | 157.5 | ok |
| calendar: Size | 13 px | 1100x720 | 0 | 1 | 129.47 | ok |
| calendar: Snap | 13 px | 1100x720 | 0 | 5 | 157.5 | ok |
| calendar: Days | 13 px | 1100x720 | 0 | 4 | 128 | ok |
| calendar: Kind filter | 13 px | 1100x720 | 0 | 3 | 98.5 | ok |
| calendar: Category filter | 13 px | 1100x720 | 0 | 6 | 187 | ok |
| calendar: Tools | 13 px | 1100x720 | 0 | 6 | 196 | ok |
| calendar: month cell | 13 px | 1100x720 | 0 | 10 | 343.5 | ok |
| calendar: calendar item | 13 px | 1100x720 | 0 | 8 | 255 | ok |
| notes: + menu | 13 px | 1100x720 | 0 | 6 | 196 | ok |
| notes: note row | 13 px | 1100x720 | 0 | 13 | 411.5 | ok |
| calendar: View | 13 px | 620x560 | 0 | 5 | 157.5 | ok |
| calendar: Size | 13 px | 620x560 | 0 | 4 | 166.5 | ok |
| calendar: Snap | 13 px | 620x560 | 0 | 5 | 157.5 | ok |
| calendar: Days | 13 px | 620x560 | 0 | 4 | 128 | ok |
| calendar: Kind filter | 13 px | 620x560 | 0 | 3 | 98.5 | ok |
| calendar: Category filter | 13 px | 620x560 | 0 | 6 | 187 | ok |
| calendar: Tools | 13 px | 620x560 | 0 | 6 | 196 | ok |
| calendar: month cell | 13 px | 620x560 | 0 | — | — | not applicable |
| calendar: calendar item | 13 px | 620x560 | 0 | — | — | not applicable |
| notes: + menu | 13 px | 620x560 | 0 | 6 | 196 | ok |
| notes: note row | 13 px | 620x560 | 0 | 13 | 311 | ok |
| calendar: View | 13 px | 620x720 | 0 | 5 | 157.5 | ok |
| calendar: Size | 13 px | 620x720 | 0 | 1 | 129.47 | ok |
| calendar: Snap | 13 px | 620x720 | 0 | 5 | 157.5 | ok |
| calendar: Days | 13 px | 620x720 | 0 | 4 | 128 | ok |
| calendar: Kind filter | 13 px | 620x720 | 0 | 3 | 98.5 | ok |
| calendar: Category filter | 13 px | 620x720 | 0 | 6 | 187 | ok |
| calendar: Tools | 13 px | 620x720 | 0 | 6 | 196 | ok |
| calendar: month cell | 13 px | 620x720 | 0 | 10 | 343.5 | ok |
| calendar: calendar item | 13 px | 620x720 | 0 | 8 | 255 | ok |
| notes: + menu | 13 px | 620x720 | 0 | 6 | 196 | ok |
| notes: note row | 13 px | 620x720 | 0 | 13 | 411.5 | ok |
| calendar: View | 20 px | 1100x560 | 0 | 5 | 210 | ok |
| calendar: Size | 20 px | 1100x560 | 0 | 1 | 169.61 | ok |
| calendar: Snap | 20 px | 1100x560 | 0 | 5 | 210 | ok |
| calendar: Days | 20 px | 1100x560 | 0 | 4 | 170 | ok |
| calendar: Kind filter | 20 px | 1100x560 | 0 | 3 | 130 | ok |
| calendar: Category filter | 20 px | 1100x560 | 0 | 6 | 250 | ok |
| calendar: Tools | 20 px | 1100x560 | 0 | 6 | 259 | ok |
| calendar: month cell | 20 px | 1100x560 | 0 | 10 | 459 | ok |
| calendar: calendar item | 20 px | 1100x560 | 0 | 8 | 339 | ok |
| notes: + menu | 20 px | 1100x560 | 0 | 6 | 259 | ok |
| notes: note row | 20 px | 1100x560 | 0 | 13 | 311 | ok |
| calendar: View | 20 px | 1100x720 | 0 | 5 | 210 | ok |
| calendar: Size | 20 px | 1100x720 | 0 | 1 | 169.61 | ok |
| calendar: Snap | 20 px | 1100x720 | 0 | 5 | 210 | ok |
| calendar: Days | 20 px | 1100x720 | 0 | 4 | 170 | ok |
| calendar: Kind filter | 20 px | 1100x720 | 0 | 3 | 130 | ok |
| calendar: Category filter | 20 px | 1100x720 | 0 | 6 | 250 | ok |
| calendar: Tools | 20 px | 1100x720 | 0 | 6 | 259 | ok |
| calendar: month cell | 20 px | 1100x720 | 0 | 10 | 459 | ok |
| calendar: calendar item | 20 px | 1100x720 | 0 | 8 | 339 | ok |
| notes: + menu | 20 px | 1100x720 | 0 | 6 | 259 | ok |
| notes: note row | 20 px | 1100x720 | 0 | 13 | 471 | ok |
| calendar: View | 20 px | 620x560 | 0 | 5 | 210 | ok |
| calendar: Size | 20 px | 620x560 | 0 | 4 | 219 | ok |
| calendar: Snap | 20 px | 620x560 | 0 | 5 | 210 | ok |
| calendar: Days | 20 px | 620x560 | 0 | 4 | 170 | ok |
| calendar: Kind filter | 20 px | 620x560 | 0 | 3 | 130 | ok |
| calendar: Category filter | 20 px | 620x560 | 0 | 6 | 250 | ok |
| calendar: Tools | 20 px | 620x560 | 0 | 6 | 259 | ok |
| calendar: month cell | 20 px | 620x560 | 0 | — | — | not applicable |
| calendar: calendar item | 20 px | 620x560 | 0 | — | — | not applicable |
| notes: + menu | 20 px | 620x560 | 0 | 6 | 259 | ok |
| notes: note row | 20 px | 620x560 | 0 | 13 | 311 | ok |
| calendar: View | 20 px | 620x720 | 0 | 5 | 210 | ok |
| calendar: Size | 20 px | 620x720 | 0 | 1 | 169.61 | ok |
| calendar: Snap | 20 px | 620x720 | 0 | 5 | 210 | ok |
| calendar: Days | 20 px | 620x720 | 0 | 4 | 170 | ok |
| calendar: Kind filter | 20 px | 620x720 | 0 | 3 | 130 | ok |
| calendar: Category filter | 20 px | 620x720 | 0 | 6 | 250 | ok |
| calendar: Tools | 20 px | 620x720 | 0 | 6 | 259 | ok |
| calendar: month cell | 20 px | 620x720 | 0 | 10 | 459 | ok |
| calendar: calendar item | 20 px | 620x720 | 0 | 8 | 339 | ok |
| notes: + menu | 20 px | 620x720 | 0 | 6 | 259 | ok |
| notes: note row | 20 px | 620x720 | 0 | 13 | 471 | ok |
| calendar: View | 28 px | 1100x560 | 0 | 5 | 270 | ok |
| calendar: Size | 28 px | 1100x560 | 0 | 1 | 215.44 | ok |
| calendar: Snap | 28 px | 1100x560 | 0 | 5 | 270 | ok |
| calendar: Days | 28 px | 1100x560 | 0 | 4 | 218 | ok |
| calendar: Kind filter | 28 px | 1100x560 | 0 | 3 | 166 | ok |
| calendar: Category filter | 28 px | 1100x560 | 0 | 6 | 322 | ok |
| calendar: Tools | 28 px | 1100x560 | 0 | 6 | 331 | ok |
| calendar: month cell | 28 px | 1100x560 | 0 | 10 | 591 | ok |
| calendar: calendar item | 28 px | 1100x560 | 0 | 8 | 435 | ok |
| notes: + menu | 28 px | 1100x560 | 0 | 6 | 331 | ok |
| notes: note row | 28 px | 1100x560 | 0 | 13 | 311 | ok |
| calendar: View | 28 px | 1100x720 | 0 | 5 | 270 | ok |
| calendar: Size | 28 px | 1100x720 | 0 | 1 | 215.44 | ok |
| calendar: Snap | 28 px | 1100x720 | 0 | 5 | 270 | ok |
| calendar: Days | 28 px | 1100x720 | 0 | 4 | 218 | ok |
| calendar: Kind filter | 28 px | 1100x720 | 0 | 3 | 166 | ok |
| calendar: Category filter | 28 px | 1100x720 | 0 | 6 | 322 | ok |
| calendar: Tools | 28 px | 1100x720 | 0 | 6 | 331 | ok |
| calendar: month cell | 28 px | 1100x720 | 0 | 10 | 591 | ok |
| calendar: calendar item | 28 px | 1100x720 | 0 | 8 | 435 | ok |
| notes: + menu | 28 px | 1100x720 | 0 | 6 | 331 | ok |
| notes: note row | 28 px | 1100x720 | 0 | 13 | 471 | ok |
| calendar: View | 28 px | 620x560 | 0 | 5 | 270 | ok |
| calendar: Size | 28 px | 620x560 | 0 | 4 | 279 | ok |
| calendar: Snap | 28 px | 620x560 | 0 | 5 | 270 | ok |
| calendar: Days | 28 px | 620x560 | 0 | 4 | 218 | ok |
| calendar: Kind filter | 28 px | 620x560 | 0 | 3 | 166 | ok |
| calendar: Category filter | 28 px | 620x560 | 0 | 6 | 322 | ok |
| calendar: Tools | 28 px | 620x560 | 0 | 6 | 283 | ok |
| calendar: month cell | 28 px | 620x560 | 0 | — | — | not applicable |
| calendar: calendar item | 28 px | 620x560 | 0 | — | — | not applicable |
| notes: + menu | 28 px | 620x560 | 0 | 6 | 331 | ok |
| notes: note row | 28 px | 620x560 | 0 | 13 | 311 | ok |
| calendar: View | 28 px | 620x720 | 0 | 5 | 270 | ok |
| calendar: Size | 28 px | 620x720 | 0 | 4 | 279 | ok |
| calendar: Snap | 28 px | 620x720 | 0 | 5 | 270 | ok |
| calendar: Days | 28 px | 620x720 | 0 | 4 | 218 | ok |
| calendar: Kind filter | 28 px | 620x720 | 0 | 3 | 166 | ok |
| calendar: Category filter | 28 px | 620x720 | 0 | 6 | 322 | ok |
| calendar: Tools | 28 px | 620x720 | 0 | 6 | 331 | ok |
| calendar: month cell | 28 px | 620x720 | 0 | — | — | not applicable |
| calendar: calendar item | 28 px | 620x720 | 0 | — | — | not applicable |
| notes: + menu | 28 px | 620x720 | 0 | 6 | 331 | ok |
| notes: note row | 28 px | 620x720 | 0 | 13 | 471 | ok |
| calendar: View | 13 px | 1100x560 | 17 | 5 | 157.5 | ok |
| calendar: Size | 13 px | 1100x560 | 17 | 1 | 129.47 | ok |
| calendar: Snap | 13 px | 1100x560 | 17 | 5 | 157.5 | ok |
| calendar: Days | 13 px | 1100x560 | 17 | 4 | 128 | ok |
| calendar: Kind filter | 13 px | 1100x560 | 17 | 3 | 98.5 | ok |
| calendar: Category filter | 13 px | 1100x560 | 17 | 6 | 187 | ok |
| calendar: Tools | 13 px | 1100x560 | 17 | 6 | 196 | ok |
| calendar: month cell | 13 px | 1100x560 | 17 | 10 | 343.5 | ok |
| calendar: calendar item | 13 px | 1100x560 | 17 | 8 | 255 | ok |
| notes: + menu | 13 px | 1100x560 | 17 | 6 | 196 | ok |
| notes: note row | 13 px | 1100x560 | 17 | 13 | 311 | ok |
| calendar: View | 13 px | 1100x720 | 17 | 5 | 157.5 | ok |
| calendar: Size | 13 px | 1100x720 | 17 | 1 | 129.47 | ok |
| calendar: Snap | 13 px | 1100x720 | 17 | 5 | 157.5 | ok |
| calendar: Days | 13 px | 1100x720 | 17 | 4 | 128 | ok |
| calendar: Kind filter | 13 px | 1100x720 | 17 | 3 | 98.5 | ok |
| calendar: Category filter | 13 px | 1100x720 | 17 | 6 | 187 | ok |
| calendar: Tools | 13 px | 1100x720 | 17 | 6 | 196 | ok |
| calendar: month cell | 13 px | 1100x720 | 17 | 10 | 343.5 | ok |
| calendar: calendar item | 13 px | 1100x720 | 17 | 8 | 255 | ok |
| notes: + menu | 13 px | 1100x720 | 17 | 6 | 196 | ok |
| notes: note row | 13 px | 1100x720 | 17 | 13 | 411.5 | ok |
| calendar: View | 13 px | 620x560 | 17 | 5 | 157.5 | ok |
| calendar: Size | 13 px | 620x560 | 17 | 4 | 166.5 | ok |
| calendar: Snap | 13 px | 620x560 | 17 | 5 | 157.5 | ok |
| calendar: Days | 13 px | 620x560 | 17 | 4 | 128 | ok |
| calendar: Kind filter | 13 px | 620x560 | 17 | 3 | 98.5 | ok |
| calendar: Category filter | 13 px | 620x560 | 17 | 6 | 187 | ok |
| calendar: Tools | 13 px | 620x560 | 17 | 6 | 196 | ok |
| calendar: month cell | 13 px | 620x560 | 17 | — | — | not applicable |
| calendar: calendar item | 13 px | 620x560 | 17 | — | — | not applicable |
| notes: + menu | 13 px | 620x560 | 17 | 6 | 196 | ok |
| notes: note row | 13 px | 620x560 | 17 | 13 | 311 | ok |
| calendar: View | 13 px | 620x720 | 17 | 5 | 157.5 | ok |
| calendar: Size | 13 px | 620x720 | 17 | 1 | 129.47 | ok |
| calendar: Snap | 13 px | 620x720 | 17 | 5 | 157.5 | ok |
| calendar: Days | 13 px | 620x720 | 17 | 4 | 128 | ok |
| calendar: Kind filter | 13 px | 620x720 | 17 | 3 | 98.5 | ok |
| calendar: Category filter | 13 px | 620x720 | 17 | 6 | 187 | ok |
| calendar: Tools | 13 px | 620x720 | 17 | 6 | 196 | ok |
| calendar: month cell | 13 px | 620x720 | 17 | 10 | 343.5 | ok |
| calendar: calendar item | 13 px | 620x720 | 17 | 8 | 255 | ok |
| notes: + menu | 13 px | 620x720 | 17 | 6 | 196 | ok |
| notes: note row | 13 px | 620x720 | 17 | 13 | 411.5 | ok |
| calendar: View | 20 px | 1100x560 | 17 | 5 | 210 | ok |
| calendar: Size | 20 px | 1100x560 | 17 | 1 | 169.61 | ok |
| calendar: Snap | 20 px | 1100x560 | 17 | 5 | 210 | ok |
| calendar: Days | 20 px | 1100x560 | 17 | 4 | 170 | ok |
| calendar: Kind filter | 20 px | 1100x560 | 17 | 3 | 130 | ok |
| calendar: Category filter | 20 px | 1100x560 | 17 | 6 | 250 | ok |
| calendar: Tools | 20 px | 1100x560 | 17 | 6 | 259 | ok |
| calendar: month cell | 20 px | 1100x560 | 17 | 10 | 459 | ok |
| calendar: calendar item | 20 px | 1100x560 | 17 | 8 | 339 | ok |
| notes: + menu | 20 px | 1100x560 | 17 | 6 | 259 | ok |
| notes: note row | 20 px | 1100x560 | 17 | 13 | 311 | ok |
| calendar: View | 20 px | 1100x720 | 17 | 5 | 210 | ok |
| calendar: Size | 20 px | 1100x720 | 17 | 1 | 169.61 | ok |
| calendar: Snap | 20 px | 1100x720 | 17 | 5 | 210 | ok |
| calendar: Days | 20 px | 1100x720 | 17 | 4 | 170 | ok |
| calendar: Kind filter | 20 px | 1100x720 | 17 | 3 | 130 | ok |
| calendar: Category filter | 20 px | 1100x720 | 17 | 6 | 250 | ok |
| calendar: Tools | 20 px | 1100x720 | 17 | 6 | 259 | ok |
| calendar: month cell | 20 px | 1100x720 | 17 | 10 | 459 | ok |
| calendar: calendar item | 20 px | 1100x720 | 17 | 8 | 339 | ok |
| notes: + menu | 20 px | 1100x720 | 17 | 6 | 259 | ok |
| notes: note row | 20 px | 1100x720 | 17 | 13 | 471 | ok |
| calendar: View | 20 px | 620x560 | 17 | 5 | 210 | ok |
| calendar: Size | 20 px | 620x560 | 17 | 4 | 219 | ok |
| calendar: Snap | 20 px | 620x560 | 17 | 5 | 210 | ok |
| calendar: Days | 20 px | 620x560 | 17 | 4 | 170 | ok |
| calendar: Kind filter | 20 px | 620x560 | 17 | 3 | 130 | ok |
| calendar: Category filter | 20 px | 620x560 | 17 | 6 | 250 | ok |
| calendar: Tools | 20 px | 620x560 | 17 | 6 | 259 | ok |
| calendar: month cell | 20 px | 620x560 | 17 | — | — | not applicable |
| calendar: calendar item | 20 px | 620x560 | 17 | — | — | not applicable |
| notes: + menu | 20 px | 620x560 | 17 | 6 | 259 | ok |
| notes: note row | 20 px | 620x560 | 17 | 13 | 311 | ok |
| calendar: View | 20 px | 620x720 | 17 | 5 | 210 | ok |
| calendar: Size | 20 px | 620x720 | 17 | 1 | 169.61 | ok |
| calendar: Snap | 20 px | 620x720 | 17 | 5 | 210 | ok |
| calendar: Days | 20 px | 620x720 | 17 | 4 | 170 | ok |
| calendar: Kind filter | 20 px | 620x720 | 17 | 3 | 130 | ok |
| calendar: Category filter | 20 px | 620x720 | 17 | 6 | 250 | ok |
| calendar: Tools | 20 px | 620x720 | 17 | 6 | 259 | ok |
| calendar: month cell | 20 px | 620x720 | 17 | 10 | 459 | ok |
| calendar: calendar item | 20 px | 620x720 | 17 | 8 | 339 | ok |
| notes: + menu | 20 px | 620x720 | 17 | 6 | 259 | ok |
| notes: note row | 20 px | 620x720 | 17 | 13 | 471 | ok |
| calendar: View | 28 px | 1100x560 | 17 | 5 | 270 | ok |
| calendar: Size | 28 px | 1100x560 | 17 | 1 | 215.44 | ok |
| calendar: Snap | 28 px | 1100x560 | 17 | 5 | 270 | ok |
| calendar: Days | 28 px | 1100x560 | 17 | 4 | 218 | ok |
| calendar: Kind filter | 28 px | 1100x560 | 17 | 3 | 166 | ok |
| calendar: Category filter | 28 px | 1100x560 | 17 | 6 | 322 | ok |
| calendar: Tools | 28 px | 1100x560 | 17 | 6 | 331 | ok |
| calendar: month cell | 28 px | 1100x560 | 17 | 10 | 591 | ok |
| calendar: calendar item | 28 px | 1100x560 | 17 | 8 | 435 | ok |
| notes: + menu | 28 px | 1100x560 | 17 | 6 | 331 | ok |
| notes: note row | 28 px | 1100x560 | 17 | 13 | 311 | ok |
| calendar: View | 28 px | 1100x720 | 17 | 5 | 270 | ok |
| calendar: Size | 28 px | 1100x720 | 17 | 1 | 215.44 | ok |
| calendar: Snap | 28 px | 1100x720 | 17 | 5 | 270 | ok |
| calendar: Days | 28 px | 1100x720 | 17 | 4 | 218 | ok |
| calendar: Kind filter | 28 px | 1100x720 | 17 | 3 | 166 | ok |
| calendar: Category filter | 28 px | 1100x720 | 17 | 6 | 322 | ok |
| calendar: Tools | 28 px | 1100x720 | 17 | 6 | 331 | ok |
| calendar: month cell | 28 px | 1100x720 | 17 | 10 | 591 | ok |
| calendar: calendar item | 28 px | 1100x720 | 17 | 8 | 435 | ok |
| notes: + menu | 28 px | 1100x720 | 17 | 6 | 331 | ok |
| notes: note row | 28 px | 1100x720 | 17 | 13 | 471 | ok |
| calendar: View | 28 px | 620x560 | 17 | 5 | 270 | ok |
| calendar: Size | 28 px | 620x560 | 17 | 4 | 279 | ok |
| calendar: Snap | 28 px | 620x560 | 17 | 5 | 270 | ok |
| calendar: Days | 28 px | 620x560 | 17 | 4 | 218 | ok |
| calendar: Kind filter | 28 px | 620x560 | 17 | 3 | 166 | ok |
| calendar: Category filter | 28 px | 620x560 | 17 | 6 | 322 | ok |
| calendar: Tools | 28 px | 620x560 | 17 | 6 | 283 | ok |
| calendar: month cell | 28 px | 620x560 | 17 | — | — | not applicable |
| calendar: calendar item | 28 px | 620x560 | 17 | — | — | not applicable |
| notes: + menu | 28 px | 620x560 | 17 | 6 | 331 | ok |
| notes: note row | 28 px | 620x560 | 17 | 13 | 311 | ok |
| calendar: View | 28 px | 620x720 | 17 | 5 | 270 | ok |
| calendar: Size | 28 px | 620x720 | 17 | 4 | 279 | ok |
| calendar: Snap | 28 px | 620x720 | 17 | 5 | 270 | ok |
| calendar: Days | 28 px | 620x720 | 17 | 4 | 218 | ok |
| calendar: Kind filter | 28 px | 620x720 | 17 | 3 | 166 | ok |
| calendar: Category filter | 28 px | 620x720 | 17 | 6 | 322 | ok |
| calendar: Tools | 28 px | 620x720 | 17 | 6 | 331 | ok |
| calendar: month cell | 28 px | 620x720 | 17 | — | — | not applicable |
| calendar: calendar item | 28 px | 620x720 | 17 | — | — | not applicable |
| notes: + menu | 28 px | 620x720 | 17 | 6 | 331 | ok |
| notes: note row | 28 px | 620x720 | 17 | 13 | 471 | ok |
