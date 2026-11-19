"use strict";
/* SB6.9, the LEFT half: the Agenda folder folds itself away when there is nothing to look at.
 * Two independent reasons, either of which is enough:
 *   quiet hours   — outside the person's own hours (an overnight range crosses midnight)
 *   nothing soon  — nothing is due within the chosen window (0 = only when nothing is left at all)
 * The rule is pure and takes the clock, so every case can be tested at any hour of any day. The fold itself uses Zen's
 * native `collapsed` setter; nothing here repaints or re-measures, because the browser owns that animation. */
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const root = path.resolve(__dirname, "..");
const cal = require(path.join(root, "additional/notes/calendar/ZentralNotesCalendar.js"));
const SRC = fs.readFileSync(path.join(root, "additional/notes/ZentralNotes.uc.js"), "utf8");
const SETTINGS = JSON.parse(fs.readFileSync(path.join(root, "additional/notes/settings.json"), "utf8"));
const LAYOUT = JSON.parse(fs.readFileSync(path.join(root, "extension/settings/layout.json"), "utf8"));

const plain = (v) => JSON.parse(JSON.stringify(v));
const at = (h, m = 0, day = 17) => new Date(2026, 10, day, h, m).getTime();
// The projection's own shape: each day bucket carries `from`, `to` and `items`.
const day = (items, from = at(0), to = at(23, 59)) => [{ from, to, count: items.length, items }];

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok -", name);
}

test("an empty projection never folds: there is nothing to hide", () => {
  assert.equal(cal.agendaFoldPlan(at(12), [], { quiet: true }).fold, false);
  assert.equal(cal.agendaFoldPlan(at(23), [], { dueWithinHours: 0 }).fold, false);
  assert.equal(cal.agendaFoldPlan(at(12), null, {}).fold, false);
  assert.equal(cal.agendaFoldPlan(at(23), [], { quiet: true }).reasons.length, 0, "and it reports no reason either");
});

test("nothing-special hours leave a folder with work in the window alone", () => {
  // 12:00, an item an hour away, no window, no quiet hours: nothing to fold for.
  const plan = cal.agendaFoldPlan(at(12), day([{ start: at(13) }]), {});
  assert.equal(plan.fold, false);
  assert.deepEqual(plain(plan.reasons), []);
});

test("a window asks a coarser question: nothing due WITHIN it folds", () => {
  // Window 2 h, the next item is 1 h away: stay open.
  assert.equal(cal.agendaFoldPlan(at(12), day([{ start: at(13) }]), { dueWithinHours: 2 }).fold, false);
  // Window 2 h, the next item is 3 h away: fold.
  const far = cal.agendaFoldPlan(at(12), day([{ start: at(15) }]), { dueWithinHours: 2 });
  assert.equal(far.fold, true);
  assert.equal(far.nothingSoon, true);
  assert.deepEqual(plain(far.reasons), ["nothing-soon"]);
  // A window of 0 means NO window: this reason is off, which is the shipped default (a feature that hides a folder
  // must not be on without being asked for).
  assert.equal(cal.agendaFoldPlan(at(12), day([{ start: at(13) }]), { dueWithinHours: 0 }).fold, false);
  assert.equal(cal.agendaFoldPlan(at(12), day([{ start: at(20) }]), { dueWithinHours: 0 }).fold, false,
    "even an item far away does not fold when the window is off");
});

test("the next start is the next one AT OR AFTER now, not the earliest of the day", () => {
  // A morning item must not keep an evening folder open, and a past item must not look like work ahead.
  const plan = cal.agendaFoldPlan(at(12), day([{ start: at(9) }, { start: at(15) }]), { dueWithinHours: 2 });
  assert.equal(plan.fold, true, "only the evening item counts, and it is 3 h away");
  assert.equal(plan.nextMs, at(15), "and it is the one the plan reports");
  const allPast = cal.agendaFoldPlan(at(12), day([{ start: at(9) }]), { dueWithinHours: 2 });
  assert.equal(allPast.fold, true, "a day whose work is done is a day with nothing soon");
  assert.equal(allPast.nextMs, 0, "and there is no next start to report");
});

test("quiet hours fold, and an overnight range crosses midnight", () => {
  const opts = { quiet: true, quietStart: "22:00", quietEnd: "07:00" };
  // Inside the range, on either side of midnight.
  assert.equal(cal.inQuietHours(at(23), "22:00", "07:00"), true, "23:00 is quiet");
  assert.equal(cal.inQuietHours(at(2), "22:00", "07:00"), true, "02:00 is quiet");
  assert.equal(cal.inQuietHours(at(6, 59), "22:00", "07:00"), true, "06:59 is still quiet");
  assert.equal(cal.inQuietHours(at(7), "22:00", "07:00"), false, "07:00 is the end, not the middle");
  assert.equal(cal.inQuietHours(at(21, 59), "22:00", "07:00"), false, "21:59 is not quiet yet");
  assert.equal(cal.inQuietHours(at(12), "22:00", "07:00"), false, "noon is never quiet");
  // A same-day range works the other way round.
  assert.equal(cal.inQuietHours(at(13), "12:00", "14:00"), true, "a daytime range is a normal interval");
  assert.equal(cal.inQuietHours(at(15), "12:00", "14:00"), false);
  // Malformed or empty input never folds anybody's folder by accident.
  assert.equal(cal.inQuietHours(at(23), "", "07:00"), false);
  assert.equal(cal.inQuietHours(at(23), "22:00", ""), false);
  assert.equal(cal.inQuietHours(at(23), "22:00", "22:00"), false, "a zero-length range is not always-quiet");
  assert.equal(cal.inQuietHours(at(23), "99:99", "07:00"), false);
  // And the plan reports which reason fired.
  const quiet = cal.agendaFoldPlan(at(23), day([{ start: at(23, 30) }]), opts);
  assert.equal(quiet.fold, true);
  assert.deepEqual(plain(quiet.reasons), ["quiet-hours"], "the item is near, so nothing-soon is FALSE: only the hour folds it");
});

test("the two reasons are independent, and quiet hours is off until asked for", () => {
  const items = [{ start: at(23, 30) }];
  assert.equal(cal.agendaFoldPlan(at(23), day(items), { quiet: false }).fold, false, "quiet hours off means no fold");
  const both = cal.agendaFoldPlan(at(23), day([{ start: at(9) }]), { quiet: true, dueWithinHours: 1 });
  assert.deepEqual(plain(both.reasons), ["quiet-hours", "nothing-soon"], "both can fire at once");
});

test("untrusted option values are cleaned, never taken as given", () => {
  assert.deepEqual(plain(cal.cleanAgendaFold({})), { quiet: false, quietStart: "22:00", quietEnd: "07:00", dueWithinHours: 0 });
  assert.equal(cal.cleanAgendaFold({ dueWithinHours: -5 }).dueWithinHours, 0);
  assert.equal(cal.agendaFoldPlan(at(12), day([{ start: at(9) }]), {}).fold, false, "the shipped defaults never fold");
  assert.equal(cal.cleanAgendaFold({ dueWithinHours: 10000 }).dueWithinHours, 168, "capped at a week");
  assert.equal(cal.cleanAgendaFold({ dueWithinHours: 2.6 }).dueWithinHours, 3, "rounded");
  assert.equal(cal.cleanAgendaFold({ quietStart: "7:5" }).quietStart, "22:00", "a malformed time falls back");
  assert.equal(cal.cleanAgendaFold({ quietStart: "9:30" }).quietStart, "09:30", "and a loose one is normalised");
  assert.equal(cal.cleanAgendaFold({ quiet: "yes" }).quiet, false, "only a real true counts");
});

test("the four settings exist, are placed, and reach the dialog", () => {
  const base = "zen.workspace.zentral.notes.";
  for (const name of ["agenda_fold_quiet", "agenda_fold_quiet_start", "agenda_fold_quiet_end", "agenda_fold_due_hours"]) {
    const property = base + name;
    assert.ok(SETTINGS.schema.some((x) => x.property === property), property + " is declared");
    const meta = SETTINGS.settings[property];
    assert.ok(meta, property + " has a settings entry, so the dialog shows it");
    assert.ok(LAYOUT.categories.some((c) => c.id === meta.category && c.sections.some((sec) => sec.label === meta.section)),
      property + " points at a section the layout declares");
    assert.ok(LAYOUT.order.includes(property), property + " is in the page order");
  }
  assert.equal(SETTINGS.schema.find((x) => x.property === base + "agenda_fold_quiet").defaultValue, false, "folding ships off");
});

test("the fold uses Zen's own setter, and a hand-unfold is respected", () => {
  const start = SRC.indexOf("function agendaApplyFold(days) {");
  assert.ok(start > 0, "the applier exists");
  // Slice to the function's OWN bound: the next top-level declaration after it (the OW-54 lesson — a fixed width or a
  // guessed closing brace silently stops covering the function, and then the assertions below pass for the wrong reason).
  // The next thing declared at the same indentation, whatever kind it is (a `function` here, a `const` in general):
  // anchoring on one keyword is how a slice silently runs long.
  const rest = SRC.slice(start + 10);
  const nextDecl = /\n      (?:function |const |let |var |\/\/ |\/\* )/.exec(rest);
  assert.ok(nextDecl, "the applier's own bound is found");
  const end = start + 10 + nextDecl.index;
  const body = SRC.slice(start, end);
  assert.match(body, /root\.collapsed = wantFolded/, "it sets the browser's own collapsed flag");
  assert.ok(!/style\.|setAttribute\("hidden"/.test(body), "it does not fake a fold with styling or a hidden attribute");
  // Never repaint or remeasure after toggling: the browser owns that animation (the ZentralColorfulFolders rule).
  // Assert on CODE, not on the comment that explains the rule — the comment contains those very words (a trap).
  const code = body.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/syncWidgetsAndLayout|remeasure|requestAnimationFrame/.test(code), "and nothing repaints after the toggle");
  // The hand-unfold guard: a person who opens the folder is not fighting the feature every second.
  // The flag is SET by the watch function and READ here, so each assertion names its own function.
  const watchStart = SRC.indexOf("function agendaWatchHandUnfold(root) {");
  assert.ok(watchStart > 0, "the hand-unfold watcher exists");
  const watch = SRC.slice(watchStart, SRC.indexOf("\n      function agendaApplyFold", watchStart));
  assert.match(watch, /foldUnfoldedByHand = true/, "opening it by hand is remembered");
  assert.match(SRC, /if \(wantFolded && !foldUnfoldedByHand\)/, "and the fold stands down while it is open");
  assert.match(watch, /addEventListener\?\.\("click"/, "and it is the click that opens it which sets that flag");
  assert.ok(!/setInterval/.test(body), "no timer of its own: the projection pass is the clock");
});

console.log("\nPASS notes-agenda-fold (" + passed + " tests)");
