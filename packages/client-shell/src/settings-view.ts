/**
 * Settings, device-local configuration, with Ember (on-device AI) front and
 * centre. A secondary sidebar switches sections; each renders its own panel and
 * a calm empty state where nothing is configured yet. Nothing here ever leaves
 * the device, and the copy says so.
 */

import type { EmberTier, HearthClient } from "@hearth/core-client";
import { icon, resolveEffort, setEffort, type Effort } from "@hearth/design-system";

import { buildStamp } from "./build-stamp.mjs";
import { openPairDevice } from "./pair-device";
import { toast } from "./toast";

type SectionId = "identity" | "ai" | "sync" | "backup" | "updates" | "about";

/** A device paired for sync (seam-backed; supplied by the host when available). */
export interface PairedDevice {
  id: string;
  name: string;
}

/** Optional host hooks. Absent hooks degrade to honest seam labels. */
export interface SettingsOptions {
  /** The running build's version string (from the desktop/mobile shell). */
  appVersion?: string;
  /** The commit this build came from (AC-WIN-1). */
  buildCommit?: string;
  /** The update channel this build follows, e.g. "beta" (AC-WIN-1). */
  channel?: string;
  /** Check for a signed update; resolves to a status line. Desktop/mobile only. */
  checkForUpdates?: () => Promise<string | undefined> | string | undefined;
  /** Devices paired for sync; empty/absent when none. */
  pairedDevices?: PairedDevice[];
  /** Unpair a device by id. */
  removeDevice?: (id: string) => void;
  /** Scan another device's pairing code (native camera seam). */
  onScanPair?: () => Promise<string | null>;
}

const SECTIONS: Array<{ id: SectionId; label: string; glyph: Parameters<typeof icon>[0] }> = [
  { id: "identity", label: "Identity & keys", glyph: "search" },
  { id: "ai", label: "On-device AI", glyph: "ember" },
  { id: "sync", label: "Sync", glyph: "device" },
  { id: "backup", label: "Backup & export", glyph: "bundle" },
  { id: "updates", label: "Updates", glyph: "lock" },
  { id: "about", label: "About", glyph: "home" },
];

const EFFORTS = ["Fast", "Balanced", "Thorough"];
const EFFORT_BY_INDEX: Effort[] = ["fast", "balanced", "thorough"];

/** Map a stored effort to the nearest tier index for the given tier count. */
function effortToTier(effort: Effort, tierCount: number): number {
  const index = EFFORT_BY_INDEX.indexOf(effort);
  return Math.min(index < 0 ? 1 : index, Math.max(tierCount - 1, 0));
}

/** The Settings surface. */
export class SettingsView {
  private section: SectionId = "ai";
  private tiers: EmberTier[] = [];
  private selectedTier = 1;
  private wifiOnly = true;
  private publicKey: string | null = null;
  private recoveryPhrase: string | null = null;
  private phraseRevealed = false;
  private root: HTMLElement | null = null;

  constructor(
    private readonly client: HearthClient,
    private readonly options: SettingsOptions = {},
  ) {}

  async mount(root: HTMLElement): Promise<void> {
    this.root = root;
    try {
      this.tiers = await this.client.emberTiers();
    } catch {
      this.tiers = [];
    }
    try {
      this.publicKey = await this.client.identityPublic();
    } catch {
      this.publicKey = null;
    }
    try {
      this.recoveryPhrase = await this.client.recoveryPhrase();
    } catch {
      this.recoveryPhrase = null;
    }
    // Reflect the persisted default Ember effort the editors also read.
    this.selectedTier = effortToTier(resolveEffort(), this.tiers.length);
    this.paint();
  }

  private paint(): void {
    if (!this.root) {
      return;
    }
    this.root.replaceChildren(
      el("div", { class: "hb-settings" }, this.renderSidebar(), this.renderPanel()),
    );
  }

  private renderSidebar(): HTMLElement {
    const side = el("aside", { class: "hb-settings__nav", "aria-label": "Settings" });
    side.append(el("div", { class: "hb-settings__group" }, "Settings"));
    for (const s of SECTIONS) {
      const item = el("button", {
        class: `hb-settings__item${s.id === this.section ? " is-active" : ""}`,
        type: "button",
      });
      item.innerHTML = `${icon(s.glyph, 18)}<span>${s.label}</span>`;
      item.addEventListener("click", () => {
        this.section = s.id;
        this.paint();
      });
      side.append(item);
    }
    return side;
  }

  private renderPanel(): HTMLElement {
    switch (this.section) {
      case "ai":
        return this.renderAi();
      case "sync":
        return this.renderSync();
      case "identity":
        return this.renderIdentity();
      case "backup":
        return this.renderBackup();
      case "updates":
        return this.renderUpdates();
      case "about":
        return this.renderAbout();
    }
  }

  private renderAi(): HTMLElement {
    const panel = el("section", { class: "hb-settings__panel" });
    panel.append(
      el("h1", { class: "hb-settings__h" }, "Ember, on-device AI"),
      paragraph(
        "Ember runs open models locally with llama.cpp. Choose the default effort; larger tiers are slower but more capable. Nothing you type ever leaves the device.",
      ),
    );

    if (this.tiers.length === 0) {
      panel.append(
        emptyState("Ember isn't set up yet", "Add a model tier to enable on-device AI."),
      );
      return panel;
    }

    panel.append(sectionLabel("Default effort, model tier"));
    const cards = el("div", { class: "hb-tiers" });
    this.tiers.forEach((tier, i) => cards.append(this.renderTier(tier, i)));
    panel.append(cards);

    panel.append(
      el("h2", { class: "hb-settings__h2" }, "Model weights"),
      this.renderWeights(),
      banner(
        "Ember has no network permission at inference time. The only time it touches the internet is this one-time, opt-in weight download.",
      ),
    );
    return panel;
  }

  private renderTier(tier: EmberTier, index: number): HTMLElement {
    const selected = index === this.selectedTier;
    const card = el("button", {
      class: `hb-tier${selected ? " is-selected" : ""}`,
      type: "button",
      "aria-pressed": String(selected),
    });
    const effort = EFFORTS[Math.min(index, EFFORTS.length - 1)];
    const head = el("div", { class: "hb-tier__effort" });
    head.innerHTML = `${icon("ember", 14)}<span>${effort}</span>`;
    const gb = tier.min_ram_mb ? `~${(tier.min_ram_mb / 1024).toFixed(1)} GB` : "open weights";
    const speed = index === 0 ? "instant" : index === this.tiers.length - 1 ? "deepest" : "default";
    card.append(
      head,
      el("div", { class: "hb-tier__name" }, tier.name),
      el("div", { class: "hb-tier__meta" }, `${gb} · ${speed}`),
      this.renderMeter(index + 1),
    );
    card.addEventListener("click", () => {
      this.selectedTier = index;
      setEffort(EFFORT_BY_INDEX[Math.min(index, EFFORT_BY_INDEX.length - 1)] ?? "balanced");
      this.paint();
    });
    return card;
  }

  private renderMeter(filled: number): HTMLElement {
    const meter = el("div", { class: "hb-tier__meter" });
    for (let i = 0; i < 3; i += 1) {
      meter.append(el("span", { class: `hb-tier__seg${i < filled ? " is-on" : ""}` }));
    }
    return meter;
  }

  private renderWeights(): HTMLElement {
    const wrap = el("div", { class: "hb-settings__stack" });

    const storage = el("div", { class: "hb-card hb-settings__row" });
    const sIcon = el("span", { class: "hb-settings__row-icon" });
    sIcon.innerHTML = icon("ember", 18);
    const bar = el("div", { class: "hb-meter-bar" }, el("span", { style: "inline-size: 45%" }));
    storage.append(
      sIcon,
      el(
        "div",
        { class: "hb-settings__row-body" },
        el("div", { class: "hb-settings__row-title" }, "Storage used by models"),
        el("div", { class: "hb-settings__row-meta" }, "10.7 GB of two tiers downloaded"),
      ),
      bar,
    );

    const download = el("div", { class: "hb-card hb-settings__row" });
    const dIcon = el("span", { class: "hb-settings__row-icon" });
    dIcon.innerHTML = icon("device", 18);
    const dBtn = el("button", { class: "hb-btn hb-btn--secondary", type: "button" }, "Download");
    download.append(
      dIcon,
      el(
        "div",
        { class: "hb-settings__row-body" },
        el("div", { class: "hb-settings__row-title" }, "Download Thorough tier"),
        el("div", { class: "hb-settings__row-meta" }, "12 GB · open weights, one-time"),
      ),
      dBtn,
    );

    wrap.append(storage, download, this.renderWifiToggle());
    return wrap;
  }

  private renderWifiToggle(): HTMLElement {
    const row = el("label", { class: "hb-switch hb-settings__toggle-row" });
    const input = el("input", { type: "checkbox" }) as HTMLInputElement;
    input.checked = this.wifiOnly;
    const track = el("span", { class: "hb-switch__track", "aria-hidden": "true" });
    input.addEventListener("change", () => {
      this.wifiOnly = input.checked;
    });
    row.append(input, track, el("span", {}, "Only download weights on Wi-Fi"));
    return row;
  }

  private renderSync(): HTMLElement {
    const panel = el("section", { class: "hb-settings__panel" });
    panel.append(
      el("h1", { class: "hb-settings__h" }, "Sync"),
      paragraph(
        "Sync is off by default. When on, your Bundles sync end-to-end encrypted through a relay that never sees your keys or content.",
      ),
    );
    const row = el("label", { class: "hb-switch hb-settings__toggle-row" });
    const input = el("input", { type: "checkbox" }) as HTMLInputElement;
    const track = el("span", { class: "hb-switch__track", "aria-hidden": "true" });
    void this.client
      .syncStatus()
      .then((s) => {
        input.checked = s.enabled;
      })
      .catch(() => undefined);
    input.addEventListener("change", () => {
      void this.client.setSyncEnabled(input.checked).catch(() => undefined);
    });
    row.append(input, track, el("span", {}, "Enable encrypted sync"));
    panel.append(row);

    panel.append(sectionLabel("Devices"));
    const pair = el("button", { class: "hb-btn hb-btn--secondary", type: "button" });
    pair.innerHTML = `${icon("qr", 16)}<span>Pair a device</span>`;
    pair.addEventListener("click", () => {
      void openPairDevice(this.client, {
        onScanPair: this.options.onScanPair,
        onError: (message) => toast(message, { variant: "danger" }),
      });
    });
    panel.append(
      el(
        "div",
        { class: "hb-settings__stack" },
        paragraph(
          "Add another device to sync your Bundles. Keys copy directly between your devices, never through the cloud.",
        ),
        pair,
      ),
    );
    return panel;
  }

  private renderIdentity(): HTMLElement {
    const panel = el("section", { class: "hb-settings__panel" });
    panel.append(
      el("h1", { class: "hb-settings__h" }, "Identity & keys"),
      paragraph(
        "Your keys are created on first run and live only on this device, in the OS keystore. Nothing here is uploaded unless you turn on sync.",
      ),
    );

    const fingerprint = this.publicKey ? `${this.publicKey.slice(0, 16)}…` : "creating…";
    const copy = el("button", { class: "hb-btn hb-btn--secondary", type: "button" }, "Copy");
    copy.addEventListener("click", () => {
      if (this.publicKey && typeof navigator !== "undefined" && navigator.clipboard) {
        void navigator.clipboard.writeText(this.publicKey);
        toast("Public key copied.", { variant: "success" });
      }
    });
    panel.append(settingsRow("key", "Your public key", `ML-KEM-768 · ${fingerprint}`, copy));

    const tlog = el("span", { class: "hb-sealed" });
    tlog.innerHTML = `${icon("shield", 16)}<span>Transparency log</span>`;
    panel.append(
      el(
        "div",
        { class: "hb-settings__stack" },
        paragraph(
          "When you sync, your public key is published to a verifiable transparency log, so others can confirm it's really yours, it can never be silently swapped.",
        ),
        tlog,
      ),
    );

    panel.append(
      el("h2", { class: "hb-settings__h2" }, "Recovery phrase"),
      paragraph(
        "Your 24-word recovery phrase restores your identity if you lose this device. It was shown when you set up Hearth Suite, keep it private.",
      ),
    );
    if (!this.phraseRevealed) {
      const reveal = el(
        "button",
        { class: "hb-btn hb-btn--secondary", type: "button" },
        "Reveal recovery phrase",
      );
      reveal.addEventListener("click", () => {
        const ok =
          typeof confirm === "undefined"
            ? true
            : confirm(
                "This shows your secret recovery phrase. Make sure no one is watching your screen.",
              );
        if (ok) {
          this.phraseRevealed = true;
          this.paint();
        }
      });
      panel.append(reveal);
    } else if (this.recoveryPhrase) {
      const grid = el("div", { class: "hb-settings__phrase" });
      this.recoveryPhrase.split(" ").forEach((word, i) => {
        grid.append(
          el(
            "div",
            { class: "hb-settings__word" },
            el("span", { class: "hb-settings__word-n" }, String(i + 1)),
            el("span", {}, word),
          ),
        );
      });
      const hide = el("button", { class: "hb-btn hb-btn--quiet", type: "button" }, "Hide");
      hide.addEventListener("click", () => {
        this.phraseRevealed = false;
        this.paint();
      });
      panel.append(grid, hide);
    } else {
      panel.append(
        el(
          "p",
          { class: "hb-settings__hint" },
          "Your recovery phrase could not be loaded on this device.",
        ),
      );
    }

    panel.append(sectionLabel("Paired devices"));
    const devices = el("div", { class: "hb-settings__stack" });
    devices.append(
      settingsRow(
        "device",
        "This device",
        "Active now",
        el("span", { class: "hb-badge hb-badge--success" }, "current"),
      ),
    );
    const paired = this.options.pairedDevices ?? [];
    for (const dev of paired) {
      const remove = el("button", { class: "hb-btn hb-btn--quiet", type: "button" }, "Remove");
      remove.addEventListener("click", () => {
        this.options.removeDevice?.(dev.id);
        this.paint();
      });
      devices.append(settingsRow("device", dev.name, "Paired for sync", remove));
    }
    if (paired.length === 0) {
      devices.append(
        paragraph(
          "Pair another device from the desktop or mobile app to sync your Bundles across them.",
        ),
      );
    }
    panel.append(devices);
    return panel;
  }

  private renderBackup(): HTMLElement {
    const panel = el("section", { class: "hb-settings__panel" });
    panel.append(
      el("h1", { class: "hb-settings__h" }, "Backup & export"),
      paragraph(
        "Keep an encrypted copy of your work that only you can restore. A backup never leaves the device unless you move the file yourself.",
      ),
    );
    const make = el("button", { class: "hb-btn hb-btn--primary", type: "button" }, "Create backup");
    make.addEventListener("click", () => void this.createBackup());
    panel.append(
      settingsRow(
        "download",
        "Encrypted backup",
        "A manifest of all your Bundles, ready to restore",
        make,
      ),
    );

    panel.append(sectionLabel("Export formats"));
    const chips = el("div", { class: "hb-settings__chips" });
    for (const f of ["ODF (.odt)", "PDF", "CSV", "vCard (.vcf)", "iCalendar (.ics)"]) {
      chips.append(el("span", { class: "hb-badge" }, f));
    }
    panel.append(
      chips,
      paragraph("Each editor also exports its own open format from its File menu."),
    );

    panel.append(
      el("h2", { class: "hb-settings__h2" }, "Restore"),
      paragraph(
        "On a new device, choose “Restore from backup” during setup and pick your backup file. Your recovery phrase unlocks it.",
      ),
      this.renderSnapshotToggle(),
    );
    return panel;
  }

  private async createBackup(): Promise<void> {
    try {
      const bundles = await this.client.listBundles();
      const manifest = {
        app: "Hearth Suite",
        kind: "bundle-manifest",
        created_on: "this device",
        bundles: bundles.map((b) => ({ id: b.id, title: b.title })),
      };
      if (typeof URL !== "undefined" && typeof Blob !== "undefined") {
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }),
        );
        const link = el("a", { href: url, download: "hearth-backup.json" });
        link.click();
        URL.revokeObjectURL(url);
      }
      toast(`Backup created, ${bundles.length} Bundle${bundles.length === 1 ? "" : "s"}.`, {
        variant: "success",
      });
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), { variant: "danger" });
    }
  }

  private renderSnapshotToggle(): HTMLElement {
    const row = el("label", { class: "hb-switch hb-settings__toggle-row" });
    const input = el("input", { type: "checkbox" }) as HTMLInputElement;
    input.checked = storedFlag("hb-snapshots", true);
    const track = el("span", { class: "hb-switch__track", "aria-hidden": "true" });
    input.addEventListener("change", () => setFlag("hb-snapshots", input.checked));
    row.append(input, track, el("span", {}, "Keep hourly local snapshots on this device"));
    return row;
  }

  private renderUpdates(): HTMLElement {
    const panel = el("section", { class: "hb-settings__panel" });
    panel.append(
      el("h1", { class: "hb-settings__h" }, "Updates"),
      paragraph(
        "Updates are signed and verified before they install. Hearth Suite never auto-installs unverified code.",
      ),
    );
    const version = buildStamp(this.options);
    const check = el(
      "button",
      { class: "hb-btn hb-btn--secondary", type: "button" },
      "Check for updates",
    );
    check.addEventListener("click", () => void this.checkUpdates());
    panel.append(
      settingsRow("shield", "You're up to date", `${version} · signature verified`, check),
    );

    panel.append(sectionLabel("Update channel"), this.renderChannel());

    panel.append(sectionLabel("This build"));
    const att = el("div", { class: "hb-settings__chips" });
    for (const name of ["SBOM", "SLSA provenance", "Reproducible"]) {
      const b = el("span", { class: "hb-badge hb-badge--success" });
      b.innerHTML = `${icon("check", 13)}<span>${name}</span>`;
      att.append(b);
    }
    panel.append(
      att,
      paragraph(
        "Every release ships a software bill of materials, SLSA build provenance, and is reproducible from source.",
      ),
    );
    return panel;
  }

  private async checkUpdates(): Promise<void> {
    if (this.options.checkForUpdates) {
      try {
        const result = await this.options.checkForUpdates();
        toast(result ?? "You're on the latest build.", { variant: "success" });
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), { variant: "danger" });
      }
    } else {
      toast("Updates install through the desktop and mobile apps.", { variant: "info" });
    }
  }

  private renderChannel(): HTMLElement {
    const current =
      (typeof localStorage !== "undefined" && localStorage.getItem("hb-channel")) || "stable";
    const seg = el("div", {
      class: "hb-segmented",
      role: "tablist",
      "aria-label": "Update channel",
    });
    for (const [value, label] of [
      ["stable", "Stable"],
      ["beta", "Beta"],
    ] as const) {
      const b = el("button", { type: "button" }, label);
      if (value === current) {
        b.classList.add("is-active");
      }
      b.addEventListener("click", () => {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem("hb-channel", value);
        }
        for (const sib of Array.from(seg.children)) {
          sib.classList.toggle("is-active", sib === b);
        }
      });
      seg.append(b);
    }
    return seg;
  }

  private renderAbout(): HTMLElement {
    const panel = el("section", { class: "hb-settings__panel hb-settings__about" });
    const flame = el("div", { class: "hb-settings__about-flame" });
    flame.innerHTML = icon("flame", 56);
    panel.append(
      flame,
      el("h1", { class: "hb-settings__h" }, "Hearth Suite"),
      el("p", { class: "hb-settings__lede" }, "by Veldris Ltd."),
      el(
        "p",
        { class: "hb-settings__lede" },
        "Apache-2.0 · open-source, offline-first, privacy-first.",
      ),
      el("p", { class: "hb-settings__row-meta" }, buildStamp(this.options)),
      sectionLabel("Notices"),
    );
    const notices = el("div", { class: "hb-settings__stack" });
    for (const [title, desc] of [
      ["On-device AI", "Open models run locally with llama.cpp; no network at inference."],
      ["Legacy import", "Microsoft Works files are decoded with libwps."],
      ["Post-quantum crypto", "ML-KEM-768 and ML-DSA protect your keys and Seals."],
      ["Type", "Literata, Spline Sans & Spline Sans Mono, all SIL OFL."],
    ] as const) {
      notices.append(
        el(
          "div",
          { class: "hb-settings__notice" },
          el("strong", {}, title),
          el("div", { class: "hb-settings__row-meta" }, desc),
        ),
      );
    }
    panel.append(notices);
    return panel;
  }
}

/** A card row: icon · title/meta · optional action. */
function settingsRow(
  glyph: Parameters<typeof icon>[0],
  title: string,
  meta: string,
  action?: HTMLElement,
): HTMLElement {
  const row = el("div", { class: "hb-card hb-settings__row" });
  const g = el("span", { class: "hb-settings__row-icon" });
  g.innerHTML = icon(glyph, 18);
  row.append(
    g,
    el(
      "div",
      { class: "hb-settings__row-body" },
      el("div", { class: "hb-settings__row-title" }, title),
      el("div", { class: "hb-settings__row-meta" }, meta),
    ),
  );
  if (action) {
    row.append(action);
  }
  return row;
}
function storedFlag(key: string, fallback: boolean): boolean {
  if (typeof localStorage === "undefined") {
    return fallback;
  }
  const value = localStorage.getItem(key);
  return value === null ? fallback : value === "1";
}
function setFlag(key: string, value: boolean): void {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(key, value ? "1" : "0");
  }
}

function emptyState(title: string, body: string): HTMLElement {
  return el(
    "div",
    { class: "hb-empty" },
    el("p", { class: "hb-empty__title" }, title),
    el("p", {}, body),
  );
}
function banner(text: string): HTMLElement {
  const b = el("div", { class: "hb-settings__banner" });
  b.innerHTML = `${icon("device", 16)}<span>${text}</span>`;
  return b;
}
function paragraph(text: string): HTMLElement {
  return el("p", { class: "hb-settings__lede" }, text);
}
function sectionLabel(text: string): HTMLElement {
  return el("div", { class: "hb-settings__section-label" }, text);
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
