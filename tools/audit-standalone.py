#!/usr/bin/env python3
"""Audit every additional/<mod>/ standalone package. Run from the repo root:
    python3 tools/audit-standalone.py [repo-root]
Exit code 1 when any ERROR is found. WARN lines are likely bugs worth a look."""
import json, os, re, sys, glob
root = sys.argv[1] if len(sys.argv) > 1 else "."
problems = []
def err(m, mod, text): problems.append((m, mod, text))
def load(p):
    try:
        return json.load(open(p, encoding="utf-8"))
    except Exception as e:
        return None if not os.path.exists(p) else err("ERROR", p, "invalid JSON: %s" % e)
layout = load(os.path.join(root, "extension/settings/layout.json")) or {"categories": [], "order": []}
cats = {c["id"]: c for c in layout["categories"]}
order = {x for x in layout["order"] if isinstance(x, str)}
for sj in sorted(glob.glob(os.path.join(root, "additional/*/standalone.json"))):
    d = os.path.dirname(sj); mod = os.path.basename(d)
    cfg = load(sj) or {}
    st = load(os.path.join(d, "settings.json")) or {}
    prefs = load(os.path.join(d, "preferences.json")) or []
    owner = st.get("owner", cfg.get("id", mod))
    schema = st.get("schema", [])
    props = [s["property"] for s in schema]
    meta = st.get("settings", {})
    for p in {p for p in props if props.count(p) > 1}: err("ERROR", mod, "duplicate schema property " + p)
    for p in props:
        m = meta.get(p)
        if not m: err("ERROR", mod, "no settings metadata for " + p); continue
        c = cats.get(m.get("category"))
        if m.get("owner") != owner: err("ERROR", mod, "%s meta.owner=%s != %s" % (p, m.get("owner"), owner))
        if not c: err("ERROR", mod, "%s category %s missing in layout.json" % (p, m.get("category"))); continue
        if not any(s["label"] == m.get("section") for s in c["sections"]): err("ERROR", mod, "%s section %r missing in %s" % (p, m.get("section"), c["id"]))
        if c["owner"] != owner and c["id"] != "essentials": err("ERROR", mod, "%s sits in %s-owned category %s: invisible in standalone" % (p, c["owner"], c["id"]))
        if p not in order: err("WARN", mod, p + " not in layout order")
    excl = set(cfg.get("excludePrefs", []))
    if excl: err("WARN", mod, "excludePrefs hides %d prefs from standalone: %s" % (len(excl), sorted(excl)[:4]))
    got = [x["property"] for x in prefs if "property" in x]
    for p in props:
        if p not in got and p not in excl: err("ERROR", mod, "preferences.json missing " + p)
    for p in got:
        if p not in props and p not in {b for bs in cfg.get("borrowedSettings", []) for b in bs.get("properties", [])}: err("WARN", mod, "preferences.json has unknown " + p)
    for x in prefs:
        if x.get("type") == "dropdown" and x.get("defaultValue") not in [o["value"] for o in x.get("options", [])]: err("ERROR", mod, "dropdown default not in options: " + x["property"])
        if x.get("type") != "separator" and "property" not in x: err("ERROR", mod, "preference without property: %r" % x)
    # CSS must not rely on variables only another owner defines
    css = open(os.path.join(d, cfg.get("css", "")), encoding="utf-8").read() if cfg.get("css") and os.path.exists(os.path.join(d, cfg.get("css", ""))) else ""
    own = css
    for e in cfg.get("extras", []):
        ep = os.path.join(d, e)
        if os.path.exists(ep): own += open(ep, encoding="utf-8").read()
    used = set(re.findall(r"var\(\s*(--(?:zl|bgalazka-look)[\w-]*)\s*(,?)", css))
    defined = set(re.findall(r"(--[\w-]+)\s*:", own)) | set(re.findall(r"""["'](--[\w-]+)["']""", own))
    for v, fb in sorted(used):
        if v not in defined: err("INFO" if fb else "ERROR", mod, "CSS uses %s %s but nothing in this package defines it (Appearance-only)" % (v, "with fallback" if fb else "WITHOUT fallback"))
    # inline !important in controllers beats stylesheet !important
    for f in glob.glob(os.path.join(d, "controllers/*.js")):
        t = open(f, encoding="utf-8").read()
        if re.search(r"cssText\s*=\s*[^;]*!important", t): err("WARN", mod, os.path.basename(f) + " sets inline !important cssText: stylesheet rules cannot override it")
    # generated bundle in sync with extras / controllers
    out = os.path.join(d, cfg.get("output", ""))
    if cfg.get("output") and os.path.exists(out):
        b = open(out, encoding="utf-8").read()
        for e in cfg.get("extras", []):
            ep = os.path.join(d, e)
            if os.path.exists(ep) and open(ep, encoding="utf-8").read() not in b: err("ERROR", mod, "bundle out of date vs " + e)
        for inc in cfg.get("include", []):
            if '"additional/%s/%s"' % (mod, inc) not in b: err("ERROR", mod, "bundle lacks included " + inc)
            elif not os.path.exists(os.path.join(d, inc)): err("ERROR", mod, "include missing on disk " + inc)
        m = re.search(r"\n\s*\w*\s*version\W{1,4}([\d.]+)", b)
        if cfg.get("version") and cfg["version"] not in b: err("WARN", mod, "bundle does not mention version " + cfg["version"])
    tj = load(os.path.join(d, "theme.json")) or {}
    if tj.get("version") and cfg.get("version") and tj["version"] != cfg["version"]: err("WARN", mod, "theme.json version %s != standalone.json %s" % (tj["version"], cfg["version"]))
    if tj.get("style", {}).get("chrome") and not os.path.exists(os.path.join(d, tj["style"]["chrome"])): err("ERROR", mod, "theme.json style.chrome file missing")
    print("audited", mod, "(%d settings, %d preferences)" % (len(props), len(got)))
for lvl, mod, text in problems:
    if lvl: print("%-5s %-12s %s" % (lvl, mod, text))
sys.exit(1 if any(p[0] == "ERROR" for p in problems if p) else 0)
