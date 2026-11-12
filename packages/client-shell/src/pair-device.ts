/**
 * "Pair a device" (DSG-S4). The desktop shows a QR of this device's key card;
 * another device scans it to begin pairing. Keys copy directly between devices -
 * never through the cloud, so the actual transport is a native host seam
 * (`onScanPair`); this dialog never fabricates a connection.
 */

import type { HearthClient } from "@hearth/core-client";
import { icon } from "@hearth/design-system";

import { qrSvg } from "./qr.mjs";
import { toast } from "./toast";

export interface PairDeviceOptions {
  /**
   * Scan another device's pairing code with the camera (native host seam).
   * Resolves to the scanned payload, or null if cancelled. Absent on the web,
   * where this device instead *shows* its code to be scanned.
   */
  onScanPair?: () => Promise<string | null>;
  onError?: (message: string) => void;
}

/** Open the pairing dialog. Loads this device's key for the QR. */
export async function openPairDevice(
  client: HearthClient,
  options: PairDeviceOptions = {},
): Promise<void> {
  let key = "";
  try {
    key = await client.identityPublic();
  } catch {
    key = "";
  }
  const payload = `hearth-pair:${key || "unknown"}`;

  const overlay = el("div", { class: "hb-modal__backdrop hb-pair" });
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) overlay.remove();
  });
  const card = el("div", {
    class: "hb-modal hb-pair__card",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": "Pair a device",
  });

  const head = el(
    "div",
    { class: "hb-modal__head" },
    el("h2", { class: "hb-modal__title" }, "Pair a device"),
  );

  const body = el("div", { class: "hb-modal__body" });
  const qr = el("div", { class: "hb-pair__qr" });
  qr.innerHTML = qrSvg(payload, { size: 150 });
  const chip = el("span", { class: "hb-ondevice" });
  chip.innerHTML = `${icon("lock", 14)}<span>Keys never leave your devices</span>`;
  body.append(
    qr,
    el("p", { class: "hb-pair__lead" }, "Open Hearth Suite on your phone and scan this code."),
    el("p", { class: "hb-pair__note" }, "Your keys copy across directly, never through the cloud."),
    chip,
  );

  if (options.onScanPair) {
    const scan = el("button", { class: "hb-btn hb-btn--secondary", type: "button" });
    scan.innerHTML = `${icon("qr", 16)}<span>Scan a device instead</span>`;
    scan.addEventListener("click", () => {
      void (async () => {
        try {
          const scanned = await options.onScanPair?.();
          if (scanned) {
            toast("Device card scanned, finishing pairing securely on your devices.", {
              variant: "seal",
            });
            overlay.remove();
          }
        } catch (error) {
          options.onError?.(error instanceof Error ? error.message : String(error));
        }
      })();
    });
    body.append(el("div", { class: "hb-pair__scan" }, scan));
  } else {
    body.append(
      el(
        "p",
        { class: "hb-pair__seam" },
        "On your phone, open Hearth Suite and tap “Pair a device” to scan this code.",
      ),
    );
  }

  const done = el("button", { class: "hb-btn hb-btn--primary", type: "button" }, "Done");
  done.addEventListener("click", () => overlay.remove());
  card.append(head, body, el("div", { class: "hb-modal__foot" }, done));
  overlay.append(card);
  document.body.append(overlay);
}

function el(
  tag: string,
  attrs: Record<string, string> = {},
  ...children: Array<Node | string>
): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.append(...children);
  return node;
}
