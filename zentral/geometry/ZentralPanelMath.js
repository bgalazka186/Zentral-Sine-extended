/* Extended 3.0.0 adapted-base/bridge owner. Original reference: Zentral 1.1.0.
 * See docs/BASE-PATCHES.md, docs/UPSTREAM-MAP.json and UPSTREAM.json before updating. */
/* HYBRID U110-GEO: adapted from Zentral 1.1.0 zentral_panel_geometry.uc.js.
 * One pure geometry implementation. Tiny viewports and Infinity are handled here.
 * No browser startup, global singleton or second fallback. CC BY-NC-SA 4.0. */
(function (factory) {
  const math = factory();
  if (typeof module === "object" && module.exports) module.exports = math;
  if (typeof window !== "undefined")
    window.ZentralModuleLoader.define("zentral/panel-math", () => math);
})(function () {
  "use strict";
  const finite = (x, fallback) => (Number.isFinite(x) ? x : fallback);
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(x, Math.max(lo, hi)));
  function bounds(input) {
    return {
      left: finite(input?.left, 0),
      top: finite(input?.top, 0),
      width: Math.max(1, finite(input?.width, 1)),
      height: Math.max(1, finite(input?.height, 1)),
    };
  }
  function clampRect(input, area, min = {}, options = {}) {
    const b = bounds(area);
    const minW = Math.min(b.width, Math.max(1, finite(min.minW, 280)));
    const minH = Math.min(b.height, Math.max(1, finite(min.minH, 180)));
    const w = clamp(finite(input?.w ?? input?.width, minW), minW, b.width);
    const h = clamp(finite(input?.h ?? input?.height, minH), minH, b.height);
    const visible = Math.min(
      w,
      h,
      Math.max(48, finite(options.minVisibleMargin, 80)),
    );
    const overflow = options.allowOverflow === true;
    return {
      x: Math.round(
        clamp(
          finite(input?.x ?? input?.left, b.left),
          overflow ? b.left - w + visible : b.left,
          b.left + b.width - (overflow ? visible : w),
        ),
      ),
      y: Math.round(
        clamp(
          finite(input?.y ?? input?.top, b.top),
          b.top,
          b.top + b.height - (overflow ? visible : h),
        ),
      ),
      w: Math.round(w),
      h: Math.round(h),
    };
  }
  function computeResize(dir, start, dx, dy, min = {}, area, options = {}) {
    dx = finite(dx, 0);
    dy = finite(dy, 0);
    const b = bounds(area);
    const minW = Math.min(b.width, finite(min.minW, 280)),
      minH = Math.min(b.height, finite(min.minH, 180));
    let { x, y, w, h } = start;
    if (dir.includes("e")) w = Math.max(minW, start.w + dx);
    if (dir.includes("s")) h = Math.max(minH, start.h + dy);
    if (dir.includes("w")) {
      w = Math.max(minW, start.w - dx);
      x = start.x + start.w - w;
    }
    if (dir.includes("n")) {
      h = Math.max(minH, start.h - dy);
      y = start.y + start.h - h;
    }
    return clampRect({ x, y, w, h }, b, min, options);
  }
  function dockRect(side, input, area, gap = 8) {
    const b = bounds(area);
    gap = Math.min(Math.max(0, gap), Math.max(0, (b.width - 1) / 2));
    const rect = clampRect(input, b);
    rect.w = Math.min(rect.w, b.width - 2 * gap);
    rect.x = side === "right" ? b.left + b.width - gap - rect.w : b.left + gap;
    return clampRect(rect, b);
  }
  function hitTestSnapZone(pointer, slots, threshold = 40) {
    if (!slots?.left || !slots?.right || !Number.isFinite(pointer?.x))
      return null;
    const left = slots.left.x,
      right = slots.right.x + slots.right.w;
    const dl = Math.abs(pointer.x - left),
      dr = Math.abs(pointer.x - right);
    if (Math.min(dl, dr) > threshold) return null;
    return dl <= dr ? "left" : "right";
  }
  function pickPillSide(rect, area, preferred = "right", width = 48) {
    const b = bounds(area),
      l = rect.x - b.left,
      r = b.left + b.width - rect.x - rect.w;
    if (preferred === "right" && r >= width) return "right";
    if (preferred === "left" && l >= width) return "left";
    return r >= l ? "right" : "left";
  }
  function validPlacement(value) {
    if (!value || !["docked", "floating"].includes(value.mode)) return null;
    if (
      !value.rect ||
      !["x", "y", "w", "h"].every((k) => Number.isFinite(value.rect[k])) ||
      value.rect.w <= 0 ||
      value.rect.h <= 0
    )
      return null;
    const out = {
      mode: value.mode,
      side: value.side === "right" ? "right" : "left",
      rect: { ...value.rect },
      pinned: !!value.pinned,
    };
    const d = value.dockedRect;
    if (
      d &&
      ["x", "y", "w", "h"].every((k) => Number.isFinite(d[k])) &&
      d.w > 0 &&
      d.h > 0
    )
      out.dockedRect = { x: d.x, y: d.y, w: d.w, h: d.h };
    return out;
  }
  function placementKey(id, workspace, scope = "app", role = "primary") {
    const identity = scope === "global" ? "all" : String(id || "unknown");
    return JSON.stringify([
      role,
      identity,
      scope === "workspace" ? String(workspace || "all") : "all",
    ]);
  }
  function validStartURL(value) {
    if (typeof value !== "string" || value === "about:blank") return null;
    try {
      const u = new URL(value);
      return /^(https?|moz-extension|about):$/.test(u.protocol) ? u.href : null;
    } catch (_) {
      return null;
    }
  }
  return Object.freeze({
    clampRect,
    computeResize,
    dockRect,
    hitTestSnapZone,
    pickPillSide,
    validPlacement,
    placementKey,
    validStartURL,
  });
});
