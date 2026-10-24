/* Standalone-only extra for the video package (never loaded by the full pack).
 *
 * The full pack styles the video card through the Appearance owner (the "atelier"
 * look: --zl-* variables plus rules in ZentralAppearance.css). Installed alone there
 * is no Appearance owner, so this script marks the root with
 * zentral-video-standalone and writes the same --zl-* variables from the video
 * preferences; ZentralVideoPreview.css holds a slim copy of the atelier video rules
 * scoped to that attribute. Every value is always written (no "unset" magic).
 * Body of a function (window, runtime, lifecycle) that returns its cleanup.
 */
const root = document.documentElement;
const P = "zen.workspace.bgalazka.look.";
const VP = "zen.workspace.zentral.video_preview.";
const HEX = /^#[0-9a-f]{6}$/i;
const ATTR = "zentral-video-standalone";
const ATTR_SOURCE = "zentral-video-source-style";
const read = (key, fallback) => {
  try {
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
const num = (key, fallback, min, max) => {
  const n = Number(read(key, fallback));
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : fallback));
};
const hex = (key, fallback) => {
  const v = String(read(key, fallback)).trim().toLowerCase();
  return HEX.test(v) ? v : fallback;
};
const optHex = (key) => {
  const v = String(read(key, "")).trim().toLowerCase();
  return HEX.test(v) ? v : "";
};
const mix = (a, pct, b) => `color-mix(in srgb, ${a} ${pct}%, ${b})`;
const owned = new Set();
const set = (name, value) => {
  owned.add(name);
  root.style.setProperty(name, value);
};
const PREFS = [
  P + "video_controls_wrap",
  P + "video_controls_gap",
  P + "video_overlay_opacity",
  P + "video_opacity",
  P + "video_control_opacity",
  P + "video_canvas",
  P + "video_control",
  P + "video_text",
  P + "video_muted",
  P + "video_selected",
  P + "video_border",
  P + "video_padding",
  P + "video_row_height",
  P + "video_source_style",
  VP + "button_style",
  VP + "button_radius_px",
  VP + "button_size_px",
  VP + "button_icon_color",
  VP + "button_fill_color",
  VP + "button_border_color",
];
function apply() {
  root.setAttribute(ATTR, "");
  const text = hex(P + "video_text", "#d8d8d8");
  const control = hex(P + "video_control", "#000000");
  const controlOpacity = num(P + "video_control_opacity", 100, 0, 100);
  set("--zentral-sidebar-video-wrap", read(P + "video_controls_wrap", false) === true ? "wrap" : "nowrap");
  set("--zl-gap", num(P + "video_controls_gap", 1, 0, 8) + "px");
  set("--zentral-sidebar-video-gap", num(P + "video_controls_gap", 1, 0, 8) + "px");
  set("--bgalazka-look-video-overlay-opacity", num(P + "video_overlay_opacity", 40, 0, 100) + "%");
  set("--zl-video-opacity", num(P + "video_opacity", 100, 0, 100) + "%");
  set("--zl-video-control-opacity", controlOpacity + "%");
  set("--zl-video-canvas", hex(P + "video_canvas", "#0a0a0a"));
  set("--zl-video-control", control);
  set("--zl-video-text", text);
  set("--zl-video-muted", hex(P + "video_muted", "#838383"));
  set("--zl-video-selected", hex(P + "video_selected", "#7d0000"));
  set("--zl-video-border", num(P + "video_border", 0, 0, 3) + "px");
  set("--zl-video-padding", num(P + "video_padding", 0, 0, 16) + "px");
  set("--zl-video-row-height", num(P + "video_row_height", 22, 22, 36) + "px");
  set("--zl-video-radius", "0px");
  const size = num(VP + "button_size_px", 26, 18, 32) + "px";
  set("--zl-control-size", size);
  set("--zl-video-button-size", size);
  set("--zl-radius", num(VP + "button_radius_px", 4, 0, 12) + "px");
  const sourceStyle = read(P + "video_source_style", "line");
  root.setAttribute(ATTR_SOURCE, sourceStyle === "filled" ? "filled" : "line");

  // Toolbar buttons: plain = bare icons, outline = border only, filled = border + fill.
  const style = String(read(VP + "button_style", "plain"));
  const icon = optHex(VP + "button_icon_color") || text;
  const border = optHex(VP + "button_border_color");
  const fill = optHex(VP + "button_fill_color");
  const borderWidth = Math.max(1, num(P + "video_border", 0, 0, 3));
  set("--zl-button-text", icon);
  set("--zl-video-control-text", icon);
  set("--zl-button-border-color", border || mix(icon, 45, "transparent"));
  set("--zl-button-edge", style === "outline" || style === "filled" ? borderWidth + "px" : "0px");
  set(
    "--zl-panel-button-fill",
    style === "filled" ? mix(fill || control, fill ? 100 : controlOpacity, "transparent") : "transparent",
  );
  set("--zl-button-hover", mix(icon, 18, "transparent"));
}
// Sine writes several prefs in a row; coalesce them into one style update.
let pending = false;
let disposed = false;
const observer = {
  observe() {
    if (pending || disposed) return;
    pending = true;
    Promise.resolve().then(() => {
      pending = false;
      if (!disposed) apply();
    });
  },
};
for (const key of PREFS) Services.prefs.addObserver(key, observer);
apply();
return () => {
  disposed = true;
  for (const key of PREFS) Services.prefs.removeObserver(key, observer);
  for (const name of owned) root.style.removeProperty(name);
  root.removeAttribute(ATTR);
  root.removeAttribute(ATTR_SOURCE);
};
