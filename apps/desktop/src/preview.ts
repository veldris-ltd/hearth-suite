/**
 * Browser-only preview harness (not shipped).
 *
 * Mounts the exact production workspace, the shared client shell, The Mantel,
 * and every module editor, against an in-memory {@link MockTransport}, so the UI
 * can be rendered and screenshotted with no Tauri runtime. It imports the same
 * stylesheets the desktop entry does, so what you see here is what the desktop
 * renders. Theme is selectable via `?theme=light|dark`; first-run onboarding
 * via `?onboarding=1`; default Ember effort via `?effort=fast|thorough`.
 */

import "@hearth/design-system/tokens.css";
import "@hearth/design-system/fonts.css";
import "@hearth/design-system/components.css";
import "./styles.css";

import { loadContacts, saveContacts, sampleContacts } from "@hearth/contacts";
import { HearthClient } from "@hearth/core-client";
import { setEffort, setOnboarded, setTheme, type Effort } from "@hearth/design-system";

import { mountWorkspace, type OpenTarget } from "./app";
import { MockTransport } from "./mock-transport";

// Force the requested theme by persisting it, so the shell's initTheme() honours
// it rather than falling back to the headless browser's OS preference.
const params = new URLSearchParams(location.search);
const theme = params.get("theme");
setTheme(theme === "light" || theme === "dark" ? theme : null);

// Show onboarding only when explicitly requested, so the app shows by default.
setOnboarded(params.get("onboarding") !== "1");

const effort = params.get("effort");
if (effort === "fast" || effort === "balanced" || effort === "thorough") {
  setEffort(effort as Effort);
}

// Seed a demo Address Book once so cross-module sharing is visible in preview.
if (loadContacts().length === 0) {
  saveContacts(sampleContacts);
}

// Deep-link / "new window" (W28): ?open=<bundleId>&module=<m> opens that doc.
const MODULES = ["writer", "sheets", "records", "calendar"];
function targetFromParams(): OpenTarget | undefined {
  const bundleId = params.get("open");
  const module = params.get("module");
  if (bundleId && module && MODULES.includes(module)) {
    return { module: module as OpenTarget["module"], bundleId };
  }
  return undefined;
}
function openWindow(target: OpenTarget): void {
  const q = new URLSearchParams({ module: target.module });
  if (target.bundleId) q.set("open", target.bundleId);
  if (theme) q.set("theme", theme);
  window.open(`preview.html?${q.toString()}`, "_blank");
}

const root = document.getElementById("app");
if (root) {
  const client = new HearthClient(new MockTransport());
  mountWorkspace(client, root, { userName: "Alex", initialTarget: targetFromParams(), openWindow });
}
