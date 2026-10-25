/* Standalone-only extra for the RSS package (never loaded by the full pack).
 *
 * The full pack styles the reader card through the Appearance owner
 * (extension/appearance/ZentralAppearance.js writes --bgalazka-look-rss-card-*
 * custom properties on :root). Installed alone there is no Appearance owner, so
 * this script writes the same custom properties from the RSS appearance
 * preferences; ZentralRssDisplay.css holds the theme fallbacks. Optional colors
 * are only written when a valid hex is present, otherwise the property is
 * removed and the theme token wins. Body of a function (window, runtime,
 * lifecycle) that returns its cleanup.
 */
const root = document.documentElement;
const P = "zen.workspace.bgalazka.look.";
const HEX = /^#[0-9a-f]{6}$/i;
const ATTR = "zentral-rss-standalone";
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
const optHex = (key) => {
  const v = String(read(key, "")).trim().toLowerCase();
  return HEX.test(v) ? v : "";
};
const SHADOWS = Object.freeze({
  none: "none",
  soft: "0 6px 24px #0008",
  strong: "0 12px 36px #000c",
});
const FONTS = Object.freeze({
  system: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
});
const owned = new Set();
const set = (name, value) => {
  owned.add(name);
  root.style.setProperty(name, value);
};
const unset = (name) => {
  owned.delete(name);
  root.style.removeProperty(name);
};
const PREFS = [
  P + "rss_card_width",
  P + "rss_card_max_height",
  P + "rss_card_font_size",
  P + "rss_card_line_height",
  P + "rss_card_padding",
  P + "rss_card_radius",
  P + "rss_card_border",
  P + "rss_card_opacity",
  P + "rss_card_button_radius",
  P + "rss_card_gap",
  P + "rss_card_shadow",
  P + "rss_card_font",
  P + "rss_card_background",
  P + "rss_card_text",
  P + "rss_card_url",
  P + "rss_card_border_color",
  P + "rss_card_button_background",
  P + "rss_card_button_text",
];
function apply() {
  root.setAttribute(ATTR, "");
  set("--bgalazka-look-rss-card-width", num(P + "rss_card_width", 340, 240, 560) + "px");
  set("--bgalazka-look-rss-card-max-height", num(P + "rss_card_max_height", 60, 20, 90) + "%");
  set("--bgalazka-look-rss-card-font-size", num(P + "rss_card_font_size", 13, 10, 20) + "px");
  set("--bgalazka-look-rss-card-line-height", String(num(P + "rss_card_line_height", 145, 110, 200) / 100));
  set("--bgalazka-look-rss-card-padding", num(P + "rss_card_padding", 12, 6, 24) + "px");
  set("--bgalazka-look-rss-card-radius", num(P + "rss_card_radius", 10, 0, 24) + "px");
  set("--bgalazka-look-rss-card-border", num(P + "rss_card_border", 1, 0, 3) + "px");
  set("--bgalazka-look-rss-card-opacity", num(P + "rss_card_opacity", 100, 10, 100) + "%");
  set("--bgalazka-look-rss-card-button-radius", num(P + "rss_card_button_radius", 6, 0, 16) + "px");
  set("--bgalazka-look-rss-card-gap", num(P + "rss_card_gap", 6, 0, 32) + "px");
  const shadow = String(read(P + "rss_card_shadow", "soft"));
  set("--bgalazka-look-rss-card-shadow", SHADOWS[shadow] ?? SHADOWS.soft);
  const font = String(read(P + "rss_card_font", "system"));
  set("--bgalazka-look-rss-card-font", FONTS[font] ?? FONTS.system);
  const background = optHex(P + "rss_card_background");
  if (background) set("--bgalazka-look-rss-card-background", background);
  else unset("--bgalazka-look-rss-card-background");
  const text = optHex(P + "rss_card_text");
  if (text) set("--bgalazka-look-rss-card-text", text);
  else unset("--bgalazka-look-rss-card-text");
  const url = optHex(P + "rss_card_url");
  if (url) set("--bgalazka-look-rss-card-url", url);
  else unset("--bgalazka-look-rss-card-url");
  const borderColor = optHex(P + "rss_card_border_color");
  if (borderColor) set("--bgalazka-look-rss-card-border-color", borderColor);
  else unset("--bgalazka-look-rss-card-border-color");
  const buttonBackground = optHex(P + "rss_card_button_background");
  if (buttonBackground) set("--bgalazka-look-rss-card-button-background", buttonBackground);
  else unset("--bgalazka-look-rss-card-button-background");
  const buttonText = optHex(P + "rss_card_button_text");
  if (buttonText) set("--bgalazka-look-rss-card-button-text", buttonText);
  else unset("--bgalazka-look-rss-card-button-text");
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
};
