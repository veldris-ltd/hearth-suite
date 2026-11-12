/**
 * First-run onboarding, a calm, skippable welcome.
 *
 * Hearth Suite's promise is "nothing to configure to begin", so this is gentle and
 * brief: a welcome, a plain-language note that a private key was created on this
 * device, and an optional recovery-phrase save step. It renders over the
 * already-built workspace (the app is visibly "already here" behind it) and can
 * be skipped at any point. Shown once; a localStorage flag remembers completion.
 */

import type { HearthClient } from "@hearth/core-client";
import { cls, icon } from "@hearth/design-system";

import { openPairDevice } from "./pair-device";

type Step = "welcome" | "identity" | "recovery" | "restore";

/** Options for {@link Onboarding}. */
export interface OnboardingOptions {
  userName?: string;
  /**
   * Resolve the recovery phrase to display. Defaults to the core's real
   * `recoveryPhrase()` (24 BIP-39 words from the identity's master seed).
   */
  recoveryPhrase?: () => Promise<string>;
  /**
   * Restore an identity from a recovery phrase the user already holds. The host
   * recovers the seed, persists it, and reopens the core (e.g. a Tauri command).
   * When omitted, the "I already have a phrase" path is hidden. Should reject if
   * the phrase is invalid so onboarding can show an error.
   */
  onRestore?: (phrase: string) => Promise<void>;
  /** Called when the user finishes or skips, the host then shows the home. */
  onDone: () => void;
}

/** The first-run onboarding overlay. */
export class Onboarding {
  private overlay: HTMLElement | null = null;
  private step: Step = "welcome";
  private phrase = "";
  private phraseError = false;
  private fingerprint = "";
  private saved = false;
  private restoreError = "";
  private restoring = false;

  constructor(
    private readonly client: HearthClient,
    private readonly options: OnboardingOptions,
  ) {}

  /** Mount the overlay on the document body. */
  async open(): Promise<void> {
    try {
      const pk = await this.client.identityPublic();
      this.fingerprint = pk.slice(0, 10);
    } catch {
      this.fingerprint = "-";
    }
    try {
      const resolve = this.options.recoveryPhrase ?? (() => this.client.recoveryPhrase());
      this.phrase = await resolve();
      this.phraseError = this.phrase.trim().length === 0;
    } catch {
      this.phrase = "";
      this.phraseError = true;
    }
    const overlay = el("div", { class: "hb-modal__backdrop hb-onboarding" });
    this.overlay = overlay;
    document.body.append(overlay);
    this.paint();
  }

  private finish(): void {
    this.overlay?.remove();
    this.overlay = null;
    this.options.onDone();
  }

  private paint(): void {
    if (!this.overlay) {
      return;
    }
    const panel = el("div", {
      class: "hb-modal hb-onboarding__panel",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": "Welcome to Hearth Suite",
    });
    panel.append(this.renderStep(), this.renderDots());
    this.overlay.replaceChildren(panel);
  }

  private renderStep(): HTMLElement {
    switch (this.step) {
      case "welcome":
        return this.renderWelcome();
      case "identity":
        return this.renderIdentity();
      case "recovery":
        return this.renderRecovery();
      case "restore":
        return this.renderRestore();
    }
  }

  private renderWelcome(): HTMLElement {
    const body = el("div", { class: "hb-onboarding__body" });
    body.append(
      glyph("flame", 48),
      el("h1", { class: "hb-onboarding__title" }, greeting(this.options.userName)),
      el(
        "p",
        { class: "hb-onboarding__lede" },
        "Your work, your fire, yours alone. Everything lives on this device, documents, data, your keys, and your AI.",
      ),
    );
    if (this.options.onRestore) {
      const restoreLink = el(
        "button",
        { class: cls.buttonQuiet, type: "button" },
        "I already have a recovery phrase →",
      );
      restoreLink.addEventListener("click", () => this.go("restore"));
      body.append(restoreLink);
    }
    return this.frame(body, [
      ghost("Skip for now", () => this.finish()),
      primary("Get started", () => this.go("identity")),
    ]);
  }

  private renderRestore(): HTMLElement {
    const body = el("div", { class: "hb-onboarding__body" });
    const input = el("textarea", {
      class: "hb-onboarding__phrase-input",
      rows: "3",
      placeholder: "Enter your 24-word recovery phrase, separated by spaces",
      "aria-label": "Recovery phrase",
    }) as HTMLTextAreaElement;

    const error = el("p", { class: "hb-onboarding__error", role: "alert" }, this.restoreError);
    error.style.display = this.restoreError ? "" : "none";

    const restore = primary(this.restoring ? "Restoring…" : "Restore my identity", () => {
      void this.attemptRestore(input.value);
    });
    (restore as HTMLButtonElement).disabled = this.restoring;

    body.append(
      glyph("lock", 40),
      el("h1", { class: "hb-onboarding__title" }, "Restore from your recovery phrase"),
      el(
        "p",
        { class: "hb-onboarding__lede" },
        "Enter the 24 words you saved when you first set up Hearth Suite. This rebuilds your identity and reopens your sealed work on this device.",
      ),
      el("div", { class: `${cls.card} hb-onboarding__phrase-card` }, input),
      error,
    );
    return this.frame(body, [ghost("Back", () => this.go("welcome")), restore]);
  }

  private async attemptRestore(value: string): Promise<void> {
    const phrase = value.trim().replace(/\s+/g, " ");
    if (!phrase) {
      this.restoreError = "Please enter your recovery phrase.";
      this.paint();
      return;
    }
    if (!this.options.onRestore) {
      return;
    }
    this.restoring = true;
    this.restoreError = "";
    this.paint();
    try {
      await this.options.onRestore(phrase);
      // The host has reopened the core under the restored identity.
      this.finish();
    } catch {
      this.restoring = false;
      this.restoreError = "That phrase wasn't recognised. Check the words and try again.";
      this.paint();
    }
  }

  private renderIdentity(): HTMLElement {
    const body = el("div", { class: "hb-onboarding__body" });
    body.append(
      glyph("lock", 48),
      el("h1", { class: "hb-onboarding__title" }, "A private key, just for you"),
      el(
        "p",
        { class: "hb-onboarding__lede" },
        "Hearth Suite created a post-quantum key on this device. It never leaves, it's how only you (and people you choose) can open your sealed work.",
      ),
      el("p", { class: "hb-onboarding__fingerprint" }, `Your key · ${this.fingerprint}…`),
    );
    return this.frame(body, [
      ghost("Back", () => this.go("welcome")),
      primary("Next", () => this.go("recovery")),
    ]);
  }

  private renderRecovery(): HTMLElement {
    if (this.phraseError) {
      return this.renderRecoveryUnavailable();
    }
    const body = el("div", { class: "hb-onboarding__body" });
    const words = this.phrase.split(" ");
    const grid = el("div", { class: "hb-onboarding__phrase" });
    words.forEach((word, i) => {
      grid.append(
        el(
          "span",
          { class: "hb-onboarding__word" },
          el("span", { class: "hb-onboarding__word-n" }, String(i + 1)),
          word,
        ),
      );
    });

    const copy = el("button", { class: cls.buttonGhost, type: "button" }, "Copy phrase");
    copy.addEventListener("click", () => {
      void navigator.clipboard?.writeText(this.phrase).catch(() => undefined);
      copy.textContent = "Copied";
    });

    const check = el("label", { class: "hb-check" });
    const box = el("input", { class: cls.checkbox, type: "checkbox" }) as HTMLInputElement;
    const enter = primary("Enter Hearth Suite", () => this.finish());
    enter.setAttribute("aria-disabled", "true");
    (enter as HTMLButtonElement).disabled = true;
    box.addEventListener("change", () => {
      this.saved = box.checked;
      (enter as HTMLButtonElement).disabled = !this.saved;
      enter.setAttribute("aria-disabled", String(!this.saved));
    });
    check.append(box, el("span", {}, "I've saved my recovery phrase somewhere safe"));

    body.append(
      glyph("lock", 40),
      el("h1", { class: "hb-onboarding__title" }, "Save your recovery phrase"),
      el(
        "p",
        { class: "hb-onboarding__lede" },
        "These words restore your identity if you lose this device. Write them down and keep them private, Hearth Suite can't recover them for you.",
      ),
      el("div", { class: `${cls.card} hb-onboarding__phrase-card` }, grid, copy),
      check,
    );
    const pairLink = el(
      "button",
      { class: cls.buttonQuiet, type: "button" },
      "Have another device? Pair it →",
    );
    pairLink.addEventListener("click", () => void openPairDevice(this.client, {}));
    body.append(pairLink);
    return this.frame(body, [ghost("I'll do this later", () => this.finish()), enter]);
  }

  private renderRecoveryUnavailable(): HTMLElement {
    const body = el("div", { class: "hb-onboarding__body" });
    body.append(
      glyph("lock", 40),
      el("h1", { class: "hb-onboarding__title" }, "Recovery phrase unavailable"),
      el(
        "p",
        { class: "hb-onboarding__lede" },
        "Your recovery phrase couldn't be loaded right now. You can find it any time in Settings, under Security, once Hearth Suite has finished setting up.",
      ),
    );
    return this.frame(body, [
      ghost("Back", () => this.go("identity")),
      primary("Enter Hearth Suite", () => this.finish()),
    ]);
  }

  private frame(body: HTMLElement, actions: HTMLElement[]): HTMLElement {
    const footer = el("div", { class: "hb-onboarding__actions" }, ...actions);
    return el("div", { class: "hb-onboarding__step" }, body, footer);
  }

  private renderDots(): HTMLElement {
    const steps: Step[] = ["welcome", "identity", "recovery"];
    const dots = el("div", { class: "hb-onboarding__dots" });
    for (const s of steps) {
      dots.append(el("span", { class: `hb-onboarding__dot${s === this.step ? " is-on" : ""}` }));
    }
    return dots;
  }

  private go(step: Step): void {
    this.step = step;
    this.paint();
  }
}

function greeting(userName?: string): string {
  const name = userName?.trim();
  return name ? `Welcome to Hearth Suite, ${name}` : "Welcome to Hearth Suite";
}

function glyph(name: Parameters<typeof icon>[0], size: number): HTMLElement {
  const span = el("div", { class: "hb-onboarding__glyph" });
  span.innerHTML = icon(name, size);
  return span;
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
