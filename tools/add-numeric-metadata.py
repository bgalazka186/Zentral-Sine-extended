#!/usr/bin/env python3
"""Adds "numeric": {min, max, unit} to every setting that is really a number.

A setting qualifies when it is a dropdown whose option values are all numbers, or an
"input" whose default is a number. Ranges are deliberately generous (the point is to allow
wild tweaks) but bounded so a typo cannot freeze layout or timers. Consumers keep their own
clamps, so these ranges only add a second, wider safety net.
Run: python3 tools/add-numeric-metadata.py [--dry]"""
import glob, json, re, sys
DRY = "--dry" in sys.argv
NUM = re.compile(r"-?\d+(\.\d+)?")

def unit_of(prop, label):
    t = (prop + " " + label).lower()
    if re.search(r"\(%|%\)|percent|opacity|transparen|\b%\b|_pct", t) or "opacity" in prop or "percent" in prop: return "%"
    if re.search(r"\(ms|_ms\b|delay|interval|duration|speed", t): return "ms"
    if re.search(r"\(px|_px\b|px\)", t): return "px"
    if re.search(r"height|width|size|gap|radius|border|padding|spacing|offset|rule|margin|distance|extra", t): return "px"
    return ""

OVERRIDES = {
    "zen.workspace.zentral.notes.font_size": (8, 40, "px"),
    "zen.workspace.zentral.notes.line_height": (100, 300, "%"),
    "zen.workspace.zentral.notes.autosave_seconds": (2, 60, "s"),
    "zen.workspace.zentral.experimental.sidebar_startup_recalculate.delay_seconds": (0, 60, "s"),
    "zen.workspace.bgalazka.look.rss_card_line_height": (80, 400, "%"),
    "zen.workspace.bgalazka.look.rss_card_max_height": (10, 100, "%"),
    "zen.workspace.bgalazka.look.rss_card_width": (120, 3000, "px"),
    "zen.workspace.bgalazka.look.rss_card_font_size": (6, 72, "px"),
    "zen.workspace.bgalazka.look.rss_card_padding": (0, 120, "px"),
    "zen.workspace.bgalazka.look.rss_card_radius": (0, 200, "px"),
    "zen.workspace.bgalazka.look.rss_card_border": (0, 30, "px"),
    "zen.workspace.bgalazka.look.rss_card_button_radius": (0, 100, "px"),
    "zen.workspace.bgalazka.look.rss_card_gap": (0, 100, "px"),
    "zen.workspace.zentral.video_preview.capture_rate_tenths": (1, 600, ""),
    "zen.workspace.zentral.video_preview.width_percent": (10, 100, "%"),
    "zen.workspace.zentral.video_preview.height_px": (0, 4000, "px"),
    "zen.workspace.zentral.hybrid.detached_height_percent": (20, 100, "%"),
    "zen.workspace.bgalazka.pill_position": (-50, 50, "%"),  # code clamps to +/-50
    "zen.workspace.apps.sidebar.width": (280, 4000, "px"),  # Constants.Apps.MIN_WIDTH_PX = 280
    "zen.workspace.bgalazka.panel_retry_limit": (0, 6, ""),  # code clamps to 6
    "zen.workspace.bgalazka.panel_fallback_interval_ms": (0, 300000, "ms"),  # code clamps to 300000
}

# Notes appearance: -1 means "keep the theme"; the upper bound is what the sliders offer.
OVERRIDES["zen.workspace.zentral.notes.look_radius"] = (-1, 60, "px")
OVERRIDES["zen.workspace.zentral.notes.look_border"] = (-1, 8, "px")
OVERRIDES["zen.workspace.zentral.notes.look_padding"] = (-1, 64, "px")
OVERRIDES["zen.workspace.zentral.notes.look_opacity"] = (-1, 100, "%")
OVERRIDES["zen.workspace.zentral.notes.look_shadow_blur"] = (-1, 120, "px")
OVERRIDES["zen.workspace.zentral.notes.look_shadow_y"] = (-1, 60, "px")
OVERRIDES["zen.workspace.zentral.notes.look_shadow_alpha"] = (-1, 100, "%")
OVERRIDES["zen.workspace.zentral.notes.look_btn_size"] = (-1, 56, "px")
OVERRIDES["zen.workspace.zentral.notes.look_btn_radius"] = (-1, 50, "px")

OVERRIDES["zen.workspace.zentral.notes.push_panel_percent"] = (20, 80, "%")
OVERRIDES["zen.workspace.zentral.notes.reveal_height_px"] = (2, 24, "px")
OVERRIDES["zen.workspace.zentral.notes.reveal_delay_ms"] = (0, 1000, "ms")
OVERRIDES["zen.workspace.zentral.notes.wide_percent"] = (130, 300, "%")

# Look ranges: mirrored from LOOK_RANGES in extension/appearance/ZentralAppearance.js (keep in sync).
OVERRIDES["zen.workspace.bgalazka.look.bottom_bar_height"] = (14, 100, "px")
OVERRIDES["zen.workspace.bgalazka.look.button_border"] = (0, 12, "px")
OVERRIDES["zen.workspace.bgalazka.look.control_size"] = (12, 64, "px")
OVERRIDES["zen.workspace.bgalazka.look.control_strength"] = (0, 300, "")
OVERRIDES["zen.workspace.bgalazka.look.essentials_height"] = (16, 160, "px")
OVERRIDES["zen.workspace.bgalazka.look.folder_icon_size"] = (8, 64, "px")
OVERRIDES["zen.workspace.bgalazka.look.newtab_height"] = (14, 80, "px")
OVERRIDES["zen.workspace.bgalazka.look.panel_border"] = (0, 12, "px")
OVERRIDES["zen.workspace.bgalazka.look.radius"] = (0, 200, "px")
OVERRIDES["zen.workspace.bgalazka.look.row_padding"] = (0, 60, "px")
OVERRIDES["zen.workspace.bgalazka.look.row_rule"] = (0, 12, "px")
OVERRIDES["zen.workspace.bgalazka.look.rss_card_border"] = (0, 30, "px")
OVERRIDES["zen.workspace.bgalazka.look.rss_card_font_size"] = (6, 72, "px")
OVERRIDES["zen.workspace.bgalazka.look.rss_card_gap"] = (0, 100, "px")
OVERRIDES["zen.workspace.bgalazka.look.rss_card_line_height"] = (80, 400, "%")
OVERRIDES["zen.workspace.bgalazka.look.rss_card_max_height"] = (10, 100, "%")
OVERRIDES["zen.workspace.bgalazka.look.rss_card_padding"] = (0, 120, "px")
OVERRIDES["zen.workspace.bgalazka.look.rss_card_radius"] = (0, 200, "px")
OVERRIDES["zen.workspace.bgalazka.look.rss_card_width"] = (120, 3000, "px")
OVERRIDES["zen.workspace.bgalazka.look.tabbar_section_gap"] = (0, 100, "px")
OVERRIDES["zen.workspace.bgalazka.look.toolbar_border"] = (0, 12, "px")
OVERRIDES["zen.workspace.bgalazka.look.urlbar_top_gap"] = (0, 100, "px")
OVERRIDES["zen.workspace.bgalazka.look.video_border"] = (0, 12, "px")
OVERRIDES["zen.workspace.bgalazka.look.video_padding"] = (0, 60, "px")
OVERRIDES["zen.workspace.bgalazka.look.video_row_height"] = (14, 80, "px")
OVERRIDES["zen.workspace.bgalazka.look.workspace_height"] = (14, 100, "px")
OVERRIDES["zen.workspace.bgalazka.look.workspace_icon_size"] = (8, 64, "px")

def px_cap(prop):
    if re.search(r"border|_rule", prop): return 50
    if "radius" in prop: return 500
    if re.search(r"font_size|icon_size", prop): return 300
    if ".look." in prop or prop.startswith("zen.workspace.bgalazka.look"): return 400
    return 4000

def range_for(prop, label, values, unit):
    if prop in OVERRIDES:
        lo, hi, _u = OVERRIDES[prop]; return lo, hi
    lo, hi = min(values), max(values)
    if unit == "%":
        return (-100 if lo < 0 else 0), 100
    if lo < 0:  # signed offsets
        return -2000, 2000
    if unit == "ms":
        return 0, min(3_600_000, max(60_000, int(hi * 4)))
    if unit == "px":
        return (0 if lo <= 1 else max(1, int(lo // 2))), min(px_cap(prop), max(int(hi * 4), int(hi) + 400))
    return (1 if lo >= 1 else 0), max(int(hi * 3), int(hi) + 10)

def collect():
    for f in sorted(glob.glob("**/settings.json", recursive=True) + ["extension/settings/extension-settings.json"]):
        if "upstream" in f: continue
        try: data = json.load(open(f, encoding="utf-8"))
        except Exception: continue
        if isinstance(data.get("schema"), list): yield f, data

report = []
for f, data in collect():
    changed = False
    for it in data["schema"]:
        vals = None
        if it.get("type") == "dropdown":
            v = [str(o["value"]) for o in it.get("options", [])]
            if v and all(NUM.fullmatch(x) for x in v): vals = [float(x) for x in v]
        elif it.get("type") == "input" and isinstance(it.get("defaultValue"), (int, float)) and not isinstance(it.get("defaultValue"), bool):
            vals = [float(it["defaultValue"])]
        if vals is None: continue
        d = it.get("defaultValue")
        if isinstance(d, (int, float)): vals.append(float(d))
        unit = OVERRIDES[it["property"]][2] if it["property"] in OVERRIDES else unit_of(it["property"], it["label"])
        lo, hi = range_for(it["property"], it["label"], vals, unit)
        meta = {"min": lo, "max": hi}
        if unit: meta["unit"] = unit
        report.append((it["property"].replace("zen.workspace.", ""), it["label"][:52], unit, lo, hi, it.get("defaultValue")))
        if it.get("numeric") != meta:
            it["numeric"] = meta; changed = True
    if changed and not DRY:
        raw = open(f, encoding="utf-8").read()
        out = json.dumps(data, indent=2, ensure_ascii=False)
        open(f, "w", encoding="utf-8").write(out + ("\n" if raw.endswith("\n") else ""))
for r in report: print("%-46s %-52s %-3s %7s..%-8s def %s" % r)
print(len(report), "numeric settings", "(dry run)" if DRY else "(written)")
