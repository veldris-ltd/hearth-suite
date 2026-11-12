/**
 * Desktop entry point. Wires the design-system styles, constructs a
 * {@link HearthClient} over the Tauri transport, boots the host shell, and runs
 * a verified update check in the background.
 */

import "@hearth/design-system/tokens.css";
import "@hearth/design-system/fonts.css";
import "@hearth/design-system/components.css";
import "./styles.css";

import { HearthClient, type Transport } from "@hearth/core-client";
import {
  fetchCalDavTransport,
  type CalDavTransport,
  type FetchLike,
  type SettingsOptions,
} from "@hearth/client-shell";

import { mountWorkspace, type OpenTarget } from "./app";
import { TauriTransport } from "./transport";
import { checkForUpdates } from "./update";

/** Whether a Tauri runtime is present (the native bridge `invoke` relies on). */
function hasTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const MODULES = ["writer", "sheets", "records", "calendar"] as const;

/** A deep-linked target from the URL (?open=<bundleId>&module=<m>), for W28. */
function targetFromLocation(): OpenTarget | undefined {
  const params = new URLSearchParams(location.search);
  const bundleId = params.get("open");
  const module = params.get("module");
  if (bundleId && module && (MODULES as readonly string[]).includes(module)) {
    return { module: module as OpenTarget["module"], bundleId };
  }
  return undefined;
}

/**
 * Restore the identity from a recovery phrase (seam #7). Calls the Tauri
 * `restore_identity` command, which recovers the seed, persists it, and reopens
 * the core. Resolves on success; rejects (so onboarding shows an error) when the
 * phrase is invalid or no native runtime is present. Reloads to remount the
 * workspace under the restored identity.
 */
async function restoreIdentity(phrase: string): Promise<void> {
  if (!hasTauri()) {
    throw new Error("Restore is only available in the desktop app.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("restore_identity", { phrase });
  location.reload();
}

/**
 * Schedule OS reminders for calendar events (seam #11). Computes each reminder's
 * trigger time (start minus the lead minutes) and hands the set to the Tauri
 * `schedule_reminders` command, which fires native notifications. A no-op
 * without a native runtime (the in-app banner still covers reminders there).
 */
function scheduleReminders(
  events: Array<{ summary: string; start: string; reminderMinutes?: number }>,
): void {
  if (!hasTauri()) {
    return;
  }
  const reminders = events
    .filter((e) => typeof e.reminderMinutes === "number")
    .map((e) => ({
      title: e.summary || "Reminder",
      body: `Starts ${new Date(e.start).toLocaleString()}`,
      at_ms: Date.parse(e.start) - (e.reminderMinutes ?? 0) * 60_000,
    }))
    .filter((r) => Number.isFinite(r.at_ms));
  void import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("schedule_reminders", { reminders }))
    .catch(() => undefined);
}

/**
 * A CalDAV/ICS transport over Tauri's native HTTP plugin (seam, AC-CAL-3/4).
 * Native requests bypass the WebView's CORS sandbox, so arbitrary CalDAV
 * servers work. The plugin is imported lazily on first use; returns undefined
 * off-Tauri so the Calendar falls back to its honest "subscribe from the app"
 * note (and local .ics import/export still works everywhere).
 */
function caldavTransport(): CalDavTransport | undefined {
  if (!hasTauri()) {
    return undefined;
  }
  const nativeFetch: FetchLike = async (url, init) => {
    const { fetch } = await import("@tauri-apps/plugin-http");
    return fetch(url, init);
  };
  return fetchCalDavTransport(nativeFetch);
}

let windowSeq = 0;

/** Open a document target in a new window, Tauri WebviewWindow, else a tab. */
function openWindow(target: OpenTarget): void {
  const params = new URLSearchParams({ module: target.module });
  if (target.bundleId) {
    params.set("open", target.bundleId);
  }
  const url = `index.html?${params.toString()}`;
  windowSeq += 1;
  if (hasTauri()) {
    void import("@tauri-apps/api/webviewWindow")
      .then(({ WebviewWindow }) => {
        new WebviewWindow(`doc-${windowSeq}`, { url, title: "Hearth Suite" });
      })
      .catch(() => window.open(url, "_blank"));
  } else {
    window.open(url, "_blank");
  }
}

/**
 * Pick the transport. Under Tauri (production and `tauri dev`) this is always the
 * native bridge. When the dev server is opened in a plain browser, where the
 * bridge is absent, fall back to in-memory demo data so the UI still renders
 * instead of a blank content area. The mock is dynamically imported behind the
 * dev flag, so it is never included in a production build.
 */
async function resolveTransport(): Promise<Transport> {
  if (hasTauri() || !import.meta.env.DEV) {
    return new TauriTransport();
  }
  const { MockTransport } = await import("./mock-transport");
  console.warn("[Hearth Suite] No Tauri runtime detected, using in-browser demo data (dev only).");
  return new MockTransport();
}

const root = document.getElementById("app");
if (root) {
  void resolveTransport().then((transport) => {
    const client = new HearthClient(transport);
    void buildInfo().then((settings) => {
      mountWorkspace(client, root, {
        initialTarget: targetFromLocation(),
        openWindow,
        onRestore: hasTauri() ? restoreIdentity : undefined,
        onScheduleReminders: scheduleReminders,
        calDavTransport: caldavTransport(),
        settings,
      });
      void checkForUpdates(root);
    });
  });
}

/**
 * The build stamp for Settings > About (AC-WIN-1): the installed version from the
 * Tauri bundle, plus the commit and channel baked in at build time. A plain
 * browser dev run has none of these and shows "developer build".
 */
async function buildInfo(): Promise<SettingsOptions> {
  let appVersion: string | undefined;
  if (hasTauri()) {
    try {
      const { getVersion } = await import("@tauri-apps/api/app");
      appVersion = await getVersion();
    } catch {
      appVersion = undefined;
    }
  }
  return {
    appVersion,
    buildCommit: __HEARTH_BUILD_COMMIT__ || undefined,
    channel: __HEARTH_UPDATE_CHANNEL__ || undefined,
  };
}
