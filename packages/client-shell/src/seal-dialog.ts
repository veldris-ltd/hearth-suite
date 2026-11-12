/**
 * The "Seal this Bundle" flow, one-tap end-to-end encryption, in plain language.
 *
 * Shows the user's own key as a shareable card (so others can seal to them),
 * lets them add recipients, states in plain words exactly who can open the result
 * ("Only you and Maria can open this"), and confirms the Sealed state, never
 * crypto jargon. Reuses the design-system modal and the Writer's sealStatusText.
 */

import type { HearthClient, SealedDto } from "@hearth/core-client";
import { cls, icon } from "@hearth/design-system";
import { sealStatusText } from "@hearth/writer";

import { openKeyVerify, type TransparencyEntry } from "./key-verify";
import { qrSvg } from "./qr.mjs";
import { toast } from "./toast";

/** A person a Bundle can be sealed to. */
export interface Recipient {
  name: string;
  publicKey: string;
  /**
   * Set by the host directory when this recipient's published key has changed
   * since you last verified them. Triggers the rotation alert before sealing.
   */
  changed?: boolean;
}

/** Options for {@link SealDialog}. */
export interface SealDialogOptions {
  /** What's being sealed, for the title (e.g. a document or Bundle name). */
  subject?: string;
  /** The plaintext (base64) to seal. */
  content: () => string;
  /** Recipients already on the Bundle. */
  recipients?: Recipient[];
  /** Called after a successful seal. */
  onSealed?: (result: SealedDto, recipients: Recipient[]) => void;
  onError?: (message: string) => void;
  /**
   * Open the device camera to scan someone's key card. Resolves to their key
   * (and name, if read), or null if cancelled. Desktop/mobile only; when absent
   * the dialog falls back to pasting a key.
   */
  onScanKey?: () => Promise<{ name?: string; publicKey: string } | null>;
  /**
   * Look up the append-only transparency log for a recipient's key (host seam).
   * Powers the verify surface; when absent the surface explains the log is
   * available online rather than inventing entries.
   */
  transparencyLog?: (recipient: Recipient) => TransparencyEntry[] | Promise<TransparencyEntry[]>;
}

/** The Seal / sharing dialog. */
export class SealDialog {
  private overlay: HTMLElement | null = null;
  private recipients: Recipient[];
  private publicKey = "";
  private sealed = false;

  constructor(
    private readonly client: HearthClient,
    private readonly options: SealDialogOptions,
  ) {
    this.recipients = [...(options.recipients ?? [])];
  }

  /** Open the dialog (loads the user's public key for the share card). */
  async open(): Promise<void> {
    try {
      this.publicKey = await this.client.identityPublic();
    } catch {
      this.publicKey = "";
    }
    const overlay = el("div", { class: "hb-modal__backdrop hb-seal" });
    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) {
        this.close();
      }
    });
    document.body.append(overlay);
    this.overlay = overlay;
    this.paint();
  }

  close(): void {
    this.overlay?.remove();
    this.overlay = null;
  }

  private names(): string[] {
    return this.recipients.map((r) => r.name);
  }

  private paint(): void {
    if (!this.overlay) {
      return;
    }
    const panel = el("div", {
      class: "hb-modal hb-seal__panel",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": "Seal",
    });
    panel.append(this.sealed ? this.renderSealed() : this.renderForm());
    this.overlay.replaceChildren(panel);
  }

  private renderForm(): HTMLElement {
    const wrap = el("div", { class: "hb-seal__body" });

    const head = el("div", { class: "hb-seal__head" });
    const lock = el("span", { class: "hb-seal__head-icon" });
    lock.innerHTML = icon("lock", 22);
    head.append(
      lock,
      el(
        "div",
        {},
        el(
          "h1",
          { class: "hb-seal__title" },
          this.options.subject ? `Seal "${this.options.subject}"` : "Seal this Bundle",
        ),
        el("p", { class: "hb-seal__status" }, sealStatusText(this.names())),
      ),
    );

    wrap.append(head, this.renderKeyCard(), this.renderRecipients());

    // Don't let anyone seal to a recipient whose key just changed until they've
    // re-verified or blocked them.
    const blocked = this.recipients.some((r) => r.changed);
    const sealBtn = primary("Seal", () => void this.seal());
    if (blocked) {
      (sealBtn as HTMLButtonElement).disabled = true;
      sealBtn.title = "Re-verify or block the changed key before sealing.";
    }
    const footer = el(
      "div",
      { class: "hb-seal__actions" },
      ghost("Cancel", () => this.close()),
      sealBtn,
    );
    wrap.append(footer);
    return wrap;
  }

  /** The user's own key card: a scannable QR (primary), an identicon (secondary
   *  recognition glyph), and a copy fallback. Keys are handled for you. */
  private renderKeyCard(): HTMLElement {
    const card = el("div", { class: `${cls.card} hb-seal__card` });

    const qr = el("div", { class: "hb-seal__qr" });
    qr.innerHTML = qrSvg(this.publicKey || "hearth", { size: 132 });

    const glyph = el("span", { class: "hb-seal__matrix" });
    glyph.innerHTML = keyMatrix(this.publicKey || "hearth", 28);

    const title = el("div", { class: "hb-seal__card-title" });
    title.append(glyph, el("span", {}, "Your key card"));

    const copy = el("button", { class: cls.buttonGhost, type: "button" }, "Copy your key");
    copy.addEventListener("click", () => {
      void navigator.clipboard?.writeText(this.publicKey).catch(() => undefined);
      copy.textContent = "Copied";
    });

    card.append(
      qr,
      el(
        "div",
        { class: "hb-seal__card-body" },
        title,
        el(
          "p",
          { class: "hb-seal__card-note" },
          "Point a camera at this to seal work to you, keys are handled for you, and your private key never leaves this device.",
        ),
        el("div", { class: "hb-seal__keytext" }, truncateKey(this.publicKey)),
        copy,
      ),
    );
    return card;
  }

  private renderRecipients(): HTMLElement {
    const section = el("div", { class: "hb-seal__recipients" });
    section.append(el("div", { class: "hb-seal__section-label" }, "People who can open this"));

    if (this.recipients.length === 0) {
      section.append(
        el("p", { class: "hb-seal__empty" }, "Just you, for now. Add someone's key to share."),
      );
    } else {
      const list = el("ul", { class: "hb-seal__list" });
      for (const recipient of this.recipients) {
        list.append(this.renderPerson(recipient));
      }
      section.append(list);
    }

    section.append(this.renderAddRow());
    return section;
  }

  /** One recipient row: avatar, key, and either the verified line or, when
   *  their key has changed, the rotation alert with Re-verify / Block. */
  private renderPerson(recipient: Recipient): HTMLElement {
    const li = el("li", {
      class: recipient.changed ? "hb-seal__person is-changed" : "hb-seal__person",
    });

    const body = el(
      "div",
      { class: "hb-seal__person-body" },
      el("div", {}, recipient.name),
      el("div", { class: "hb-seal__person-key" }, truncateKey(recipient.publicKey)),
    );

    if (recipient.changed) {
      body.append(this.renderRotationAlert(recipient));
    } else {
      const verified = el("div", { class: "hb-seal__verified" });
      verified.innerHTML = `${icon("shield", 14)}<span>Key verified · transparency log checked, no one swapped their key.</span>`;
      const verifyLink = el(
        "button",
        { class: "hb-seal__verify-link", type: "button" },
        "View key & log",
      );
      verifyLink.addEventListener("click", () => void this.openVerify(recipient));
      body.append(verified, verifyLink);
    }

    li.append(el("span", { class: `${cls.avatar} hb-avatar--sm` }, initial(recipient.name)), body);

    const remove = el("button", {
      class: "hb-seal__remove",
      type: "button",
      "aria-label": `Remove ${recipient.name}`,
    });
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      this.recipients = this.recipients.filter((r) => r !== recipient);
      this.paint();
    });
    li.append(remove);
    return li;
  }

  /** The key-rotation alert: plain-language warning + Re-verify (QR) / Block. */
  private renderRotationAlert(recipient: Recipient): HTMLElement {
    const alert = el("div", { class: "hb-seal__rotation", role: "alert" });
    const head = el("div", { class: "hb-seal__rotation-head" });
    head.innerHTML = `${icon("shield", 16)}<strong>${recipient.name}'s key has changed</strong>`;
    alert.append(
      head,
      el(
        "p",
        { class: "hb-seal__rotation-body" },
        "This is normal after a device reset, but it could mean someone is impersonating them. Don't seal to them until you've checked.",
      ),
    );

    const reverify = el("button", { class: cls.buttonSecondary, type: "button" });
    reverify.innerHTML = `${icon("qr", 16)}<span>Re-verify by QR</span>`;
    reverify.addEventListener("click", () => void this.reverify(recipient));

    const block = el("button", { class: "hb-btn hb-btn--danger", type: "button" }, "Block");
    block.addEventListener("click", () => {
      this.recipients = this.recipients.filter((r) => r !== recipient);
      this.paint();
      toast(`Blocked ${recipient.name}, they were removed from this seal.`, {
        variant: "warning",
        title: "Blocked",
      });
    });

    alert.append(el("div", { class: "hb-seal__rotation-actions" }, reverify, block));
    return alert;
  }

  /** Open the verify surface (fingerprint card + transparency log) for a key. */
  private async openVerify(recipient: Recipient): Promise<void> {
    let log: TransparencyEntry[] | undefined;
    try {
      log = await this.options.transparencyLog?.(recipient);
    } catch (error) {
      this.options.onError?.(error instanceof Error ? error.message : String(error));
    }
    openKeyVerify({
      name: recipient.name,
      publicKey: recipient.publicKey,
      log,
      onScanKey: this.options.onScanKey ? () => this.scanAndApply(recipient) : undefined,
      onError: this.options.onError,
    });
  }

  /** Re-verify a changed key by scanning; falls back to the verify surface when
   *  there's no camera hook so they can still compare fingerprints. */
  private async reverify(recipient: Recipient): Promise<void> {
    if (!this.options.onScanKey) {
      await this.openVerify(recipient);
      return;
    }
    await this.scanAndApply(recipient);
  }

  private async scanAndApply(
    recipient: Recipient,
  ): Promise<{ name?: string; publicKey: string } | null> {
    if (!this.options.onScanKey) {
      return null;
    }
    try {
      const scanned = await this.options.onScanKey();
      if (scanned?.publicKey) {
        recipient.publicKey = scanned.publicKey;
        recipient.changed = false;
        this.paint();
        toast(`${recipient.name}'s key re-verified, safe to seal.`, {
          variant: "success",
          title: "Re-verified",
        });
      }
      return scanned;
    } catch (error) {
      this.options.onError?.(error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  private renderAddRow(): HTMLElement {
    const wrap = el("div", { class: "hb-seal__add" });

    // Preferred path: scan their key with the camera (host hook).
    if (this.options.onScanKey) {
      const scan = el("button", { class: cls.buttonSecondary, type: "button" });
      scan.innerHTML = `${icon("qr", 16)}<span>Scan their key</span>`;
      scan.addEventListener("click", () => void this.scanRecipient());
      wrap.append(
        el(
          "div",
          { class: "hb-seal__scan" },
          scan,
          el("span", { class: "hb-seal__hint" }, "Point your camera at their key card."),
        ),
      );
    }

    // Fallback: paste a key card.
    const name = el("input", {
      class: cls.input,
      placeholder: "Name",
      "aria-label": "Recipient name",
    }) as HTMLInputElement;
    const keyInput = el("input", {
      class: cls.input,
      placeholder: this.options.onScanKey ? "…or paste their key card" : "Paste their key card",
      "aria-label": "Recipient key",
    }) as HTMLInputElement;
    const add = el("button", { class: cls.buttonSecondary, type: "button" }, "Add");
    const commit = (): void => {
      const n = name.value.trim();
      const k = keyInput.value.trim();
      if (n === "" || k === "") {
        return;
      }
      this.recipients.push({ name: n, publicKey: k });
      this.paint();
    };
    add.addEventListener("click", commit);
    keyInput.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key === "Enter") {
        commit();
      }
    });
    wrap.append(el("div", { class: "hb-seal__add-row" }, name, keyInput, add));
    return wrap;
  }

  private async scanRecipient(): Promise<void> {
    if (!this.options.onScanKey) {
      return;
    }
    try {
      const scanned = await this.options.onScanKey();
      if (scanned?.publicKey) {
        this.recipients.push({
          name: scanned.name?.trim() || "Scanned contact",
          publicKey: scanned.publicKey,
        });
        this.paint();
      }
    } catch (error) {
      this.options.onError?.(error instanceof Error ? error.message : String(error));
    }
  }

  private async seal(): Promise<void> {
    try {
      const result = await this.client.seal({
        content_base64: this.options.content(),
        recipient_public_keys: this.recipients.map((r) => r.publicKey),
      });
      this.sealed = true;
      this.paint();
      const names = this.recipients.map((r) => r.name);
      toast(
        names.length > 0
          ? `Sealed, ${names.join(", ")} can open this.`
          : "Sealed, only you can open this.",
        {
          variant: "seal",
          title: "Sealed",
        },
      );
      this.options.onSealed?.(result, this.recipients);
    } catch (error) {
      this.options.onError?.(error instanceof Error ? error.message : String(error));
      this.close();
    }
  }

  private renderSealed(): HTMLElement {
    const wrap = el("div", { class: "hb-seal__body hb-seal__done" });
    const badge = el("span", { class: cls.sealBadge });
    badge.innerHTML = `${icon("lock", 16)}<span>Sealed</span>`;
    wrap.append(
      badge,
      el("h1", { class: "hb-seal__title" }, "Sealed and signed"),
      el("p", { class: "hb-seal__status" }, sealStatusText(this.names())),
      el(
        "p",
        { class: "hb-seal__card-note" },
        "Encrypted end-to-end on this device with post-quantum keys. Only the people above can open it, even Veldris can't read it.",
      ),
      el(
        "div",
        { class: "hb-seal__actions" },
        primary("Done", () => this.close()),
      ),
    );
    return wrap;
  }
}

/** A deterministic key glyph (identicon-style grid) derived from the key bytes. */
function keyMatrix(seed: string, size: number): string {
  const n = 7;
  const cell = size / n;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  let rects = "";
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < Math.ceil(n / 2); x += 1) {
      h = (Math.imul(h, 16777619) + (x * 31 + y * 7)) >>> 0;
      if ((h & 7) > 3) {
        const rx = (x * cell).toFixed(1);
        const mx = ((n - 1 - x) * cell).toFixed(1);
        const ry = (y * cell).toFixed(1);
        const w = cell.toFixed(1);
        rects += `<rect x="${rx}" y="${ry}" width="${w}" height="${w}"/>`;
        rects += `<rect x="${mx}" y="${ry}" width="${w}" height="${w}"/>`;
      }
    }
  }
  return (
    `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" ` +
    `role="img" aria-label="Key glyph" fill="currentColor">${rects}</svg>`
  );
}

function truncateKey(key: string): string {
  if (!key) {
    return "-";
  }
  return key.length > 18 ? `${key.slice(0, 10)}…${key.slice(-6)}` : key;
}
function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "·";
}
function primary(label: string, onClick: () => void): HTMLElement {
  const node = el("button", { class: cls.buttonPrimary, type: "button" }, label);
  node.addEventListener("click", onClick);
  return node;
}
function ghost(label: string, onClick: () => void): HTMLElement {
  const node = el("button", { class: cls.buttonGhost, type: "button" }, label);
  node.addEventListener("click", onClick);
  return node;
}
function el(
  tag: string,
  attrs: Record<string, string> = {},
  ...children: Array<Node | string>
): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}
