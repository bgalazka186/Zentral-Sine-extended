/* Independent caption presentation. Inspired by Zenslop's separate caption
 * surface (b5ce39ede14a09c0095aa822ea380cbca8d236f0); implemented for Extended's
 * existing card, without copying its capture engine or adding caption polling. */
(function () {
  "use strict";
  const cache = new WeakMap();
  const layout = {
    invalidate(node) {
      if (node) cache.delete(node);
    },
    apply({
      box,
      picture,
      captionNode,
      placement = "below",
      fontSize = 12,
      maxLines = 4,
    }) {
      if (!box || !picture || !captionNode) return;
      placement = placement === "overlay" ? "overlay" : "below";
      if (box.getAttribute("data-caption-placement") !== placement)
        box.setAttribute("data-caption-placement", placement);
      if (placement === "below") {
        if (
          captionNode.parentNode !== box ||
          picture.nextElementSibling !== captionNode
        )
          picture.after(captionNode);
      } else if (captionNode.parentNode !== picture)
        picture.appendChild(captionNode);
      fontSize = Math.max(10, Math.min(28, Number(fontSize) || 12));
      maxLines = Math.max(1, Math.min(8, Number(maxLines) || 4));
      for (const [key, value] of [
        ["--zentral-caption-font-size", fontSize + "px"],
        ["--zentral-caption-max-lines", String(maxLines)],
      ])
        if (box.style.getPropertyValue(key) !== value) {
          box.style.setProperty(key, value);
          cache.delete(captionNode);
        }
      captionNode.setAttribute("aria-live", "off");
    },
    /* Single owner of caption visibility. In the "below" band the node keeps its
     * fixed height whenever captions are active, so new/empty text never changes
     * the card height (the layout shift this replaces). Only switching captions
     * off, hiding the video or the toggle button releases the space. */
    visiblePref: "zen.workspace.zentral.video_preview.captions_visible",
    isActive(deps) {
      let shown = true;
      try {
        shown = deps.Services.prefs.getBoolPref(this.visiblePref, true);
      } catch (_) {}
      return (
        !!deps.featureOn(deps.CAPTIONS_PREF) &&
        shown &&
        !deps.videoHidden &&
        deps.current?.data?.kind === "video"
      );
    },
    fitText(box, node, text) {
      let body = node.querySelector(".zentral-caption-text");
      if (!body) {
        body = node.ownerDocument.createElement("span");
        body.className = "zentral-caption-text";
        node.replaceChildren(body);
      }
      text = String(text || "")
        .replace(/\s+/g, " ")
        .trim();
      if (body.textContent !== text) body.textContent = text;
      node.title = text;
      const size =
        parseFloat(box.style.getPropertyValue("--zentral-caption-font-size")) ||
        12;
      const lines =
        Number(box.style.getPropertyValue("--zentral-caption-max-lines")) || 4;
      const mode = box.getAttribute("data-caption-overflow") || "fit";
      const signature = JSON.stringify([
        text,
        size,
        lines,
        mode,
        node.clientWidth || box.clientWidth,
      ]);
      if (cache.get(node) === signature) return;
      cache.set(node, signature);
      const width = Math.max(
        1,
        (node.clientWidth || box.clientWidth || 240) - 18,
      );
      let font = size;
      if (mode === "fit" && text) {
        const doc = node.ownerDocument;
        const canvas =
          this.measureCanvas ||
          (this.measureCanvas = doc.createElement("canvas"));
        let context;
        try {
          context = canvas.getContext("2d");
        } catch (_) {}
        if (context) {
          const computed = doc.defaultView.getComputedStyle(node);
          const family = computed.fontFamily || "sans-serif",
            weight = computed.fontWeight || "600";
          const count = () => {
            context.font = `${weight} ${font}px ${family}`;
            let count = 1,
              line = "";
            for (const word of text.split(" ")) {
              const next = line ? line + " " + word : word;
              if (context.measureText(next).width > width && line) {
                count++;
                line = word;
              } else line = next;
            }
            return count;
          };
          while (font > 8 && count() > lines) font--;
        }
      }
      // Correct the estimate using real layout (font weight, long words and
      // Gecko wrapping). Temporarily remove only the inner clamp; the outer
      // band remains fixed, so measurement never changes sidebar height.
      if (
        mode === "fit" &&
        text &&
        node.clientWidth > 18 &&
        typeof body.getBoundingClientRect === "function"
      ) {
        const properties = [
          "display",
          "max-height",
          "-webkit-line-clamp",
          "overflow",
        ];
        const previous = properties.map((key) => [
          key,
          body.style.getPropertyValue(key),
          body.style.getPropertyPriority(key),
        ]);
        body.style.setProperty("display", "block", "important");
        body.style.setProperty("max-height", "none", "important");
        body.style.setProperty("-webkit-line-clamp", "unset", "important");
        body.style.setProperty("overflow", "visible", "important");
        try {
          let lo = 8,
            hi = size,
            best = 8;
          while (lo <= hi) {
            const candidate = Math.floor((lo + hi) / 2);
            body.style.fontSize = candidate + "px";
            body.style.lineHeight = candidate * 1.35 + "px";
            const height = body.getBoundingClientRect().height;
            if (height <= candidate * 1.35 * lines + 1) {
              best = candidate;
              lo = candidate + 1;
            } else hi = candidate - 1;
          }
          font = best;
        } finally {
          for (const [key, value, priority] of previous) {
            if (value) body.style.setProperty(key, value, priority);
            else body.style.removeProperty(key);
          }
        }
      }
      body.style.fontSize = font + "px";
      body.style.lineHeight = font * 1.35 + "px";
      body.style.setProperty(
        "--zentral-caption-line-height",
        font * 1.35 + "px",
      );
      body.style.setProperty("-webkit-line-clamp", String(lines));
    },
    sync({ box, captionNode, text, active }) {
      if (!box || !captionNode) return;
      const below = box.getAttribute("data-caption-placement") !== "overlay";
      const hasText = !!text;
      if (below) {
        const hidden = !active;
        if (captionNode.hidden !== hidden) captionNode.hidden = hidden;
        captionNode.toggleAttribute("data-empty", !hasText);
      } else {
        const hidden = !active || !hasText;
        if (captionNode.hidden !== hidden) captionNode.hidden = hidden;
        captionNode.toggleAttribute("data-empty", false);
      }
      if (active && hasText) this.fitText(box, captionNode, text);
      else {
        const body = captionNode.querySelector(".zentral-caption-text");
        if (body) body.textContent = "";
        cache.delete(captionNode);
      }
    },
  };
  window.ZentralModuleLoader.define("video/caption-layout", () => layout);
})();
