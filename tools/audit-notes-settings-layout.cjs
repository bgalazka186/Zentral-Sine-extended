#!/usr/bin/env node
"use strict";
/* Measures the Notes settings dialogs in a real layout engine (T3.1).

   Node has no layout engine and the test suite uses a fake DOM, so "nothing lies over anything else at 28px" cannot
   be a unit test. This script opens the real sheet (ZentralNotes.uc.js + ZentralNotes.css, nothing mocked but the
   disk) in a headless Chromium, and for every text size, sheet width, sheet height and scrollbar kind walks through
   Quick settings, every tab of Settings, Toolbar buttons, Keyboard shortcuts, the table creator and the code language
   list. In each it looks for:

     overlap          two items of one row or list share pixels
     taller-than-row  an item sticks out above or below its row (it then lies over the next row)
     outside          an item sticks out of its row sideways
     outside-card     a control or text ends outside the card
     text-out         text is wider than the button, label or heading it belongs to
     h-scroll         the card or a list needs a sideways scrollbar
     split-control    minus, value and plus are not on one line
     row-split        the controls of one row are on different lines (the label may be on its own)

   Any of these in a settings dialog makes the script exit with 1. Two more are counted but allowed:

     slider-wrap      a slider group broke up because a line is too short for slider + value + reset
     clipped-input    a text field shows less than its text (it scrolls)

   The table creator and the code language list are not settings, but they are built from the same list classes and
   sized by the same code, so they are looked at too. What is found there is printed apart and does not decide the
   exit code (the table creator has two number fields that do not shrink and a size grid that grows with the width;
   with classic scrollbars its card shows both scrollbars when it has to grow wider than the sheet).

   It is not part of `node tests/run-all.cjs` and CI does not run it: it needs a browser. Zen draws with Gecko, this
   measures Blink. What it found (rows squeezed below their content by `auto` grid tracks, a later rule with the same
   selector, items of a wrapping row breaking apart) is behaviour both engines share by specification; widths of
   text and form controls differ a little, which moves where a line wraps but not whether things fit.

   Setup, outside the repository (the versions that were used: @sparticuz/chromium 153, puppeteer-core 25):
     mkdir /tmp/ch && cd /tmp/ch && npm i @sparticuz/chromium puppeteer-core
   Run:
     AWS_EXECUTION_ENV=AWS_Lambda_nodejs22.x NODE_PATH=/tmp/ch/node_modules node tools/audit-notes-settings-layout.cjs
   (AWS_EXECUTION_ENV makes @sparticuz/chromium unpack the libraries its binary needs. With another Chrome or
   Chromium: CHROME_PATH=/path/to/chrome NODE_PATH=... node tools/audit-notes-settings-layout.cjs.)
   The whole grid (240 cells) takes about a quarter of an hour on two cores.

   Options:
     --fonts 8,13,20,28,40     text sizes in px                         (default 8,10,13,16,20,24,28,32,36,40)
     --widths 240,420          sheet widths in px                       (default 240,280,340,420,560,700)
     --heights 440,760         sheet heights in px; in a short sheet the cards grow past it, in a tall one the
                               Settings card fills it                   (default 440,760)
     --scrollbars 0,17         0 = scrollbars that take no room, 17 = classic ones of that width (default 0,17)
     --viewport 1280x800       window size                              (default 1280x800)
     --details                 print every finding
     --shots DIR               save a screenshot of every view into DIR
     --css FILE --js FILE      measure another version of the style sheet / the script, for example
                               `git show HEAD~1:additional/notes/ZentralNotes.css > /tmp/old.css` */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes("--" + name);
const option = (name, fallback) => { const i = args.indexOf("--" + name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback; };
const numbers = (name, fallback) => String(option(name, fallback)).split(",").map(Number).filter((n) => Number.isFinite(n));
const FONTS = numbers("fonts", "8,10,13,16,20,24,28,32,36,40");
const WIDTHS = numbers("widths", "240,280,340,420,560,700");
const HEIGHTS = numbers("heights", "440,760");
const SCROLLBARS = numbers("scrollbars", "0,17");
const [VIEW_W, VIEW_H] = String(option("viewport", "1280x800")).split("x").map(Number);
const SHOTS = option("shots", "");
const HARD = ["overlap", "taller-than-row", "outside", "outside-card", "text-out", "h-scroll", "split-control", "row-split", "no-dialog"];

function load(name) {
  try { return require(name); } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
    console.error(`Cannot find "${name}". Install it outside the repository and point NODE_PATH at it:\n  mkdir /tmp/ch && cd /tmp/ch && npm i @sparticuz/chromium puppeteer-core\n  AWS_EXECUTION_ENV=AWS_Lambda_nodejs22.x NODE_PATH=/tmp/ch/node_modules node tools/audit-notes-settings-layout.cjs`);
    process.exit(2);
  }
}

// ---- the page: the real style sheet and script, an in-memory disk, a sheet of exactly the asked size ----------------
const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="sheet.css">
<style>html,body{margin:0;height:100%;background:#1c1b22;color:#eee;font:13px system-ui, sans-serif}
/* The sheet and its menus open with a short scale animation; measured in the middle of it every box is a little small. */
*, *::before, *::after { animation: none !important; transition: none !important; }</style>
</head><body>
<script>
window.ZentralRuntime = { register() {} }; window.__zentralNotesTestSeam = {};
var Services = {}; var ChromeUtils = {};
var module = { exports: {} };
</script>
<script src="calendar.js"></script>
<script>window.__zentralNotesParts = { "notes-calendar": module.exports }; module = undefined;</script>
<script src="notes.js"></script>
<script>
let built = null;
window.build = async function ({ font, width, height, left = 20, top = 20 }) {
  const c = window.__zentralNotesTestSeam.core;
  // One page serves many sizes: the sheet of the size before goes first.
  if (built) { built.sheet.destroy(); await built.store.close(); built.host.remove(); built = null; }
  const files = new Map();
  const io = {
    join: (...parts) => parts.join("/"), filename: (p) => p.split("/").pop(),
    async readUTF8(p) { if (!files.has(p)) throw new Error("NotFound " + p); return files.get(p).text; },
    async writeUTF8(p, text) { files.set(p, { text, mtime: Date.now() }); },
    async remove(p) { files.delete(p); }, async exists(p) { return files.has(p); },
    async children(dir) { return [...files.keys()].filter((p) => p.startsWith(dir + "/")); },
    async stat(p) { return { lastModified: files.get(p)?.mtime || 0 }; }, async restrict() {},
  };
  // What the host does for every window (applyViewPrefs): the text size is a variable on the root element.
  const rootEl = document.documentElement;
  rootEl.style.setProperty("--zentral-notes-font-size", font + "px");
  rootEl.style.setProperty("--zentral-notes-line-height", "1.6");
  rootEl.setAttribute("zentral-notes-wrap", "on"); rootEl.setAttribute("zentral-notes-copy", "off"); rootEl.setAttribute("zentral-notes-theme", "zentral");
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:" + left + "px;top:" + top + "px;width:" + width + "px;height:" + height + "px";
  document.body.append(host);
  // docked: the sheet takes exactly this rectangle.
  const adapter = { position: "fixed", host, attach: (root) => host.appendChild(root),
    getArea: () => ({ left, top, width, height, anchor: "top", docked: true }), watch: () => () => {}, setActive() {}, rewatch() {} };
  const prefs = new Map([[c.PREF.FONT_SIZE, font]]);
  const store = c.createStore({ io, notify() {}, windowId: "audit", getDir: async () => "/notes", getMaxSaveMs: () => 1000, setTimer: setTimeout, clearTimer: clearTimeout });
  const sheet = c.createSheet({ store, adapter,
    env: { getPref: (key, fallback) => (prefs.has(key) ? prefs.get(key) : fallback), setPref: (k, v) => prefs.set(k, v), openLink() {}, copyText() {}, exportNote() {}, exportAll() {}, revealFolder() {} },
    ensureStore: () => store.open() });
  await sheet.open();
  built = { sheet, store, host };
  const r = sheet.root.getBoundingClientRect();
  return { width: Math.round(r.width), height: Math.round(r.height) };
};
// Two frames and a task: a redraw, the size observer of the card and the fit it asks for have all run.
window.settle = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 0))));
window.dialogButton = (text) => [...document.querySelectorAll(".zentral-notes-sheet .zn-dialog button")].find((b) => b.textContent === text || b.textContent.startsWith(text));
window.sheetButton = (title) => [...document.querySelectorAll(".zentral-notes-sheet button")].find((b) => (b.title || "") === title || (b.title || "").startsWith(title + " (") || (title === "Quick settings" && (b.title || "").startsWith(title)));
window.closeDialogs = async () => {
  for (let i = 0; i < 5 && document.querySelector(".zentral-notes-sheet .zn-dialog"); i++) {
    const b = ["Back", "Done", "Cancel"].map((t) => [...document.querySelectorAll(".zentral-notes-sheet .zn-dialog button")].find((x) => x.textContent === t)).find(Boolean);
    if (!b) break;
    b.click(); await window.settle();
  }
};
</script>
</body></html>`;

// ---- what is wrong in the open dialog (runs in the page) -------------------------------------------------------------
function audit() {
  const root = document.querySelector(".zentral-notes-sheet .zn-dialog");
  if (!root) return { issues: [{ kind: "no-dialog" }], spill: false };
  const issues = [];
  const vis = (el) => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  const name = (el) => (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : el.localName) + (el.textContent ? "[" + el.textContent.trim().slice(0, 22) + "]" : "");
  const card = root.querySelector(".zn-dialog-card");
  const cr = card.getBoundingClientRect();
  // Items of one row or list: no shared pixels, none sticking out.
  for (const row of root.querySelectorAll(".zn-quick-row, .zn-set-row, .zn-set-sub, .zn-ctl, .zn-dialog-actions, .zn-set-tabs, .zn-set-chips, .zn-set-item, .zn-cpanel, .zn-quick, .zn-set-body, .zn-dialog-card")) {
    if (!vis(row)) continue;
    const kids = [...row.children].filter(vis), rr = row.getBoundingClientRect();
    const scrolls = row.matches(".zn-set-body, .zn-quick, .zn-dialog-card"); // these scroll: an item below the visible part is not sticking out
    for (let i = 0; i < kids.length; i++) {
      const a = kids[i].getBoundingClientRect();
      if (!scrolls && (a.bottom > rr.bottom + 1.5 || a.top < rr.top - 1.5)) issues.push({ kind: "taller-than-row", row: name(row), item: name(kids[i]), by: Math.round(Math.max(a.bottom - rr.bottom, rr.top - a.top)) });
      if (a.right > rr.right + 1.5 || a.left < rr.left - 1.5) issues.push({ kind: "outside", row: name(row), item: name(kids[i]), by: Math.round(Math.max(a.right - rr.right, rr.left - a.left)) });
      for (let j = i + 1; j < kids.length; j++) {
        const b = kids[j].getBoundingClientRect();
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 1.5 && oy > 1.5) issues.push({ kind: "overlap", row: name(row), a: name(kids[i]), b: name(kids[j]), by: Math.round(Math.min(ox, oy)) });
      }
    }
  }
  const middle = (el) => { const r = el.getBoundingClientRect(); return (r.top + r.bottom) / 2; };
  const sameLine = (a, b) => Math.abs(middle(a) - middle(b)) <= Math.max(a.offsetHeight, b.offsetHeight) / 2;
  // The controls of one row stay together; only the label may be on a line of its own.
  for (const row of root.querySelectorAll(".zn-quick-row, .zn-set-row")) {
    const kids = [...row.children].filter((k) => vis(k) && !k.classList.contains("zn-quick-label"));
    if (kids.some((k) => !sameLine(k, kids[0]))) issues.push({ kind: "row-split", row: name(row) });
  }
  // Minus, value and plus on one line. A slider group may break up when a line is too short for it (allowed, counted).
  for (const value of root.querySelectorAll(".zn-quick-value")) {
    if (!vis(value)) continue;
    for (const next of [value.previousElementSibling, value.nextElementSibling]) {
      if (!next || !vis(next) || next.classList.contains("zn-quick-label") || sameLine(next, value)) continue;
      issues.push({ kind: value.parentElement.classList.contains("zn-ctl-fill") ? "slider-wrap" : "split-control", row: name(value.parentElement), item: name(next) });
    }
  }
  // Text inside its own box, boxes inside the card.
  for (const el of root.querySelectorAll("button, .zn-quick-value, .zn-quick-label, select, .zn-set-heading, .zn-set-sub > span, h3, p, input, .zn-dialog-card > strong")) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (el.localName === "input" || el.localName === "select") {
      if (el.type !== "range" && el.type !== "color" && el.scrollWidth > el.clientWidth + 1) issues.push({ kind: "clipped-input", item: name(el) + (el.value || el.placeholder || "").slice(0, 14), by: el.scrollWidth - el.clientWidth });
    } else {
      const range = document.createRange(); range.selectNodeContents(el);
      const t = range.getBoundingClientRect();
      if (t.width) {
        const dx = Math.max(t.right - r.right, r.left - t.left), dy = Math.max(t.bottom - r.bottom, r.top - t.top);
        if (dx > 1.5 || dy > 1.5) issues.push({ kind: "text-out", item: name(el), by: Math.round(Math.max(dx, dy)) });
      }
    }
    if (r.right > cr.right + 1.5 || r.left < cr.left - 1.5) issues.push({ kind: "outside-card", item: name(el), by: Math.round(Math.max(r.right - cr.right, cr.left - r.left)) });
  }
  for (const el of [card, ...root.querySelectorAll(".zn-set-body, .zn-keys, .zn-aligns")]) if (el.scrollWidth > el.clientWidth + 1) issues.push({ kind: "h-scroll", item: name(el), by: el.scrollWidth - el.clientWidth });
  // The card itself inside the window.
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  if (cr.left < -0.5 || cr.top < -0.5 || cr.right > vw + 0.5 || cr.bottom > vh + 0.5) issues.push({ kind: "outside-card", item: "the card leaves the window", by: Math.round(Math.max(-cr.left, -cr.top, cr.right - vw, cr.bottom - vh)) });
  const seen = new Set();
  return { issues: issues.filter((x) => { const k = JSON.stringify(x); if (seen.has(k)) return false; seen.add(k); return true; }), spill: root.dataset.spill === "true" };
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zentral-notes-layout-"));
  fs.copyFileSync(path.resolve(option("css", path.join(ROOT, "additional/notes/ZentralNotes.css"))), path.join(dir, "sheet.css"));
  fs.copyFileSync(path.resolve(option("js", path.join(ROOT, "additional/notes/ZentralNotes.uc.js"))), path.join(dir, "notes.js"));
  fs.copyFileSync(path.join(ROOT, "additional/notes/calendar/ZentralNotesCalendar.js"), path.join(dir, "calendar.js"));
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
    for (const height of HEIGHTS) for (const width of WIDTHS) for (const font of FONTS) {
      const made = await page.evaluate((o) => window.build(o), { font, width, height: Math.min(height, Math.max(VIEW_H, 200) - 40) });
      await page.evaluate(() => window.settle());
      const cell = { font, width: made.width, height: made.height, scrollbar };
      const record = async (view) => {
        await page.evaluate(() => window.settle());
        const found = await page.evaluate(audit);
        results.push({ ...cell, view, issues: found.issues.concat(errors.splice(0).map((e) => ({ kind: "no-dialog", item: "page error: " + e }))), spill: found.spill });
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `sb${scrollbar}-h${made.height}-w${made.width}-f${font}-${view.replace(/[^\w]+/g, "_")}.png`) });
      };
      const click = (kind, text) => page.evaluate(async (kind, text) => { const b = kind === "sheet" ? window.sheetButton(text) : window.dialogButton(text); if (!b) return false; b.click(); await window.settle(); return true; }, kind, text);
      const openSettings = async () => { await page.evaluate(() => window.closeDialogs()); await click("sheet", "Quick settings"); await click("dialog", "All settings"); };

      await click("sheet", "Quick settings");
      await record("Quick settings");
      await click("dialog", "All settings");
      const tabs = await page.evaluate(() => [...document.querySelectorAll(".zentral-notes-sheet .zn-set-tabs > *")].map((b) => b.textContent));
      for (let i = 0; i < tabs.length; i++) {
        await page.evaluate(async (i) => { document.querySelectorAll(".zentral-notes-sheet .zn-set-tabs > *")[i].click(); await window.settle(); }, i);
        await record("Settings: " + tabs[i]);
        // every colour panel open: the widest thing a tab can hold
        const opened = await page.evaluate(async () => { const s = [...document.querySelectorAll(".zentral-notes-sheet .zn-set-row .zn-swatch")]; s.forEach((b) => b.click()); await window.settle(); return s.length; });
        if (opened) await record("Settings: " + tabs[i] + ", colours open");
      }
      for (const list of ["Toolbar buttons", "Keyboard shortcuts"]) { await openSettings(); await click("dialog", list); await record(list); }
      // Two dialogs outside Settings that are built from the same list classes.
      for (const [view, title] of [["Insert table", "Table\u2026"], ["Code block languages", "Code block"]]) {
        await page.evaluate(() => window.closeDialogs());
        if (await click("sheet", title)) await record(view);
        else results.push({ ...cell, view, issues: [{ kind: "no-dialog", item: "no button " + title }], spill: false });
      }
      await page.evaluate(() => window.closeDialogs());
    }
    await browser.close();
  }
  fs.rmSync(dir, { recursive: true, force: true });

  // ---- report ------------------------------------------------------------------------------------------------
  const OTHER = ["Insert table", "Code block languages"];
  const others = results.filter((r) => OTHER.includes(r.view));
  for (const r of others) results.splice(results.indexOf(r), 1);
  const hardOf = (r) => r.issues.filter((x) => HARD.includes(x.kind));
  const kinds = {};
  for (const r of results) for (const x of r.issues) kinds[x.kind] = (kinds[x.kind] || 0) + 1;
  const cells = new Map();
  for (const r of results) {
    const key = `scrollbar ${r.scrollbar}, sheet ${r.width}x${r.height}, ${r.font}px`;
    const c = cells.get(key) || { hard: 0, soft: 0, views: 0 };
    c.hard += hardOf(r).length; c.soft += r.issues.length - hardOf(r).length; c.views++;
    cells.set(key, c);
  }
  if (flag("details")) for (const r of [...results, ...others]) {
    if (!r.issues.length) continue;
    console.log(`scrollbar ${r.scrollbar}, sheet ${r.width}x${r.height}, ${r.font}px, ${r.view}${r.spill ? " (card past the sheet)" : ""}:`);
    for (const x of r.issues) console.log("    " + JSON.stringify(x));
  }
  const bad = [...cells].filter(([, c]) => c.hard);
  for (const [key, c] of bad) console.log(`${key}: ${c.hard} finding(s)`);
  const hard = results.reduce((n, r) => n + hardOf(r).length, 0);
  const settings = results.filter((r) => r.view.startsWith("Settings: "));
  console.log(`\n${cells.size} cells (${FONTS.length} text sizes x ${WIDTHS.length} widths x ${HEIGHTS.length} heights x ${SCROLLBARS.length} scrollbar kinds), ${results.length} views of settings dialogs.`);
  console.log(`Settings card: ${settings.filter((r) => !r.spill).length} views filling the sheet, ${settings.filter((r) => r.spill).length} grown past it.`);
  console.log("By kind: " + (Object.keys(kinds).length ? Object.entries(kinds).map(([k, n]) => `${k} ${n}${HARD.includes(k) ? "" : " (allowed)"}`).join(", ") : "nothing"));
  console.log(`Findings: ${hard} in ${bad.length} cell(s).`);
  for (const view of OTHER) {
    const mine = others.filter((r) => r.view === view), withHard = mine.filter((r) => hardOf(r).length);
    const k = {};
    for (const r of mine) for (const x of hardOf(r)) k[x.kind] = (k[x.kind] || 0) + 1;
    console.log(`Not counted, ${view}: ${withHard.length} of ${mine.length} views with a finding${withHard.length ? " (" + Object.entries(k).map(([a, n]) => a + " " + n).join(", ") + ")" : ""}.`);
  }
  process.exit(hard ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
