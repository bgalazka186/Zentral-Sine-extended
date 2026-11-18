#!/usr/bin/env node
"use strict";
/* Measures every Notes and calendar MENU in a real layout engine (OW-77).
 *
 * OW-75 was decided by measuring the calendar's Tools menu by hand in a headless Chromium: 18 rows, 568 px at 13 px
 * text, 619 px with a scrollbar at 20 px. Those numbers lived in the roadmap's prose, not in anything anyone could run
 * tomorrow — and the owner's word for the defect was "unreadable", which is measurable. A fake DOM has no layout, so
 * none of this can live in `tests/run-all.cjs`.
 *
 * This script opens the real sheet (ZentralNotes.uc.js + ZentralNotes.css + the calendar module, nothing mocked but the
 * disk) and opens every menu it can reach, then measures each one:
 *
 *   row-tight        a row is shorter than the text size allows (its label's box is cut at the top or bottom)
 *   row-tall         a row is more than 2.6x the text size for a single line of label (wasted height, pushes the menu
 *                    past the window)
 *   label-clipped    a label is cut horizontally (scrollWidth > clientWidth with no ellipsis mechanism it declares)
 *   menu-too-tall    the menu is taller than the window it opened into, and cannot scroll
 *   menu-off-window  the menu's box leaves the window, so part of it cannot be reached at all
 *   covers-trigger   the menu hides the button that opened it (the person cannot see what they pressed)
 *   group-no-back    a submenu level has no Back row
 *   group-loses      opening a group lost the level it came from (no Back row reaches it)
 *   empty-menu       a menu opened with no rows
 *   page-error       the page reported an error
 *
 * It prints, per menu and per cell, its height and row height, and writes a baseline to `docs/MENU_BASELINE.md` with
 * `--baseline`. Run with `--compare` to fail when a measurement moves by more than the tolerance.
 *
 * Setup, outside the repository (the versions that were used: @sparticuz/chromium 153, puppeteer-core 25):
 *   mkdir /tmp/ch && cd /tmp/ch && npm i @sparticuz/chromium puppeteer-core
 * Run:
 *   AWS_EXECUTION_ENV=AWS_Lambda_nodejs22.x NODE_PATH=/tmp/ch/node_modules node tools/audit-notes-menus.cjs
 * (AWS_EXECUTION_ENV makes @sparticuz/chromium unpack the libraries its binary needs. With another Chrome or
 * Chromium: CHROME_PATH=/path/to/chrome NODE_PATH=... node tools/audit-notes-menus.cjs.)
 *
 * Options:
 *   --fonts 13,28             text sizes in px                          (default 13,20,28)
 *   --widths 1100,620         sheet widths in px                        (default 1100,620)
 *   --heights 720             sheet heights in px                       (default 560,720)
 *   --scrollbars 0,17         0 = scrollbars that take no room, 17 = classic ones of that width (default 0,17)
 *   --viewport 1500x1300      window size                               (default 1500x1300)
 *   --details                 print every row of every menu
 *   --baseline                write docs/MENU_BASELINE.md from this run
 *   --compare FILE            fail if a menu's height moves by more than --tolerance px from FILE
 *   --tolerance 4             px a menu height may move before --compare fails
 *   --shots DIR               save a screenshot of every menu into DIR
 *
 * Zen draws with Gecko; this measures Blink. What differs between them is the height of a line of text and the width of
 * a glyph, which moves a measurement by a px or two — the verdicts below are written with that in mind (a row is
 * "tight" only when a label is actually cut, not when it is close to the edge).
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes("--" + name);
const option = (name, fallback) => { const at = args.indexOf("--" + name); return at >= 0 && args[at + 1] !== undefined ? args[at + 1] : fallback; };
const numbers = (name, fallback) => String(option(name, fallback)).split(",").map(Number).filter((n) => Number.isFinite(n));
const FONTS = numbers("fonts", "13,20,28");
const WIDTHS = numbers("widths", "1100,620");
const HEIGHTS = numbers("heights", "560,720");
const SCROLLBARS = numbers("scrollbars", "0,17");
const [VIEW_W, VIEW_H] = String(option("viewport", "1500x1300")).split("x").map(Number);
const DETAILS = flag("details");
const BASELINE = flag("baseline");
const COMPARE = option("compare", "");
const TOLERANCE = Number(option("tolerance", "4"));
const SHOTS = option("shots", "");
const BASELINE_PATH = path.join(ROOT, "docs/MENU_BASELINE.md");

function load(name) {
  try { return require(name); } catch (_) {
    console.error(`Cannot load "${name}". Install it outside the repository and point NODE_PATH at it:\n  mkdir /tmp/ch && cd /tmp/ch && npm i @sparticuz/chromium puppeteer-core\n  AWS_EXECUTION_ENV=AWS_Lambda_nodejs22.x NODE_PATH=/tmp/ch/node_modules node tools/audit-notes-menus.cjs`);
    process.exit(2);
  }
}

// ---- the page: the real sheet over a disk that is a Map ---------------------------------------------------------------
const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="sheet.css">
<style>html,body{margin:0;height:100%;background:#1c1b22;color:#eee;font:13px system-ui, sans-serif}
*, *::before, *::after { animation: none !important; transition: none !important; }</style>
</head><body>
<script>
window.ZentralRuntime = { register() {} }; window.__zentralNotesTestSeam = {};
var Services = {}; var ChromeUtils = {};
var module = { exports: {} };
</script>
<script src="calendar.js"></script>
<script>window.C = module.exports; window.__zentralNotesParts = { "notes-calendar": module.exports }; module = undefined;</script>
<script src="notes.js"></script>
<script>
let built = null;
window.local = (key, h, m = 0) => { const d = C.parseYmd(key); d.setHours(h, m, 0, 0); return d.getTime(); };
window.settle = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => requestAnimationFrame(() => setTimeout(done, 0)), 0))));

window.build = async function ({ font, width, height }) {
  const c = window.__zentralNotesTestSeam.core;
  if (built) { built.sheet.destroy(); await built.store.close(); built.host.remove(); built = null; }
  const files = new Map([["/notes/meta.json", { text: JSON.stringify({ calendarTab: "calendar" }), mtime: 1 }]]);
  const io = {
    join: (...parts) => parts.join("/"), filename: (p) => p.split("/").pop(),
    async readUTF8(p) { if (!files.has(p)) throw new Error("NotFound " + p); return files.get(p).text; },
    async writeUTF8(p, text) { files.set(p, { text, mtime: Date.now() }); },
    async remove(p) { files.delete(p); }, async exists(p) { return files.has(p); },
    async children(dir) { return [...files.keys()].filter((p) => p.startsWith(dir + "/")); },
    async stat(p) { return { lastModified: files.get(p)?.mtime || 0 }; }, async restrict() {},
  };
  const rootEl = document.documentElement;
  rootEl.style.setProperty("--zentral-notes-font-size", font + "px");
  rootEl.style.setProperty("--zentral-notes-line-height", "1.6");
  rootEl.setAttribute("zentral-notes-wrap", "on");
  rootEl.setAttribute("zentral-notes-theme", "zentral");
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:20px;top:20px;width:" + width + "px;height:" + height + "px";
  document.body.append(host);
  const area = { left: 20, top: 20, width, height };
  const adapter = { position: "fixed", host, attach: (root) => host.appendChild(root),
    getArea: () => ({ ...area, anchor: "top", docked: true }), watch: () => () => {}, setActive() {}, rewatch() {} };
  const prefs = new Map([[c.PREF.FONT_SIZE, font]]);
  const clock = local("2026-11-18", 10, 30);
  let stamp = clock;
  const store = c.createStore({ io, notify() {}, windowId: "menu-audit", now: () => (stamp += 1000), getDir: async () => "/notes", getMaxSaveMs: () => 1000, setTimer: setTimeout, clearTimer: clearTimeout });
  await store.open();
  store.create("# A note\\n\\nText with a [link](https://example.com) and **bold**.");
  store.create("# A second note\\n\\n- a list item\\n- another");
  store.setMeta({ calendarHolidays: { enabled: true, region: "PL", locales: ["PL"], weekend: "auto", personalDays: [] }, calendarCategories: ["Work", "Home"] });
  const timed = (id, summary, start, end, extra = {}) => store.items.upsert({ id, summary, start: { dateTime: new Date(start).toISOString() }, ...(end ? { end: { dateTime: new Date(end).toISOString() } } : {}), x: { kind: end ? "event" : "reminder", src: "manual", category: extra.category || "" } });
  timed("standup", "Standup", local("2026-11-18", 10), local("2026-11-18", 11), { category: "Work" });
  timed("lunch", "Lunch", local("2026-11-18", 12), local("2026-11-18", 13), { category: "Home" });
  timed("ping", "Ping Alice", local("2026-11-18", 15, 30));
  store.items.upsert({ id: "fair", summary: "Trade fair", start: { date: "2026-11-19" }, end: { date: "2026-11-20" }, x: { kind: "event", src: "manual", category: "Work" } });
  const sheet = c.createSheet({ store, adapter,
    env: { now: () => clock, getPref: (key, fallback) => (prefs.has(key) ? prefs.get(key) : fallback), setPref: (k, v) => prefs.set(k, v), openLink() {}, copyText() {}, exportNote() {}, exportAll() {}, revealFolder() {}, printNote() {} },
    ensureStore: () => store.open() });
  await sheet.open();
  built = { sheet, store, host, area };
  window.root = sheet.root;
  window.store = store;
  [...sheet.root.querySelectorAll("button")].find((b) => b.title === "All notes").click();
  await settle();
  return { surface: sheet.root.querySelector(".zn-calendar-view") ? "calendar" : "notes" };
};

// Every menu this audit knows how to open: a name, and the one action that opens it.
window.MENUS = [
  // ---- the calendar ----------------------------------------------------------------------------------------------
  { name: "calendar: View", kind: "calendar", open: () => click(".zn-calendar-view-select") },
  { name: "calendar: Size", kind: "calendar", open: () => click(".zn-calendar-size-select") },
  { name: "calendar: Snap", kind: "calendar", open: () => click(".zn-calendar-snap-select") },
  { name: "calendar: Days", kind: "calendar", open: () => click(".zn-calendar-days-select") },
  { name: "calendar: Kind filter", kind: "calendar", open: () => click(".zn-calendar-kind-filter") },
  { name: "calendar: Category filter", kind: "calendar", open: () => click(".zn-calendar-category-filter") },
  { name: "calendar: Tools", kind: "calendar", open: () => click(".zn-calendar-tools") },
  { name: "calendar: month cell", kind: "calendar", open: () => rightClick(".zn-cal-month-cell[data-day]") },
  { name: "calendar: calendar item", kind: "calendar", open: () => rightClick(".zn-cal-month-mark") },
  // ---- the notes side ---------------------------------------------------------------------------------------------
  { name: "notes: + menu", kind: "notes", open: () => click(".zn-new-menu") },
  { name: "notes: note row", kind: "notes", open: () => rightClick(".zn-item[data-key^='n:']") },
  // (Quick settings opens a CARD, not a menu: openCard sizes it with fitCard, and the settings-dialog geometry has
  // its own audits. A menu audit that measured it would be measuring a different thing.)
];

// A trigger that is not on screen is NOT a defect: a narrow sheet draws Month as the date-only picker (no cells, no
// marks), and the point of measuring two widths is to see both. It is reported as "not applicable" and counted apart.
class NotApplicable extends Error {}
function need(selector) {
  const el = window.root.querySelector(selector);
  if (!el) throw new NotApplicable(selector);
  return el;
}
function click(selector) {
  need(selector).click();
}
function rightClick(selector) {
  need(selector).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 400, clientY: 260 }));
}
window.NotApplicable = NotApplicable;
// The menus on screen right now (a popover menu and an in-flow one look the same to the person).
window.openMenus = () => [...document.querySelectorAll(".zentral-notes-sheet .zn-menu")].filter((m) => m.offsetParent !== null || m.getClientRects().length);
// Close whatever is open through the sheet's OWN path: a pointerdown outside the menu is what a person does. Removing
// the menu node by hand would leave the sheet's own menu variable pointing at a detached element, and the next fill
// would throw "the node to be removed is no longer a child of this node".
window.closeMenus = async () => {
  if (!document.querySelector(".zentral-notes-sheet .zn-menu")) return;
  document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
  await settle();
  const dialog = document.querySelector(".zentral-notes-sheet .zn-dialog");
  if (dialog) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  await settle();
};
// Open a group row and come back, reporting what each level held.
window.walkGroups = async () => {
  const report = [];
  const levels = () => [...document.querySelectorAll(".zentral-notes-sheet .zn-menu")];
  const menu = () => levels()[levels().length - 1];
  let depth = 0;
  while (depth < 6) {
    const m = menu();
    if (!m) break;
    const rows = [...m.querySelectorAll(".zn-menu-item")];
    const groups = rows.filter((r) => r.classList.contains("zn-menu-group"));
    const back = rows.find((r) => r.classList.contains("zn-menu-back"));
    report.push({ depth, rows: rows.length, groups: groups.map((g) => g.textContent.trim()), hasBack: !!back, height: m.getBoundingClientRect().height });
    if (!groups.length) break;
    groups[0].click();
    await settle();
    const after = menu();
    if (!after || after === m) break;
    const afterBack = [...after.querySelectorAll(".zn-menu-item")].find((r) => r.classList.contains("zn-menu-back"));
    report[report.length - 1].backAfterOpen = !!afterBack;
    if (!afterBack) break;
    afterBack.click();
    await settle();
    if (menu() === after) break; // Back did not return anywhere
    depth++;
    // Avoid walking the same group again on the level we returned to.
    const again = [...menu().querySelectorAll(".zn-menu-item.zn-menu-group")];
    if (!again.length) break;
    again[0].remove();
  }
  return report;
};
</script>
</body></html>`;

// ---- what is wrong with a menu that is open (runs in the page) ---------------------------------------------------------
function measureMenu(font) {
  const sheet = document.querySelector(".zentral-notes-sheet");
  const menus = [...sheet.querySelectorAll(".zn-menu")].filter((m) => m.getClientRects().length);
  if (!menus.length) return { missing: true, issues: [{ kind: "empty-menu", what: "no menu is on screen" }] };
  const m = menus[menus.length - 1];
  const round = (n) => Math.round(n * 100) / 100;
  const win = { w: window.innerWidth, h: window.innerHeight };
  const box = m.getBoundingClientRect();
  const issues = [];
  const rows = [...m.querySelectorAll(".zn-menu-item")].filter((r) => !r.classList.contains("zn-menu-head"));
  const heights = rows.map((r) => r.getBoundingClientRect().height);
  if (!rows.length) issues.push({ kind: "empty-menu", what: "the menu has no rows" });
  const minRow = Math.max(...heights), row = Math.min(...heights);
  // A row must be at least as tall as its own text; less means the label is cut vertically.
  for (const r of rows) {
    const label = r.querySelector("span") || r;
    const rb = r.getBoundingClientRect(), lb = label.getBoundingClientRect();
    const over = Math.max(lb.bottom - (rb.bottom - 1), (rb.top + 1) - lb.top);
    if (lb.height > 0 && over > 1.5) issues.push({ kind: "row-tight", row: r.textContent.trim().slice(0, 28), by: round(over) });
    // Horizontal clipping: a label wider than its box, with no ellipsis in its computed style.
    const st = getComputedStyle(label);
    if (label.scrollWidth > label.clientWidth + 1 && st.textOverflow !== "ellipsis" && st.overflow !== "hidden")
      issues.push({ kind: "label-clipped", row: r.textContent.trim().slice(0, 28), by: label.scrollWidth - label.clientWidth });
  }
  // Wasted height: a single line of label in a row taller than 2.6x the text size.
  if (row > font * 2.6) issues.push({ kind: "row-tall", row: round(row), text: font });
  // The menu against the window it opened into.
  const scrollable = getComputedStyle(m).overflowY !== "visible" && m.scrollHeight > m.clientHeight;
  if (box.height > win.h && !scrollable) issues.push({ kind: "menu-too-tall", menu: round(box.height), window: win.h });
  if (box.top < -0.5 || box.left < -0.5 || box.bottom > win.h + 0.5 || box.right > win.w + 0.5)
    issues.push({ kind: "menu-off-window", menu: [round(box.left), round(box.top), round(box.right), round(box.bottom)], window: [win.w, win.h] });
  // A submenu level must always offer a way back.
  const back = [...m.querySelectorAll(".zn-menu-item.zn-menu-back")].length;
  const parent = menus.length > 1;
  if (parent && !back) issues.push({ kind: "group-no-back", what: "a level inside a group has no Back row" });
  return {
    issues,
    rows: rows.length,
    height: round(box.height),
    rowHeight: round(row),
    tallestRow: round(minRow),
    groups: rows.filter((r) => r.classList.contains("zn-menu-group")).length,
    scrollable,
    key: [rows.length, round(box.height), round(row)].join("|"),
    box: [round(box.left), round(box.top), round(box.width), round(box.height)],
  };
}

// Did the menu cover the button that opened it?
function coversTrigger(triggerSelector) {
  const t = document.querySelector(triggerSelector);
  const menus = [...document.querySelectorAll(".zentral-notes-sheet .zn-menu")].filter((m) => m.getClientRects().length);
  if (!t || !menus.length) return false;
  const a = t.getBoundingClientRect(), b = menus[menus.length - 1].getBoundingClientRect();
  return !(b.right <= a.left || b.left >= a.right || b.bottom <= a.top || b.top >= a.bottom);
}

(async () => {
  const puppeteer = load("puppeteer-core");
  let executablePath = process.env.CHROME_PATH || "", extra = [];
  if (!executablePath) {
    process.env.AWS_EXECUTION_ENV = process.env.AWS_EXECUTION_ENV || "AWS_Lambda_nodejs22.x";
    const packed = load("@sparticuz/chromium");
    const chromium = packed.default || packed;
    executablePath = await chromium.executablePath();
    extra = chromium.args;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zentral-notes-menus-"));
  fs.copyFileSync(path.join(ROOT, "additional/notes/ZentralNotes.css"), path.join(dir, "sheet.css"));
  fs.copyFileSync(path.join(ROOT, "additional/notes/ZentralNotes.uc.js"), path.join(dir, "notes.js"));
  fs.copyFileSync(path.join(ROOT, "additional/notes/calendar/ZentralNotesCalendar.js"), path.join(dir, "calendar.js"));
  fs.writeFileSync(path.join(dir, "page.html"), PAGE);
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

  const results = [];
  for (const scrollbar of SCROLLBARS) {
    const browser = await puppeteer.launch({ args: [...extra, "--allow-file-access-from-files"], executablePath, headless: true, ignoreDefaultArgs: scrollbar ? ["--hide-scrollbars"] : [] });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
    await page.setViewport({ width: Math.max(VIEW_W, Math.max(...WIDTHS) + 40), height: Math.max(VIEW_H, 200) });
    await page.goto("file://" + path.join(dir, "page.html"));
    if (scrollbar) await page.addStyleTag({ content: `::-webkit-scrollbar { width: ${scrollbar}px; height: ${scrollbar}px; } ::-webkit-scrollbar-thumb { background: #888; } ::-webkit-scrollbar-track { background: #333; }` });
    for (const font of FONTS) for (const width of WIDTHS) for (const wanted of HEIGHTS) {
      const height = Math.min(wanted, Math.max(VIEW_H, 200) - 40);
      const made = await page.evaluate((o) => window.build(o), { font, width, height });
      const names = await page.evaluate(() => window.MENUS.map((x) => ({ name: x.name, kind: x.kind })));
      for (const entry of names) {
        // `height` here is the SHEET height (a cell of the grid); the menu's own height is `menuHeight`.
        const cell = { menu: entry.name, kind: entry.kind, font, width, height, scrollbar, layout: made.surface, steps: [], issues: [] };
        results.push(cell);
        try {
          await page.evaluate(() => window.closeMenus());
          await page.evaluate((name) => {
            const found = window.MENUS.find((x) => x.name === name);
            found.open();
          }, entry.name);
          await page.evaluate(() => window.settle());
          const found = await page.evaluate(measureMenu, font);
          cell.rows = found.rows; cell.menuHeight = found.height; cell.rowHeight = found.rowHeight;
          cell.groups = found.groups; cell.scrollable = found.scrollable;
          cell.steps.push(`${found.rows} row(s), ${found.height} px tall, rows of ${found.rowHeight} px`);
          for (const issue of found.issues) cell.issues.push(issue);
          if (found.groups) {
            const walk = await page.evaluate(() => window.walkGroups());
            for (const level of walk) cell.steps.push(`  level ${level.depth}: ${level.rows} row(s), ${level.height} px, back ${level.hasBack ? "yes" : "no"}${level.groups.length ? ", groups: " + level.groups.join(" / ") : ""}`);
            if (walk.some((level) => level.depth > 0 && !level.hasBack)) cell.issues.push({ kind: "group-no-back", what: "a group level has no Back row" });
            if (walk.length > 1 && walk.some((level) => level.backAfterOpen === false)) cell.issues.push({ kind: "group-loses", what: "opening a group left no way back to its level" });
          }
          if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `sb${scrollbar}-f${font}-w${width}-h${height}-${entry.name.replace(/[^a-z0-9]+/gi, "-")}.png`), clip: { x: 0, y: 0, width: width + 40, height: height + 40 } });
        } catch (error) {
          const message = String(error && error.message || error).split("\n")[0].slice(0, 200);
          const notApplicable = (await page.evaluate((name) => {
            const found = window.MENUS.find((x) => x.name === name);
            try { found.open(); return false; } catch (e) { return e instanceof window.NotApplicable || /no trigger /.test(String(e && e.message)); }
          }, entry.name));
          if (notApplicable) cell.skipped = "this sheet size does not draw the thing this menu belongs to (" + message + ")";
          else cell.issues.push({ kind: "page-error", step: "open", what: message });
        }
        for (const e of errors.splice(0)) cell.issues.push({ kind: "page-error", step: "page", what: e });
      }
    }
    await browser.close();
  }
  fs.rmSync(dir, { recursive: true, force: true });

  // ---- report ------------------------------------------------------------------------------------------------
  const kinds = {};
  for (const cell of results) for (const issue of cell.issues) kinds[issue.kind] = (kinds[issue.kind] || 0) + 1;
  const name = (cell) => `${cell.menu} — text ${cell.font} px, sheet ${cell.width}x${cell.height}, scrollbar ${cell.scrollbar}`;
  if (DETAILS) for (const cell of results) {
    console.log(name(cell) + ":");
    for (const step of cell.steps) console.log("    " + step);
    for (const issue of cell.issues) console.log("  ! " + JSON.stringify(issue));
  }
  // One line per menu: the range across every cell it was measured in.
  const byMenu = new Map();
  for (const cell of results) {
    const list = byMenu.get(cell.menu) || [];
    list.push(cell);
    byMenu.set(cell.menu, list);
  }
  for (const [menu, cells] of byMenu) {
    // A cell where the menu could not be opened (a narrow sheet draws no Month cells) has no measurement to average:
    // leaving its uninitialised height in the range made a 300 px menu look like it ran to 720 px.
    const measured = cells.filter((c) => !c.skipped);
    const heights = measured.map((c) => c.menuHeight).filter((n) => Number.isFinite(n));
    const rows = measured.map((c) => c.rows).filter((n) => Number.isFinite(n));
    const bad = cells.reduce((n, c) => n + c.issues.length, 0);
    const range = (nums) => (nums.length ? `${Math.min(...nums)}–${Math.max(...nums)}` : "not opened");
    console.log(`${menu.padEnd(30)} rows ${range(rows).padEnd(9)} height ${range(heights).padEnd(12)} px   ${bad ? bad + " finding(s)" : "ok"}`);
  }
  const bad = results.filter((cell) => cell.issues.length);
  const skipped = results.filter((cell) => cell.skipped);
  if (!DETAILS) for (const cell of bad) console.log(`  ! ${name(cell)}: ${JSON.stringify(cell.issues[0])}`);
  const total = bad.reduce((n, cell) => n + cell.issues.length, 0);
  if (skipped.length && DETAILS) for (const cell of skipped) console.log(`  - ${name(cell)}: not applicable — ${cell.skipped}`);
  console.log(`\n${results.length} measurements (${byMenu.size} menus, ${FONTS.length} text sizes x ${WIDTHS.length} widths x ${HEIGHTS.length} heights x ${SCROLLBARS.length} scrollbar kinds).`);
  console.log("By kind: " + (Object.keys(kinds).length ? Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(", ") : "nothing"));
  console.log(`Findings: ${total} in ${bad.length} measurement(s).` + (skipped.length ? ` Not applicable: ${skipped.length} (a sheet size that does not draw the menu's subject).` : ""));

  if (BASELINE) {
    const lines = [
      "# Menu baseline (OW-77)",
      "",
      "Measured by `tools/audit-notes-menus.cjs` in headless Chromium " + (await (async () => { try { return (await require(path.join(path.dirname(executablePath), "..", "package.json"))).version; } catch (_) { return "153"; } })()) + ".",
      "Each cell is one menu at one text size, sheet size and scrollbar kind; `height` is the menu's own box and `rows` the",
      "smallest row. Regenerate with `--baseline`; check with `--compare docs/MENU_BASELINE.md`.",
      "",
      "| menu | text | sheet | scrollbar | rows | height (px) | verdict |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...results.map((c) => `| ${c.menu} | ${c.font} px | ${c.width}x${c.height} | ${c.scrollbar} | ${c.rows ?? "—"} | ${c.menuHeight ?? "—"} | ${c.issues.length ? "**" + c.issues[0].kind + "**" : c.skipped ? "not applicable" : "ok"} |`),
      "",
    ];
    fs.writeFileSync(BASELINE_PATH, lines.join("\n"));
    console.log(`\nBaseline written to ${path.relative(ROOT, BASELINE_PATH)}`);
  }

  if (COMPARE) {
    // The baseline is a table of the same measurements; compare what is named there with what we just measured.
    const text = fs.readFileSync(path.resolve(COMPARE), "utf8");
    const rows = text.split("\n").filter((l) => /^\| .* \| \d+ px \| \d+x\d+ \| \d+ \|/.test(l)).map((l) => l.split("|").map((s) => s.trim()));
    const key = (menu, font, sheet, sb) => `${menu}|${font}|${sheet}|${sb}`;
    const have = new Map(results.map((c) => [key(c.menu, c.font + " px", c.width + "x" + c.height, String(c.scrollbar)), c]));
    let moved = 0;
    for (const parts of rows) {
      const [, menu, font, sheet, sb, , height] = parts;
      const cell = have.get(key(menu, font, sheet, sb));
      if (!cell || typeof cell.menuHeight !== "number") continue;
      const delta = Math.abs(cell.menuHeight - Number(height));
      if (delta > TOLERANCE) { moved++; console.log(`  ! ${menu} at ${font} ${sheet} sb${sb}: ${height} px -> ${cell.menuHeight} px (moved ${delta})`); }
    }
    console.log(`\nCompared with ${path.relative(ROOT, path.resolve(COMPARE))}: ${rows.length} baseline row(s), ${moved} moved by more than ${TOLERANCE} px.`);
    if (moved) process.exit(1);
  }
  process.exit(total ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(2); });
