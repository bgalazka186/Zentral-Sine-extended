/*
 * ZENTRAL FILE GUIDE - features/apps/controllers/ZentralAppNotifications.js
 *
 * Purpose: Parses unread counts/dots from page titles, updates launcher badges, synchronizes normal and
 *   Essential apps and manages configurable fallback badge polling.
 * Interaction / execution: Lifecycle attaches title/load/pageshow listeners that call syncAllAppBadges;
 *   Apps observes the polling preference. CornerPanels supplies Essential records through
 *   runtime.panelContext.
 * Ownership / failure: Badges stay event-driven when fallback polling is Off and when a panel closes.
 *   Apps.destroy() removes its polling preference observer and stops the loop; unloading removes owned
 *   browser listeners with the browser.
 * Registration: apps/ZentralAppNotifications
 * Loaded/created by: features/apps/ZentralApps.uc.js
 * Returned factory API: ensureBadgeSyncLoop; extractBadgeFromTitle; stopBadgeSyncLoop; syncAllAppBadges;
 *   syncBadgePollingPreference; updateAppBadge
 * Live owner accessors/callbacks: badgePollingObserver; state
 * Contract fields assigned here: access.badgePollingObserver
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  window.ZentralModuleLoader.define(
    "apps/ZentralAppNotifications",
    function ({ Services, shared, runtime, access }) {
      const {
        Constants,
        Core,
        createSVGElement,
        SVG_STRINGS,
        WELL_KNOWN_SERVICES,
      } = shared;
      return {
        extractBadgeFromTitle(title) {
          if (!title || typeof title !== "string")
            return { hasNotification: false, notifCount: null };
          const trimmed = title.trim();

          const numMatch =
            trimmed.match(/^\((\d{1,3})\+?\)\s/) ||
            trimmed.match(/^\[(\d{1,3})\+?\]\s/) ||
            trimmed.match(/\b(\d+)\s+unread\b/i) ||
            trimmed.match(
              /\b(?:messages?|notif(?:ication)?s?)\s*[:(]?\s*(\d+)/i,
            ) ||
            trimmed.match(/(?:^|\s)[\u2022\u25cf\u25cb]\s*(\d+)/);

          if (numMatch && numMatch[1]) {
            const count = parseInt(numMatch[1], 10);
            if (!isNaN(count) && count > 0) {
              return { hasNotification: true, notifCount: count };
            }
          }

          const dotPattern =
            /^[\u2022\u25cf\u25cb\u25a0\u25aa\u2219\u2b24]\s|\s[\u2022\u25cf\u25cb\u25a0\u25aa\u2219\u2b24]$/;
          if (dotPattern.test(trimmed)) {
            return { hasNotification: true, notifCount: null };
          }

          return { hasNotification: false, notifCount: null };
        },
        updateAppBadge(appId, hasNotification, notifCount) {
          const btn = document.getElementById("zen-app-btn-" + appId);
          if (!btn) return;
          let badge = btn.querySelector(".zen-app-badge");
          if (hasNotification) {
            if (!badge) {
              badge = document.createElement("div");
              badge.className = "zen-app-badge";
              btn.appendChild(badge);
            }
            if (notifCount) {
              const text = notifCount > 99 ? "99+" : String(notifCount);
              if (badge.textContent !== text) badge.textContent = text;
              if (badge.hasAttribute("data-dot"))
                badge.removeAttribute("data-dot");
            } else {
              if (badge.textContent !== "") badge.textContent = "";
              if (badge.getAttribute("data-dot") !== "true")
                badge.setAttribute("data-dot", "true");
            }
          } else {
            if (badge) badge.remove();
          }
        },
        syncAllAppBadges(onlyAppId = null) {
          if (!access.state.appBrowsers || access.state.appBrowsers.size === 0)
            return;
          const appsById = new Map();
          for (const app of access.state.apps)
            if (!appsById.has(app.id)) appsById.set(app.id, app);
          for (const record of window.ZentralRuntime?.panelContext?.essentialPanels?.values() ||
            [])
            appsById.set(record.app.id, record.app);
          for (const [appId, browser] of access.state.appBrowsers.entries()) {
            if (onlyAppId && onlyAppId !== appId) continue;
            if (!browser || !browser.isConnected) continue;
            const app = appsById.get(appId);
            if (!app) continue;

            let title = "";
            try {
              title =
                browser.browsingContext?.currentWindowGlobal?.documentTitle ||
                browser.contentTitle ||
                browser.getAttribute("label") ||
                "";
            } catch (_) {
              title =
                browser.contentTitle || browser.getAttribute("label") || "";
            }

            if (!title && browser.isConnected) continue;
            const { hasNotification, notifCount } =
              this.extractBadgeFromTitle(title);
            if (
              app.hasNotification !== hasNotification ||
              app.notificationCount !== notifCount
            ) {
              app.hasNotification = hasNotification;
              app.notificationCount = notifCount;
              this.updateAppBadge(appId, hasNotification, notifCount);
            }
          }
        },
        syncBadgePollingPreference() {
          this.stopBadgeSyncLoop();
          this.ensureBadgeSyncLoop();
        },
        ensureBadgeSyncLoop() {
          if (!access.badgePollingObserver) {
            access.badgePollingObserver = {
              observe: () => this.syncBadgePollingPreference(),
            };
            Services.prefs.addObserver(
              "zen.workspace.apps.sidebar.badge_poll_interval_ms",
              access.badgePollingObserver,
            );
          }
          if (
            this._badgeSyncLoopTimer ||
            this._destroyed ||
            !access.state.appBrowsers?.size
          )
            return;
          const raw = Number(
            Core.getPref(
              "zen.workspace.apps.sidebar.badge_poll_interval_ms",
              0,
            ),
          );
          if (!Number.isFinite(raw) || raw <= 0) return;
          const delay = Math.max(1000, Math.min(3600000, raw));
          this._badgeSyncLoopTimer = setInterval(() => {
            if (!access.state.appBrowsers?.size) {
              this.stopBadgeSyncLoop();
              return;
            }
            this.syncAllAppBadges();
          }, delay);
        },
        stopBadgeSyncLoop() {
          if (this._badgeSyncLoopTimer) clearInterval(this._badgeSyncLoopTimer);
          this._badgeSyncLoopTimer = null;
        },
      };
    },
  );
})();
