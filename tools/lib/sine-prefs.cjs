"use strict";
/* Turns internal schema items into what Sine's preference page can show.
 *  - A setting with "numeric": {min,max,unit} becomes a free text field on a twin preference
 *    "<key>_text". Sine cannot show a free numeric field for an integer preference, and a
 *    string-typed Sine field must never replace the real integer pref (direct getIntPref
 *    readers would throw). loader/ZentralRuntime.js createNumericPrefSync keeps the twin and
 *    the real preference in step and clamps to the range.
 *  - The internal-only "input" type is shown as Sine's "string".
 *  - Internal-only fields (numeric, feature, control) are not written to Sine files. */
const textKey = (property) => property + "_text";

/* The old dropdown values, shown as a hint now that any number is accepted. Long lists are thinned
 * evenly (first and last kept) so the label stays one readable line. */
const MAX_HINTS = 8;
function presetHints(item) {
  const values = [];
  for (const option of item.options || []) {
    const n = Number(option.value);
    if (Number.isFinite(n) && !values.includes(n)) values.push(n);
  }
  values.sort((a, b) => a - b);
  if (values.length <= MAX_HINTS) return values;
  const picked = new Set();
  for (let i = 0; i < MAX_HINTS; i++) picked.add(values[Math.round((i * (values.length - 1)) / (MAX_HINTS - 1))]);
  return [...picked];
}

function sineItem(item) {
  const { numeric, feature, control, ...rest } = item;
  if (numeric) {
    const unit = numeric.unit ? " " + numeric.unit : "";
    const shown = String(item.defaultValue ?? "");
    const hints = presetHints(item);
    const presets = hints.length ? `; e.g. ${hints.join(", ")}` : "";
    return {
      property: textKey(item.property),
      label: `${item.label} [${numeric.min} to ${numeric.max}${unit}${presets}]`,
      type: "string",
      defaultValue: shown,
      placeholder: shown,
    };
  }
  if (rest.type === "input") rest.type = "string";
  return rest;
}
function toSinePrefs(entries) {
  return entries.map((entry) => (entry.property ? sineItem(entry) : entry));
}
function numericList(items) {
  return items
    .filter((i) => i.property && i.numeric)
    .map((i) => ({
      key: i.property,
      text: textKey(i.property),
      min: i.numeric.min,
      max: i.numeric.max,
      def: typeof i.defaultValue === "number" ? i.defaultValue : 0,
    }));
}
module.exports = { textKey, presetHints, sineItem, toSinePrefs, numericList };
