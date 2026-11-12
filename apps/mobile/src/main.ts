/**
 * Mobile entry point. Gates the vault behind biometrics, then mounts the shared
 * client shell over the Capacitor transport and prepares on-device Ember.
 */

import "@hearth/design-system/tokens.css";
import "@hearth/design-system/fonts.css";
import "@hearth/design-system/components.css";
import "./styles.css";

import { mountWorkspace, type CalDavTransport } from "@hearth/client-shell";
import { HearthClient } from "@hearth/core-client";
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { icon, initTheme } from "@hearth/design-system";

import { unlockVault } from "./biometric";
import { ensureEmberModel } from "./ember-mobile";
import { CapacitorTransport } from "./transport";

/**
 * A CalDAV/ICS transport over Capacitor's native HTTP (AC-CAL-3/4). Native
 * requests bypass the WebView CORS sandbox, so any CalDAV server works. Only
 * used on a real device; the web preview gets no transport (the Calendar then
 * shows its honest note and still does local .ics import/export).
 */
function caldavTransport(): CalDavTransport | undefined {
  if (!Capacitor.isNativePlatform()) {
    return undefined;
  }
  const ok = (status: number): boolean => status >= 200 && status < 300;
  return {
    async get(url, headers) {
      const res = await CapacitorHttp.request({
        url,
        method: "GET",
        headers,
        responseType: "text",
      });
      if (!ok(res.status)) {
        throw new Error(`Subscribe failed: ${res.status} for ${url}`);
      }
      return typeof res.data === "string" ? res.data : String(res.data ?? "");
    },
    async put(url, body, headers) {
      const res = await CapacitorHttp.request({
        url,
        method: "PUT",
        headers: { "Content-Type": "text/calendar; charset=utf-8", ...headers },
        data: body,
      });
      if (!ok(res.status)) {
        throw new Error(`Publish failed: ${res.status} for ${url}`);
      }
    },
  };
}

async function boot(root: HTMLElement): Promise<void> {
  if (!(await unlockVault())) {
    renderLocked(root);
    return;
  }
  const client = new HearthClient(new CapacitorTransport());
  mountWorkspace(client, root, {
    onScheduleReminders: (events) => void scheduleReminders(events),
    calDavTransport: caldavTransport(),
  });
  // Default to the smallest viable tier; no download without Wi-Fi + consent.
  void ensureEmberModel(client);
}

/**
 * Schedule OS reminders via Capacitor local notifications (seam #11). Each event
 * with a lead time becomes a notification at start minus the lead minutes.
 * Degrades to a no-op if the plugin is absent (e.g. the web preview); the in-app
 * banner still fires there.
 */
async function scheduleReminders(
  events: Array<{ summary: string; start: string; reminderMinutes?: number }>,
): Promise<void> {
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.requestPermissions();
    const notifications = events
      .filter((event) => typeof event.reminderMinutes === "number")
      .map((event, index) => ({
        id: index + 1,
        title: event.summary || "Reminder",
        body: `Starts ${new Date(event.start).toLocaleString()}`,
        schedule: { at: new Date(Date.parse(event.start) - (event.reminderMinutes ?? 0) * 60_000) },
      }))
      .filter(
        (n) => !Number.isNaN(n.schedule.at.getTime()) && n.schedule.at.getTime() > Date.now(),
      );
    if (notifications.length > 0) {
      await LocalNotifications.schedule({ notifications });
    }
  } catch {
    // Plugin not present (web preview, or before the device build adds it).
  }
}

/** The locked screen shown until biometrics grant access (AC-MOB-3). */
function renderLocked(root: HTMLElement): void {
  const panel = document.createElement("div");
  panel.className = "hb-lock";

  const brand = document.createElement("div");
  brand.className = "hb-lock__brand";
  brand.innerHTML = icon("flame", 40);

  const heading = document.createElement("h1");
  heading.className = "hb-lock__title";
  heading.textContent = "Hearth Suite is locked";

  const text = document.createElement("p");
  text.textContent = "Unlock with your biometrics to continue. Everything stays on this device.";

  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "hb-btn hb-btn--primary";
  retry.textContent = "Unlock";
  retry.addEventListener("click", () => void boot(root));

  panel.append(brand, heading, text, retry);
  root.replaceChildren(panel);
}

const root = document.getElementById("app");
if (root) {
  initTheme();
  void boot(root);
}
