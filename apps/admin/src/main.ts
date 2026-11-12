/**
 * Admin Control Panel entry point. Requires a WebAuthn sign-in (AC-ADMIN-3),
 * then mounts the role-scoped panel.
 */

import "@hearth/design-system/tokens.css";
import "@hearth/design-system/fonts.css";
import "@hearth/design-system/components.css";
import "./styles.css";

import { icon, initTheme } from "@hearth/design-system";

import { AdminApiClient } from "./api";
import { AdminPanel } from "./app";
import { signIn } from "./auth";

async function boot(root: HTMLElement): Promise<void> {
  const api = new AdminApiClient();
  const session = await signIn(api);
  if (!session) {
    renderSignIn(root);
    return;
  }
  new AdminPanel(api, session, root).mount();
}

/** The sign-in gate shown until WebAuthn authentication succeeds. */
function renderSignIn(root: HTMLElement): void {
  const panel = document.createElement("div");
  panel.className = "hb-admin__signin";

  const brand = document.createElement("div");
  brand.className = "hb-admin__brand";
  brand.innerHTML = `${icon("flame", 40)}<span class="hb-ops__brand-text"><strong>Hearth Suite Ops</strong><small>Veldris Ltd.</small></span>`;

  const text = document.createElement("p");
  text.textContent = "Sign in with your hardware security key to continue.";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "hb-btn hb-btn--primary";
  button.textContent = "Sign in with WebAuthn";
  button.addEventListener("click", () => void boot(root));

  panel.append(brand, text, button);

  // Dev only: preview the console with synthetic data, no server required.
  // The production build always requires the WebAuthn ceremony above.
  if (import.meta.env.DEV) {
    const demo = document.createElement("button");
    demo.type = "button";
    demo.className = "hb-btn hb-btn--ghost";
    demo.textContent = "Preview the console (demo data)";
    demo.addEventListener("click", () => {
      void (async () => {
        const { MockAdminApi, demoSession } = await import("./mock-api");
        new AdminPanel(new MockAdminApi(), demoSession, root).mount();
      })();
    });
    panel.append(demo);
  }

  root.replaceChildren(panel);
}

const root = document.getElementById("app");
if (root) {
  initTheme();
  void boot(root);
}
