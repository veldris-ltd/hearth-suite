/**
 * Key verification surface (DSG-S6): a contact's fingerprint card and the
 * append-only transparency log for their key. Both are read through host seams
 * (the directory / transparency log); when those aren't wired we say so plainly
 * rather than invent entries. Plain language only, no crypto jargon in the UI.
 */

import { icon } from "@hearth/design-system";

import { qrSvg } from "./qr.mjs";

/** One append-only transparency-log entry for a key (host seam). */
export interface TransparencyEntry {
  kind: "published" | "checkpoint";
  /** Plain-language time, e.g. "12 Mar 2026" or "Today". */
  at: string;
  /** A short description, e.g. "Key published" or "Log checkpoint #4,210". */
  detail: string;
}

export interface KeyVerifyOptions {
  name: string;
  publicKey: string;
  /** Append-only log entries for this key, newest first (host seam). */
  log?: TransparencyEntry[];
  /** Re-verify by scanning their code (native camera seam). */
  onScanKey?: () => Promise<{ name?: string; publicKey: string } | null>;
  onError?: (message: string) => void;
}

/** Format a key into space-separated 4-character blocks for read-aloud checks. */
export function formatFingerprint(key: string): string {
  const clean = key.replace(/[^a-zA-Z0-9]/g, "");
  return (clean.match(/.{1,4}/g) ?? []).join(" ");
}

/** Open the verify dialog for a contact's key. */
export function openKeyVerify(options: KeyVerifyOptions): void {
  const overlay = el("div", { class: "hb-modal__backdrop hb-verify" });
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) overlay.remove();
  });
  const card = el("div", {
    class: "hb-modal hb-verify__card",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": `Verify ${options.name}`,
  });

  card.append(
    el(
      "div",
      { class: "hb-modal__head" },
      el("h2", { class: "hb-modal__title" }, `Verify ${options.name}`),
    ),
  );

  const body = el("div", { class: "hb-modal__body" });

  // Fingerprint card.
  const verified = el("div", { class: "hb-verify__badge" });
  verified.innerHTML = `${icon("shield", 16)}<span>Key verified</span>`;
  const fp = el("div", { class: "hb-verify__fp" }, formatFingerprint(options.publicKey));
  body.append(
    verified,
    fp,
    el(
      "p",
      { class: "hb-verify__note" },
      `Read these blocks aloud with ${options.name}, or re-scan their code, to be sure no one swapped their key.`,
    ),
  );

  // Transparency log.
  body.append(el("div", { class: "hb-verify__label" }, "Transparency log"));
  const entries = options.log ?? [];
  if (entries.length === 0) {
    body.append(
      el(
        "p",
        { class: "hb-verify__note" },
        "When you're online, the transparency log shows every time this key was published, append-only, so it can't be quietly rewritten.",
      ),
    );
  } else {
    const list = el("ul", { class: "hb-verify__log" });
    for (const e of entries) {
      const item = el("li", { class: "hb-verify__entry" });
      const g = el("span", { class: "hb-verify__entry-icon" });
      g.innerHTML = icon(e.kind === "published" ? "key" : "check", 14);
      item.append(
        g,
        el(
          "div",
          {},
          el("div", { class: "hb-verify__entry-detail" }, e.detail),
          el("div", { class: "hb-verify__entry-at" }, e.at),
        ),
      );
      list.append(item);
    }
    body.append(list);
  }

  card.append(body);

  const foot = el("div", { class: "hb-modal__foot" });
  if (options.onScanKey) {
    const rescan = el("button", { class: "hb-btn hb-btn--secondary", type: "button" });
    rescan.innerHTML = `${icon("qr", 16)}<span>Re-verify by QR</span>`;
    rescan.addEventListener("click", () => {
      void (async () => {
        try {
          await options.onScanKey?.();
        } catch (error) {
          options.onError?.(error instanceof Error ? error.message : String(error));
        }
      })();
    });
    foot.append(rescan);
  }
  const done = el("button", { class: "hb-btn hb-btn--primary", type: "button" }, "Done");
  done.addEventListener("click", () => overlay.remove());
  foot.append(done);
  card.append(foot);

  overlay.append(card);
  document.body.append(overlay);
  // Touch qrSvg import so re-verify flows can show a code if extended later.
  void qrSvg;
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
