#!/usr/bin/env node
"use strict";
/* Measures the size of the Notes calendar in a real layout engine (OW-03).

   "Fit to the pane" means that Week and Day show their hours without a scrollbar and Month its six weeks. Whether
   that is so depends on what the header, the all-day row and the toolbar take, which Node cannot know: the test
   suite uses a fake DOM and gives the timeline a height by hand (tests/notes-calendar-scale.test.cjs). This script
   opens the real sheet (ZentralNotes.uc.js + ZentralNotes.css + the calendar module, nothing mocked but the disk) in
   a headless Chromium and, for every text size, sheet width, sheet height and scrollbar kind, looks at Month, Week
   and Day with the size on "Fit": freshly drawn, with and without all-day items, with the hours 08:00-20:00, and
   after the sheet was made lower and higher again. It looks for:

     fit-scrolls      the hours are marked as fitted, and the timeline has something to scroll
     fit-not-used     the timeline scrolls although an hour is higher than the smallest one, or is not marked as
                      fitted although nothing scrolls
     fit-gap          fitted, and more is empty under the last hour than a quarter px an hour can leave
     timeline-gone    the timeline is lower than 10 px: the hours cannot be reached
     pane-scrolls     the pane content scrolls although the timeline is higher than its smallest height
     title-cut        an event that shows its time and its title is lower than the two; or the title of an event
                      that shows the title alone is cut by more than 2 px
     month-clipped    a line of a Month cell (an item, "+N more", "All day") ends below its cell
     month-scrolls    the pane content scrolls although the weeks are higher than their smallest height
     month-above      the Month grid begins above the pane content: what is up there cannot be scrolled to
     month-rows       the six weeks are not equally high
     update-differs   after all-day items were added and removed again, the timeline is not what it was
     resize-differs   after the sheet was made lower and higher again, the timeline or the weeks are not what a
                      fresh draw gives
     page-error       the page reported an error

   Any of these makes the script exit with 1.

   It is not part of `node tests/run-all.cjs` and CI does not run it: it needs a browser. Zen draws with Gecko, this
   measures Blink. The heights it rests on (a flex item that takes what its siblings leave, grid rows of `1fr`,
   `clientHeight` in whole px) are behaviour both engines share by specification; the height of a line of text
   differs a little, which moves the border between "fits" and "scrolls" by a px or two but not what happens on
   either side of it.

   Setup, outside the repository (the versions that were used: @sparticuz/chromium 153, puppeteer-core 25):
     mkdir /tmp/ch && cd /tmp/ch && npm i @sparticuz/chromium puppeteer-core
   Run:
     AWS_EXECUTION_ENV=AWS_Lambda_nodejs22.x NODE_PATH=/tmp/ch/node_modules node tools/audit-notes-calendar-fit.cjs
   (AWS_EXECUTION_ENV makes @sparticuz/chromium unpack the libraries its binary needs. With another Chrome or
   Chromium: CHROME_PATH=/path/to/chrome NODE_PATH=... node tools/audit-notes-calendar-fit.cjs.)
   The whole grid (160 cells) takes about five minutes on two cores.

   Options:
     --fonts 13,28             text sizes in px                           (default 8,13,20,28)
     --widths 1100             sheet widths in px                         (default 1100,620)
     --heights 330,720         sheet heights in px                        (default 330,380,420,480,560,640,720,800,900,1000)
     --scrollbars 0,17         0 = scrollbars that take no room, 17 = classic ones of that width (default 0,17)
     --viewport 1500x1300      window size                                (default 1500x1300)
     --details                 print every finding and, for every cell, what was measured
     --shots DIR               save a screenshot of Month and Week of every cell into DIR
     --css FILE --js FILE --calendar FILE
                               measure another version of the style sheet / the script / the calendar module, for
                               example `git show HEAD~1:additional/notes/ZentralNotes.css > /tmp/old.css`

   A wide sheet has the folder tree beside the calendar, a sheet that is higher than wide has it above ("top /
   bottom"), and a sheet too small for both shows one of them at a time ("tabs"; the calendar is the tab that is
   opened here). `--details` names the layout of every cell. In a calendar pane under 470 px wide (or below the
   configured height threshold) Month is a date-only picker: this audit checks all 42 date cells, their seven-column
   grid, accessible item counts, date-only contents and bounds inside the picker surface. */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes("--" + name);
const option = (name, fallback) => { const at = args.indexOf("--" + name); return at >= 0 && args[at + 1] !== undefined ? args[at + 1] : fallback; };
const numbers = (name, fallback) => String(option(name, fallback)).split(",").map(Number).filter((n) => Number.isFinite(n));
const FONTS = numbers("fonts", "8,13,20,28");
const WIDTHS = numbers("widths", "1100,620");
const HEIGHTS = numbers("heights", "330,380,420,480,560,640,720,800,900,1000");
const SCROLLBARS = numbers("scrollbars", "0,17");
const [VIEW_W, VIEW_H] = String(option("viewport", "1500x1300")).split("x").map(Number);
const SHOTS = option("shots", "");
const DETAILS = flag("details");

// Modules of the browser live outside the repository (NODE_PATH); say how to get them instead of a stack trace.
function load(name) {
  try { return require(name); } catch (_) {
    console.error(`Cannot load "${name}". Install it outside the repository and point NODE_PATH at it:\n  mkdir /tmp/ch && cd /tmp/ch && npm i @sparticuz/chromium puppeteer-core\n  AWS_EXECUTION_ENV=AWS_Lambda_nodejs22.x NODE_PATH=/tmp/ch/node_modules node tools/audit-notes-calendar-fit.cjs`);
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
// Wednesday 18 November 2026, 10:30; the week in view is Monday 16 to Sunday 22.
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
  rootEl.setAttribute("zentral-notes-wrap", "on"); rootEl.setAttribute("zentral-notes-copy", "off"); rootEl.setAttribute("zentral-notes-theme", "zentral");
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:20px;top:20px;width:" + width + "px;height:" + height + "px";
  document.body.append(host);
  const area = { left: 20, top: 20, width, height };
  let areaChanged = null;
  const adapter = { position: "fixed", host, attach: (root) => host.appendChild(root),
    getArea: () => ({ ...area, anchor: "top", docked: true }), watch: (cb) => { areaChanged = cb; return () => {}; }, setActive() {}, rewatch() {} };
  const prefs = new Map([[c.PREF.FONT_SIZE, font]]);
  const clock = local("2026-11-18", 10, 30);
  let stamp = clock;
  const store = c.createStore({ io, notify() {}, windowId: "calendar-fit", now: () => (stamp += 1000), getDir: async () => "/notes", getMaxSaveMs: () => 1000, setTimer: setTimeout, clearTimer: clearTimeout });
  await store.open();
  store.create("# A note\\n\\nText");
  const timed = (id, summary, start, end) => store.items.upsert({ id, summary, start: { dateTime: new Date(start).toISOString() }, ...(end ? { end: { dateTime: new Date(end).toISOString() } } : {}), x: { kind: end ? "event" : "reminder", src: "manual" } });
  timed("standup", "Standup", local("2026-11-16", 10), local("2026-11-16", 11));
  timed("lunch", "Lunch", local("2026-11-18", 12), local("2026-11-18", 13));
  timed("half", "Half an hour", local("2026-11-18", 14), local("2026-11-18", 14, 30));
  timed("long", "Workshop with a long title", local("2026-11-19", 9), local("2026-11-19", 12));
  timed("ping", "Ping Alice", local("2026-11-18", 15, 30));
  for (let i = 0; i < 6; i++) timed("many" + i, "Many " + i, local("2026-11-25", 9 + i), local("2026-11-25", 10 + i));
  for (let i = 0; i < 3; i++) timed("three" + i, "Three " + i, local("2026-11-26", 9 + i), local("2026-11-26", 10 + i));
  store.items.upsert({ id: "fair", summary: "Trade fair", start: { date: "2026-11-27" }, end: { date: "2026-11-28" }, x: { kind: "event", src: "manual" } });
  const sheet = c.createSheet({ store, adapter,
    env: { now: () => clock, getPref: (key, fallback) => (prefs.has(key) ? prefs.get(key) : fallback), setPref: (k, v) => prefs.set(k, v), openLink() {}, copyText() {}, exportNote() {}, exportAll() {}, revealFolder() {} },
    ensureStore: () => store.open() });
  await sheet.open();
  built = { sheet, store, host, area, resized: () => areaChanged && areaChanged() };
  window.root = sheet.root;
  [...sheet.root.querySelectorAll("button")].find((b) => b.title === "All notes").click();
  await settle();
  const layout = root.querySelector(".zn-all-layout"), panels = root.querySelector(".zn-all-panels"), pane = root.querySelector(".zn-calendar-pane").getBoundingClientRect();
  return { layout: layout.dataset.layout === "tabs" ? "tabs" : panels.dataset.orientation === "lr" ? "left / right" : "top / bottom", shown: pane.width > 0 && pane.height > 0 };
};
// The sheet gets another size, as when the window or the panel is resized.
window.resize = async (width, height) => { built.area.width = width; built.area.height = height; built.host.style.width = width + "px"; built.host.style.height = height + "px"; built.resized(); window.dispatchEvent(new Event("resize")); await settle(); };
window.settle = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => requestAnimationFrame(() => setTimeout(done, 0)), 0))));
window.pick = async (trigger, label) => {
  root.querySelector(trigger).click();
  const entry = [...root.querySelectorAll(".zn-menu-item")].find((el) => el.textContent.trim() === label);
  if (!entry) throw new Error("no menu entry " + label);
  entry.click(); await settle();
};
window.view = (name) => pick(".zn-calendar-view-select", name);
window.hoursToggle = async () => { root.querySelector(".zn-calendar-hours-toggle").click(); await settle(); };
window.allDay = async (add) => {
  for (let i = 0; i < 4; i++) {
    if (add) built.store.items.upsert({ id: "holiday" + i, summary: "Holiday " + i, start: { date: "2026-11-18" }, end: { date: "2026-11-19" }, x: { kind: "event", src: "manual" } });
    else built.store.items.remove("holiday" + i);
  }
  await settle();
};
</script>
</body></html>`;

// ---- what is wrong in the calendar that is shown (runs in the page) ---------------------------------------------------
function measure(font) {
  const root = document.querySelector(".zentral-notes-sheet");
  const q = (s) => root.querySelector(s), qa = (s) => [...root.querySelectorAll(s)];
  const round = (n) => Math.round(n * 100) / 100;
  const issues = [], content = q(".zn-calendar-view");
  const scroll = q(".zn-cal-time-scroll"), grid = q(".zn-cal-month-grid");
  const paneScrolls = content.scrollHeight > content.clientHeight;
  if (scroll) {
    const hours = qa(".zn-cal-hour-label").length, hourPx = parseFloat(content.style.getPropertyValue("--zn-cal-hour-height"));
    const smallest = Math.max(16, Math.round(font * 1.4)), lowest = Math.ceil(3.5 * font) + 1; // fitMinHourPx; the min-height of the timeline
    const fitted = scroll.dataset.fitted === "true", scrolls = scroll.scrollHeight > scroll.clientHeight, empty = scroll.clientHeight - scroll.scrollHeight;
    const what = `${scroll.clientHeight}/${scroll.scrollHeight} px, ${hours} h of ${hourPx} px`;
    if (fitted && scrolls) issues.push({ kind: "fit-scrolls", what });
    if (!fitted && (!scrolls || hourPx > smallest + 0.01)) issues.push({ kind: "fit-not-used", what });
    if (fitted && hourPx < 240 && empty > hours / 4 + 1) issues.push({ kind: "fit-gap", what, empty });
    if (scroll.clientHeight < 10) issues.push({ kind: "timeline-gone", what });
    if (paneScrolls && scroll.clientHeight > lowest) issues.push({ kind: "pane-scrolls", what, pane: `${content.clientHeight}/${content.scrollHeight}` });
    for (const box of qa(".zn-cal-time-event")) {
      const title = box.querySelector(".zn-cal-item-title");
      if (!title) continue;
      const b = box.getBoundingClientRect(), t = title.getBoundingClientRect(), short = box.classList.contains("is-short");
      const over = Math.max(t.bottom - (b.bottom - 1), (b.top + 1) - t.top);
      if (over > (short ? 2 : 0.5)) issues.push({ kind: "title-cut", item: title.textContent.slice(0, 20), box: round(b.height), by: round(over), short });
    }
    return { issues, summary: `${what}, ${fitted ? "fitted" : "scrolls"}`, key: `${scroll.clientHeight}|${scroll.scrollHeight}|${hourPx}|${fitted}` };
  }
  if (grid) {
    const cells = qa(".zn-cal-month-cell"), heights = cells.map((cell) => cell.getBoundingClientRect().height);
    const row = Math.min(...heights), lowest = Math.max(279, 12 * font + 84); // six weeks of 44 px, or of 2em + 14px
    const g = grid.getBoundingClientRect(), c = content.getBoundingClientRect();
    let clipped = 0, lines = 0;
    for (const cell of cells) {
      const cr = cell.getBoundingClientRect(), kids = [...cell.querySelectorAll(".zn-cal-month-mark, .zn-cal-month-more, .zn-cal-month-allday")];
      lines = Math.max(lines, kids.length);
      for (const kid of kids) if (kid.getBoundingClientRect().bottom > cr.bottom - 1 + 0.01) clipped++;
    }
    const what = `${content.clientHeight}/${content.scrollHeight} px, weeks of ${round(row)} px, ${lines} line(s)`;
    if (clipped) issues.push({ kind: "month-clipped", what, lines: clipped });
    if (paneScrolls && g.height > lowest + 0.5) issues.push({ kind: "month-scrolls", what });
    if (content.scrollTop === 0 && q(".zn-cal-month-wrap").getBoundingClientRect().top < c.top - 0.5) issues.push({ kind: "month-above", what });
    if (Math.max(...heights) - row > 0.6) issues.push({ kind: "month-rows", what, highest: round(Math.max(...heights)) });
    return { issues, summary: `${what}, ${q(".zn-cal-month-wrap").dataset.density}${paneScrolls ? ", scrolls" : ""}`, key: `${content.clientHeight}|${content.scrollHeight}|${round(row)}|${lines}` };
  }
  const picker = q(".zn-cal-picker-grid");
  if (picker) {
    const wrap = q(".zn-cal-picker-wrap"), cells = qa(".zn-cal-picker-day");
    const grid = picker.getBoundingClientRect(), bounds = content.getBoundingClientRect();
    const widths = cells.map((cell) => cell.getBoundingClientRect().width);
    const heights = cells.map((cell) => cell.getBoundingClientRect().height);
    const minWidth = Math.min(...widths), minHeight = Math.min(...heights);
    const rowSpread = Math.max(...heights) - minHeight;
    const columns = getComputedStyle(picker).gridTemplateColumns.trim().split(/\\s+/).length;
    let invalidCells = 0, clipped = 0;
    for (const cell of cells) {
      const rect = cell.getBoundingClientRect(), label = cell.getAttribute("aria-label") || "";
      if (!/^\\d{1,2}$/.test(cell.textContent.trim()) || cell.children.length || !/\\d+ items?$/.test(label)) invalidCells++;
      if (rect.left < grid.left - 0.5 || rect.right > grid.right + 0.5 || rect.top < grid.top - 0.5 || rect.bottom > grid.bottom + 0.5) clipped++;
    }
    const what = `${content.clientHeight}/${content.scrollHeight} px, ${cells.length} date cells, ${round(minWidth)}×${round(minHeight)} px minimum`;
    if (cells.length !== 42) issues.push({ kind: "picker-cells", what, actual: cells.length });
    if (columns !== 7) issues.push({ kind: "picker-columns", what, actual: columns });
    if (invalidCells) issues.push({ kind: "picker-content", what, cells: invalidCells });
    if (clipped) issues.push({ kind: "picker-clipped", what, cells: clipped });
    if (minWidth < 12 || minHeight < 20) issues.push({ kind: "picker-cell-small", what });
    if (rowSpread > 0.6) issues.push({ kind: "picker-rows", what, spread: round(rowSpread) });
    if (grid.top < bounds.top - 0.5 && content.scrollTop === 0) issues.push({ kind: "picker-above", what });
    return { issues, summary: `${what}, 7 columns, ${wrap?.dataset?.picker ? "picker" : "date grid"}`, key: `${content.clientHeight}|${content.scrollHeight}|${cells.length}|${round(minWidth)}|${round(minHeight)}` };
  }
  if (q(".zn-cal-compact-list")) return { issues: [{ kind: "page-error", what: "the retired compact Month list is still rendered" }], summary: "retired list", key: "retired-list" };
  return { issues: [{ kind: "page-error", what: "neither a timeline, Month grid nor date picker is shown" }], summary: "nothing", key: "" };
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zentral-notes-calendar-"));
  fs.copyFileSync(path.resolve(option("css", path.join(ROOT, "additional/notes/ZentralNotes.css"))), path.join(dir, "sheet.css"));
  fs.copyFileSync(path.resolve(option("js", path.join(ROOT, "additional/notes/ZentralNotes.uc.js"))), path.join(dir, "notes.js"));
  fs.copyFileSync(path.resolve(option("calendar", path.join(ROOT, "additional/notes/calendar/ZentralNotesCalendar.js"))), path.join(dir, "calendar.js"));
  fs.writeFileSync(path.join(dir, "page.html"), PAGE);
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

  const results = [];
  for (const scrollbar of SCROLLBARS) {
    // Headless Chromium hides scrollbars and gives them no room unless told otherwise.
    const browser = await puppeteer.launch({ args: [...extra, "--allow-file-access-from-files"], executablePath, headless: true, ignoreDefaultArgs: scrollbar ? ["--hide-scrollbars"] : [] });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
    await page.setViewport({ width: Math.max(VIEW_W, Math.max(...WIDTHS) + 40), height: Math.max(VIEW_H, 200) });
    await page.goto("file://" + path.join(dir, "page.html"));
    if (scrollbar) await page.addStyleTag({ content: `::-webkit-scrollbar { width: ${scrollbar}px; height: ${scrollbar}px; } ::-webkit-scrollbar-thumb { background: #888; } ::-webkit-scrollbar-track { background: #333; }` });
    for (const font of FONTS) for (const width of WIDTHS) for (const wanted of HEIGHTS) {
      const height = Math.min(wanted, Math.max(VIEW_H, 200) - 40);
      const cell = { font, width, height, scrollbar, layout: "", steps: [], issues: [] };
      results.push(cell);
      try {
        const made = await page.evaluate((o) => window.build(o), { font, width, height });
        cell.layout = made.layout;
        if (!made.shown) { cell.issues.push({ kind: "page-error", step: "start", what: "the calendar pane is not shown" }); continue; }
        const look = async (step) => {
          const found = await page.evaluate(measure, font);
          cell.steps.push(`${step}: ${found.summary}`);
          for (const issue of found.issues) cell.issues.push({ step, ...issue });
          return found.key;
        };
        const shot = (name) => (SHOTS ? page.screenshot({ path: path.join(SHOTS, `sb${scrollbar}-f${font}-w${width}-h${height}-${name}.png`), clip: { x: 0, y: 0, width: width + 40, height: height + 40 } }) : null);
        // Lower by a fifth (at least 90 px) and back: the way a window or a panel is dragged.
        const other = Math.max(240, height - Math.max(90, Math.round(height / 5)));
        const there = async (step, fresh) => {
          await page.evaluate((w, h) => window.resize(w, h), width, other);
          await look(step + ", sheet " + other + " px high");
          await page.evaluate((w, h) => window.resize(w, h), width, height);
          const back = await look(step + ", back at " + height + " px");
          if (back !== fresh) cell.issues.push({ kind: "resize-differs", step, fresh, back });
        };
        const month = await look("Month");
        await shot("month");
        await there("Month", month);
        await page.evaluate(() => window.view("Week"));
        const week = await look("Week");
        await shot("week");
        await page.evaluate(() => window.allDay(true));
        await look("Week, four all-day items");
        await page.evaluate(() => window.allDay(false));
        const again = await look("Week, without them again");
        if (again !== week) cell.issues.push({ kind: "update-differs", step: "Week", fresh: week, back: again });
        await there("Week", week);
        await page.evaluate(() => window.view("Day"));
        await look("Day");
        await page.evaluate(() => window.hoursToggle());
        await look("Day, 08:00-20:00");
        await page.evaluate(() => window.view("Week"));
        const limited = await look("Week, 08:00-20:00");
        await there("Week, 08:00-20:00", limited);
      } catch (error) {
        cell.issues.push({ kind: "page-error", step: "script", what: String(error && error.message || error).split("\n")[0].slice(0, 200) });
      }
      for (const e of errors.splice(0)) cell.issues.push({ kind: "page-error", step: "page", what: e });
    }
    await browser.close();
  }
  fs.rmSync(dir, { recursive: true, force: true });

  // ---- report ------------------------------------------------------------------------------------------------
  const kinds = {};
  for (const cell of results) for (const issue of cell.issues) kinds[issue.kind] = (kinds[issue.kind] || 0) + 1;
  const name = (cell) => `scrollbar ${cell.scrollbar}, text ${cell.font} px, sheet ${cell.width}x${cell.height} (${cell.layout || "not built"})`;
  if (DETAILS) for (const cell of results) {
    console.log(name(cell) + ":");
    for (const step of cell.steps) console.log("    " + step);
    for (const issue of cell.issues) console.log("  ! " + JSON.stringify(issue));
  }
  const bad = results.filter((cell) => cell.issues.length);
  if (!DETAILS) for (const cell of bad) console.log(`${name(cell)}: ${cell.issues.length} finding(s), first: ${JSON.stringify(cell.issues[0])}`);
  const layouts = {};
  for (const cell of results) layouts[cell.layout || "not built"] = (layouts[cell.layout || "not built"] || 0) + 1;
  const total = bad.reduce((n, cell) => n + cell.issues.length, 0);
  console.log(`\n${results.length} cells (${FONTS.length} text sizes x ${WIDTHS.length} widths x ${HEIGHTS.length} heights x ${SCROLLBARS.length} scrollbar kinds); layouts: ${Object.entries(layouts).map(([k, n]) => `${k} ${n}`).join(", ")}.`);
  console.log("By kind: " + (Object.keys(kinds).length ? Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(", ") : "nothing"));
  console.log(`Findings: ${total} in ${bad.length} cell(s).`);
  process.exit(total ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(2); });
