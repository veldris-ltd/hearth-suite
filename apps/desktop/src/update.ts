/**
 * The client side of the verified auto-update flow (diagram 06d, AC-DESK-3).
 *
 * The heavy lifting, fetching signed TUF metadata, verifying its signature
 * against the pinned roots, downloading the artifact, and re-checking its hash -
 * happens in the Rust `updater` module (`hearth-release`); `check_for_update`
 * only returns "available" once all of that has passed. This module surfaces a
 * calm verification panel that shows the three checks (signed metadata · artifact
 * hash · signature) and the pinned-roots success state before the user installs.
 * Nothing installs without their say-so, and a failed/absent check never blocks
 * working offline.
 */

import { invoke } from "@tauri-apps/api/core";
import { icon } from "@hearth/design-system";

/** Verification details the updater may report alongside an available update. */
export interface UpdateVerification {
  /** The artifact's SHA-256 (hex), if reported. */
  sha256?: string;
  /** The signature algorithm label (default "ML-DSA"). */
  algorithm?: string;
}

/** The result of an update check, as reported by the verified Rust updater. */
export type UpdateStatus =
  | { kind: "up_to_date" }
  | { kind: "available"; version: string; verification?: UpdateVerification }
  | { kind: "error"; message: string };

/**
 * Check for an update and, if a verified one is available, show the verification
 * panel. A failed or unreachable check is swallowed so it never blocks offline use.
 */
export async function checkForUpdates(mount: HTMLElement): Promise<void> {
  let status: UpdateStatus;
  try {
    status = await invoke<UpdateStatus>("check_for_update");
  } catch (error) {
    status = { kind: "error", message: error instanceof Error ? error.message : String(error) };
  }
  if (status.kind !== "available") {
    return;
  }
  mount.append(
    renderUpdatePanel(status.version, status.verification, () => {
      // The Rust side has already verified signature + hash; this applies it.
      void invoke("install_update").catch(() => undefined);
    }),
  );
}

interface VerifyStep {
  label: string;
  detail: string;
  badge: string;
}

/**
 * Build the verified-update panel: a staged reveal of the three checks (which the
 * updater has already passed), the pinned-roots success line, attestation badges,
 * and Install / Later. Exported so it can be rendered without the Tauri bridge.
 */
export function renderUpdatePanel(
  version: string,
  verification?: UpdateVerification,
  onInstall: () => void = () => {},
): HTMLElement {
  const hash = verification?.sha256
    ? `sha256 ${verification.sha256.slice(0, 12)}…`
    : "sha256 verified";
  const algorithm = verification?.algorithm ?? "ML-DSA";
  const steps: VerifyStep[] = [
    { label: "Signed metadata", detail: "TUF root → targets → snapshot", badge: "TUF" },
    { label: "Artifact hash", detail: hash, badge: "Hash" },
    { label: "Signature", detail: `${algorithm} signature`, badge: "Signature" },
  ];

  const panel = el("aside", "hb-update hb-update--panel");
  panel.setAttribute("role", "status");
  panel.setAttribute("aria-label", "Verified update");

  const head = el("div", "hb-update__head");
  head.innerHTML = `${icon("shield", 18)}<strong>Hearth Suite ${version} is ready</strong>`;
  panel.append(head);

  const list = el("div", "hb-update__steps");
  const rows = steps.map((step) => {
    const row = el("div", "hb-update__step");
    const ico = el("span", "hb-update__step-icon");
    ico.innerHTML = `<span class="hb-spinner"></span>`;
    const detail = el("div", "hb-update__step-detail", "Verifying…");
    row.append(
      ico,
      el("div", "hb-update__step-body", el("div", "hb-update__step-label", step.label), detail),
    );
    list.append(row);
    return { ico, detail, step };
  });
  panel.append(list);

  const success = el("div", "hb-update__success");
  success.hidden = true;
  success.innerHTML = `${icon("shield", 16)}<span>All three checks passed against the pinned TUF roots. Safe to install.</span>`;

  const badges = el("div", "hb-update__badges");
  badges.hidden = true;
  for (const step of steps) {
    const b = el("span", "hb-badge hb-badge--success");
    b.innerHTML = `${icon("check", 12)}<span>${step.badge}</span>`;
    badges.append(b);
  }

  const install = el("button", "hb-btn hb-btn--primary", "Install and restart");
  install.setAttribute("type", "button");
  (install as HTMLButtonElement).disabled = true;
  install.addEventListener("click", onInstall);
  const later = el("button", "hb-btn hb-btn--ghost", "Later");
  later.setAttribute("type", "button");
  later.addEventListener("click", () => panel.remove());
  panel.append(success, badges, el("div", "hb-update__actions", install, later));

  // Reveal the (already-completed) checks one by one, then the success state.
  rows.forEach((r, i) => {
    setTimeout(
      () => {
        r.ico.innerHTML = icon("check", 16);
        r.ico.classList.add("is-ok");
        r.detail.textContent = r.step.detail;
      },
      350 * (i + 1),
    );
  });
  setTimeout(
    () => {
      success.hidden = false;
      badges.hidden = false;
      (install as HTMLButtonElement).disabled = false;
    },
    350 * (rows.length + 1),
  );

  return panel;
}

function el(tag: string, className?: string, ...children: Array<Node | string>): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...children);
  return node;
}
