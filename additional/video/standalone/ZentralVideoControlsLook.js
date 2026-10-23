/* Standalone-only extra for the video package (never loaded by the full pack).
 *
 * In the full pack the Appearance controller turns three "Look" preferences into
 * root custom properties that ZentralVideoPreview.css reads. Installed alone there
 * is no Appearance controller, so the same three are applied here with the same
 * names, bounds and units:
 *   video_controls_wrap     -> --zentral-sidebar-video-wrap  (wrap | nowrap)
 *   video_controls_gap      -> --zentral-sidebar-video-gap   (0-8px, default 1)
 *   video_overlay_opacity   -> --bgalazka-look-video-overlay-opacity (0-100%, default 40)
 * The remaining Look video prefs (colors, padding, border, row height, source
 * style) only take effect inside the full pack's Atelier look and are not shipped.
 * Body of a function (window, runtime, lifecycle) that returns its cleanup.
 */
const root = document.documentElement;
const PREF_WRAP = "zen.workspace.bgalazka.look.video_controls_wrap";
const PREF_GAP = "zen.workspace.bgalazka.look.video_controls_gap";
const PREF_OVERLAY = "zen.workspace.bgalazka.look.video_overlay_opacity";
const VAR_WRAP = "--zentral-sidebar-video-wrap";
const VAR_GAP = "--zentral-sidebar-video-gap";
const VAR_OVERLAY = "--bgalazka-look-video-overlay-opacity";
const read = (key, fallback) => {
  try {
    // nsIPrefBranch types: STRING 32, INT 64, BOOL 128. Unset falls back.
    switch (Services.prefs.getPrefType(key)) {
      case 128:
        return Services.prefs.getBoolPref(key);
      case 64:
        return Services.prefs.getIntPref(key);
      case 32:
        return Services.prefs.getStringPref(key);
    }
  } catch (_) {}
  return fallback;
};
const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(min, Math.min(max, number))
    : fallback;
};
function apply() {
  root.style.setProperty(
    VAR_WRAP,
    read(PREF_WRAP, false) === true ? "wrap" : "nowrap",
  );
  root.style.setProperty(VAR_GAP, clamp(read(PREF_GAP, 1), 0, 8, 1) + "px");
  root.style.setProperty(
    VAR_OVERLAY,
    clamp(read(PREF_OVERLAY, 40), 0, 100, 40) + "%",
  );
}
const observer = { observe: apply };
const keys = [PREF_WRAP, PREF_GAP, PREF_OVERLAY];
for (const key of keys) Services.prefs.addObserver(key, observer);
apply();
return () => {
  for (const key of keys) Services.prefs.removeObserver(key, observer);
  for (const name of [VAR_WRAP, VAR_GAP, VAR_OVERLAY])
    root.style.removeProperty(name);
};
