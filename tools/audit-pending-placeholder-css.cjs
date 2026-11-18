#!/usr/bin/env node
"use strict";
/* OW-114 (owner audit F4): a screenshot-free CSS audit.
 *
 * OW-88 parks Notes/Agenda sidebar placeholders with `[pending]`. List EVERY style rule in
 * `additional` and `extension` CSS whose selector mentions the pending attribute,
 * and say whether it can change the look of one of those pinned placeholder rows. No browser,
 * no screenshot, no live Zen needed: this is a static reading of the shipped stylesheets.
 *
 * Usage:
 *   node tools/audit-pending-placeholder-css.cjs            human-readable report
 *   node tools/audit-pending-placeholder-css.cjs --json     machine-readable report
 *   node tools/audit-pending-placeholder-css.cjs --write    refresh docs/ow-114-pending-css-audit.md
 */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const SCOPES = ["additional", "extension"];
const PENDING = /\[pending[^\]]*\]/;
const NOTES_MARK = /bgalazka-notes-(?:item|agenda-item|folder)/;

function cssFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...cssFiles(file));
    else if (entry.isFile() && file.endsWith(".css")) out.push(file);
  }
  return out;
}

// Comments are blanked (not removed) so every reported line still points at the right source line.
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "));
}

function splitTopLevel(text, separator) {
  const parts = [];
  let start = 0;
  let paren = 0;
  let bracket = 0;
  let quote = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote && text[i - 1] !== "\\") quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") paren++;
    else if (ch === ")") paren = Math.max(0, paren - 1);
    else if (ch === "[") bracket++;
    else if (ch === "]") bracket = Math.max(0, bracket - 1);
    else if (ch === separator && paren === 0 && bracket === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function declarations(body) {
  return splitTopLevel(body, ";")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const colon = chunk.indexOf(":");
      if (colon < 0) return null;
      return {
        property: chunk.slice(0, colon).trim(),
        value: chunk.slice(colon + 1).trim(),
      };
    })
    .filter(Boolean);
}

const LOOK_PROPERTIES = new Set([
  "opacity", "filter", "pointer-events", "overflow", "min-height", "height", "max-height",
  "flex", "margin-block", "padding-block", "padding-inline", "align-items", "box-sizing",
]);

function parseRules(text, file, baseLine = 1, atPrefix = "") {
  const rules = [];
  let prelude = "";
  let preludeStart = 0;
  let preludeHasContent = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "{" && prelude.trim()) {
      // Find the matching brace, respecting strings and nested braces.
      let depth = 1;
      let j = i + 1;
      let quote = "";
      for (; j < text.length && depth > 0; j++) {
        const c = text[j];
        if (quote) {
          if (c === quote && text[j - 1] !== "\\") quote = "";
          continue;
        }
        if (c === '"' || c === "'") quote = c;
        else if (c === "{") depth++;
        else if (c === "}") depth--;
      }
      const body = text.slice(i + 1, j - 1);
      const preludeText = prelude.trim();
      const line = baseLine + text.slice(0, preludeStart).split("\n").length - 1;
      if (/^@(?:media|supports|layer|container|document)\b/i.test(preludeText)) {
        rules.push(...parseRules(body, file, baseLine + text.slice(0, i + 1).split("\n").length - 1,
          (atPrefix ? atPrefix + " / " : "") + preludeText.replace(/\s+/g, " ")));
      } else if (!/^@/.test(preludeText)) {
        for (const rawSelector of splitTopLevel(preludeText, ",")) {
          const selector = (atPrefix ? atPrefix + " " : "") + rawSelector.replace(/\s+/g, " ").trim();
          if (selector) rules.push({ file, line, selector, declarations: declarations(body) });
        }
      }
      i = j;
      prelude = "";
      preludeStart = i;
      preludeHasContent = false;
      continue;
    }
    if (ch === ";" || ch === "}") {
      prelude = "";
      preludeStart = i + 1;
      preludeHasContent = false;
    } else {
      if (!/\s/.test(ch) && !preludeHasContent) {
        preludeStart = i;
        preludeHasContent = true;
      }
      prelude += ch;
    }
    i++;
  }
  return rules;
}

function compactSelector(selector) {
  return selector.replace(/\s+/g, " ").trim();
}

function classify(rule) {
  const selector = compactSelector(rule.selector);
  const props = rule.declarations.map((d) => d.property);
  const look = rule.declarations
    .filter((d) => LOOK_PROPERTIES.has(d.property))
    .map((d) => `${d.property}: ${d.value}`);
  const isOverride = NOTES_MARK.test(selector) &&
    rule.declarations.some((d) => d.property === "opacity" && /^1\s*!important/.test(d.value)) &&
    rule.declarations.some((d) => d.property === "filter" && /^none\s*!important/.test(d.value));
  if (isOverride) {
    return {
      matches: true,
      kind: "override",
      reason: "OW-114 mitigation: narrow Notes/Agenda `[pending]` override restoring the row/folder look",
      look,
    };
  }
  // The Appearance rules only fire for a pending tab that carries a LOADED Essential-panel
  // tile/launcher. A Notes/Agenda placeholder has neither, so they cannot match one.
  if (/bgalazka-essential-tile|bgalazka-tab-icon-panel|bgalazka-panel-icon-host|zen-app-tile/.test(selector)) {
    return {
      matches: false,
      kind: "candidate",
      reason: "requires a loaded Essential-panel tile/launcher inside the pending tab; a Notes/Agenda placeholder has none",
      look,
    };
  }
  // The four compact-density rules either hide a pinned `[pending]` child of a collapsed folder
  // directly, or hide its folder because only pending rows are left.
  if (/not\(\[pinned\]:not\(\[pending\]\)\)/.test(selector) ||
      /:is\(\[selected\], :not\(\[pending\]\)\)/.test(selector)) {
    return {
      matches: true,
      kind: "density",
      reason: "compact density: a pinned `[pending]` row is treated as unloaded and hidden/collapsed (or its folder is)",
      look,
    };
  }
  return {
    matches: false,
    kind: "candidate",
    reason: "pending selector, but no path to a pinned Notes/Agenda placeholder was found",
    look,
    props,
  };
}

function audit() {
  const files = SCOPES.flatMap((scope) => cssFiles(path.join(root, scope))).sort();
  const rules = [];
  for (const file of files) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    const text = stripComments(fs.readFileSync(file, "utf8"));
    for (const rule of parseRules(text, rel)) {
      if (!PENDING.test(rule.selector)) continue;
      rules.push({ ...rule, ...classify(rule) });
    }
  }
  return {
    scopes: SCOPES,
    rules,
    matching: rules.filter((r) => r.matches && r.kind !== "override"),
    overrides: rules.filter((r) => r.kind === "override"),
  };
}

function format(report) {
  const lines = [
    "# OW-114: `[pending]` CSS audit (screenshot-free)",
    "",
    "Generated by `node tools/audit-pending-placeholder-css.cjs --write`.",
    "Scope: every `additional` and `extension` CSS rule whose selector mentions `[pending]`",
    "(including `[pending=\"true\"]` and negations). A match means the rule can change the look of a pinned",
    "Notes/Agenda placeholder row after OW-88 parks it, either inside `zen-folder[bgalazka-notes-folder]` or",
    "marked `tab[bgalazka-notes-item]` / `tab[bgalazka-notes-agenda-item]`.",
    "",
    `Candidate rules: ${report.rules.length}; matching OUR rules: ${report.matching.length}; narrow overrides: ${report.overrides.length}.`,
    "",
    "| # | File:line | Match | Kind | Selector (compact) | Look properties changed | Reason |",
    "| --: | :--- | :--- | :--- | :--- | :--- | :--- |",
  ];
  report.rules.forEach((rule, index) => {
    const look = rule.look.length ? rule.look.map((x) => "`" + x + "`").join("<br>") : "—";
    const selector = compactSelector(rule.selector).replace(/\|/g, "\\|").replace(/`/g, "\\`");
    lines.push(`| ${index + 1} | \`${rule.file}:${rule.line}\` | ${rule.matches ? "YES" : "no"} | ${rule.kind} | \`${selector}\` | ${look} | ${rule.reason.replace(/\|/g, "\\|")} |`);
  });
  lines.push(
    "",
    "## Third-party / out-of-scope",
    "",
    "- `arc-grayscale-unloaded-tabs = true` and `browser.tabs.fadeOutUnloadedTabs = true` are Arc/Zen mod",
    "  styles, not rules in this repository. They can still gray or fade a `[pending]` row; this audit cannot",
    "  fix them and the owner must compare the sidebar rows before/after (OWNER GATE).",
    "- `zentral/groups/styles/ZentralGroupsInjected.css` already resets `filter: none` for",
    "  `:root zen-folder tab[pending=\"true\"]`, but it is outside the audited directories and covers only the",
    "  filter, not opacity or layout.",
    "",
    "## OWNER GATE",
    "",
    "Compare Notes/Agenda sidebar rows before/after with compact mode, a collapsed folder and the space indicator:",
    "labels, icons, opacity, grayscale and spacing. Third-party Arc/Zen unloaded-tab styles are outside this fix.",
  );
  return lines.join("\n") + "\n";
}

module.exports = { audit, format, parseRules, stripComments };

if (require.main === module) {
  const report = audit();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else if (process.argv.includes("--write")) {
    const target = path.join(root, "docs/ow-114-pending-css-audit.md");
    fs.writeFileSync(target, format(report));
    console.log("Wrote " + path.relative(root, target));
  } else {
    process.stdout.write(format(report));
  }
}
