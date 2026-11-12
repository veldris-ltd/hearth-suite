/**
 * Hearth Suite design system, programmatic entry point.
 *
 * Exposes the design tokens as typed data, a theme helper, and the canonical
 * component class names. Styling ships as CSS: `@hearth/design-system/tokens.css`
 * (generated), `/components.css`, and `/fonts.css`.
 */

import { icon, ICON_NAMES, PLATFORM_MARKS, type IconName, type PlatformMark } from "./icons";
import tokens from "./tokens.json";

/** Inline brand & UI iconography. */
export { icon, ICON_NAMES, PLATFORM_MARKS };
export type { IconName, PlatformMark };

/**
 * The Hearth Suite Pro wordmark pill, an em-scaled ember-gradient "Pro" that sits
 * after the Hearth Suite wordmark. This is the ONLY Pro mark; there is no separate Pro
 * logo. Inherits its size from the surrounding text (font-size: 0.4em).
 */
export function proPill(label = "Pro"): string {
  return `<span class="hb-pro-pill">${label}</span>`;
}

/**
 * A Hearth Suite Pro badge for Pro-gated affordances. Solid by default; `ghost: true`
 * gives the quiet outline used for calm, in-context locked previews (never a nag).
 */
export function proBadge(opts: { ghost?: boolean; label?: string } = {}): string {
  const klass = opts.ghost ? "hb-pro-badge hb-pro-badge--ghost" : "hb-pro-badge";
  return `<span class="${klass}">${icon("flame", 11)}${opts.label ?? "Pro"}</span>`;
}

/** A calm "coming soon" chip for roadmap affordances. */
export function comingSoon(label = "Coming soon"): string {
  return `<span class="hb-coming-soon">${icon("clock", 11)}${label}</span>`;
}

/** The shared Ember assistant panel, one component, mounted by every module. */
export { EmberPanel } from "./ember-panel";
export type { EmberPanelOptions, EmberSuggestion, EmberRunResult } from "./ember-panel";

/** Style sets ("Easy Formats" heir): named one-tap formatting bundles. */
export {
  BUILTIN_STYLESETS,
  styleSetCss,
  slug,
  makeStyleSet,
  loadCustomStyleSets,
  saveCustomStyleSet,
  removeCustomStyleSet,
  styleSetsFor,
} from "./stylesets.mjs";
export type { StyleSet, StyleScope, StyleKind, StyleFormat, StyleStorage } from "./stylesets.mjs";

/** The available colour themes. */
export type Theme = "light" | "dark";

/** The full token set (colour, type, spacing, radius, elevation, size). */
export { tokens };

/** The shape of the token set. */
export type Tokens = typeof tokens;

/**
 * Canonical component class names, so consumers avoid stringly-typed typos.
 * These map to selectors in `components.css`.
 */
export const cls = {
  button: "hb-btn",
  buttonPrimary: "hb-btn hb-btn--primary",
  buttonSecondary: "hb-btn hb-btn--secondary",
  buttonGhost: "hb-btn hb-btn--ghost",
  buttonDanger: "hb-btn hb-btn--danger",
  buttonSeal: "hb-btn hb-btn--seal",
  buttonQuiet: "hb-btn hb-btn--quiet",
  buttonTertiary: "hb-btn hb-btn--tertiary",
  buttonLg: "hb-btn hb-btn--lg",
  buttonSm: "hb-btn hb-btn--sm",
  buttonIcon: "hb-btn hb-btn--icon",
  buttonFull: "hb-btn hb-btn--full",
  input: "hb-input",
  select: "hb-select",
  textarea: "hb-textarea",
  field: "hb-field",
  label: "hb-label",
  hint: "hb-hint",
  inputGroup: "hb-input-group",
  errorText: "hb-error-text",
  toggle: "hb-toggle",
  checkbox: "hb-checkbox",
  radio: "hb-radio",
  check: "hb-check",
  checkBox: "hb-check__box",
  checkRadio: "hb-check hb-check--radio",
  switch: "hb-switch",
  switchTrack: "hb-switch__track",
  tabs: "hb-tabs",
  tab: "hb-tab",
  segmented: "hb-segmented",
  modal: "hb-modal",
  modalHead: "hb-modal__head",
  modalTitle: "hb-modal__title",
  modalBody: "hb-modal__body",
  modalFoot: "hb-modal__foot",
  toast: "hb-toast",
  card: "hb-card",
  table: "hb-table",
  tableWrap: "hb-table-wrap",
  menu: "hb-menu",
  menuItem: "hb-menu__item",
  sidebar: "hb-sidebar",
  search: "hb-search",
  emptyState: "hb-empty",
  badge: "hb-badge",
  sealBadge: "hb-seal-badge",
  tag: "hb-tag",
  tagRemove: "hb-tag__rm",
  avatar: "hb-avatar",
  avatarStack: "hb-avatar-stack",
  spinner: "hb-spinner",
  progress: "hb-progress",
  skeleton: "hb-skeleton",
  tip: "hb-tip",
  tipBubble: "hb-tip__bubble",
  sealedChip: "hb-sealed",
  onDeviceChip: "hb-ondevice",
} as const;

/** A `.hb-badge` tone modifier. */
export type BadgeTone = "primary" | "success" | "warning" | "danger" | "info" | "seal";

/** Compose a badge class with an optional tone, e.g. `badge("seal")`. */
export function badge(tone?: BadgeTone): string {
  return tone ? `hb-badge hb-badge--${tone}` : "hb-badge";
}

/** Apply a theme by setting `data-theme` on the root element. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  root.setAttribute("data-theme", theme);
}

/** Whether the OS currently prefers a dark colour scheme. */
export function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches === true
  );
}

/**
 * A `localStorage`-shaped key/value store. The design system reads and writes
 * preferences (theme, Ember effort, onboarding) through this synchronous seam.
 * The default implementation is the browser `localStorage`; the client shell
 * injects a vault-backed adapter via {@link setPreferenceStore} so preferences
 * persist encrypted in the vault and travel with sync (P2-CL3).
 */
export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const browserStorage: PreferenceStorage = {
  getItem: (key) => (typeof localStorage === "undefined" ? null : localStorage.getItem(key)),
  setItem: (key, value) => {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
  },
  removeItem: (key) => {
    if (typeof localStorage !== "undefined") localStorage.removeItem(key);
  },
};

let prefStore: PreferenceStorage = browserStorage;

/**
 * Replace the preference store the design system reads and writes through.
 * Pass a vault-backed adapter to persist theme/effort in the encrypted store
 * (so they sync across devices); pass nothing to restore `localStorage`.
 */
export function setPreferenceStore(store: PreferenceStorage | null): void {
  prefStore = store ?? browserStorage;
}

const THEME_KEY = "hb-theme";

/** The stored theme preference, if the user has chosen one. */
export function storedTheme(): Theme | null {
  const value = prefStore.getItem(THEME_KEY);
  return value === "light" || value === "dark" ? value : null;
}

/** The theme that should currently apply: stored choice, else OS preference. */
export function resolveTheme(): Theme {
  return storedTheme() ?? (systemPrefersDark() ? "dark" : "light");
}

/**
 * Persist and apply a theme so it survives reloads. Pass no argument to clear
 * the stored choice and fall back to the OS preference.
 */
export function setTheme(theme: Theme | null, root: HTMLElement = document.documentElement): void {
  if (theme) {
    prefStore.setItem(THEME_KEY, theme);
  } else {
    prefStore.removeItem(THEME_KEY);
  }
  root.setAttribute("data-theme", theme ?? resolveTheme());
}

/** Apply the resolved theme on boot. Returns the theme that was applied. */
export function initTheme(root: HTMLElement = document.documentElement): Theme {
  const theme = resolveTheme();
  root.setAttribute("data-theme", theme);
  return theme;
}

/** Ember effort levels, matching the core client's `Effort` request field. */
export type Effort = "fast" | "balanced" | "thorough";

const EFFORT_KEY = "hb-effort";

/** The stored default Ember effort, if the user has chosen one. */
export function storedEffort(): Effort | null {
  const value = prefStore.getItem(EFFORT_KEY);
  return value === "fast" || value === "balanced" || value === "thorough" ? value : null;
}

/** The effort to use now: the stored choice, else a calm "balanced" default. */
export function resolveEffort(): Effort {
  return storedEffort() ?? "balanced";
}

/** Persist the default Ember effort (pass null to clear and fall back to balanced). */
export function setEffort(effort: Effort | null): void {
  if (effort) {
    prefStore.setItem(EFFORT_KEY, effort);
  } else {
    prefStore.removeItem(EFFORT_KEY);
  }
}

const EFFORT_OPTIONS: ReadonlyArray<{ value: Effort; label: string }> = [
  { value: "fast", label: "Fast" },
  { value: "balanced", label: "Balanced" },
  { value: "thorough", label: "Thorough" },
];

/**
 * A reusable Fast / Balanced / Thorough segmented control for Ember panels.
 * Selecting a level persists it as the default (so Settings and every editor
 * stay in sync) and calls `onChange` with the new value. Browser-only.
 */
export function emberEffortControl(
  current: Effort,
  onChange: (effort: Effort) => void,
): HTMLElement {
  const group = document.createElement("div");
  group.className = "hb-effort";
  group.setAttribute("role", "tablist");
  group.setAttribute("aria-label", "Ember effort");
  for (const option of EFFORT_OPTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hb-effort__seg";
    button.textContent = option.label;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(option.value === current));
    button.addEventListener("click", () => {
      for (const sibling of group.children) {
        sibling.setAttribute("aria-selected", String(sibling === button));
      }
      setEffort(option.value);
      onChange(option.value);
    });
    group.append(button);
  }
  return group;
}

const ONBOARDED_KEY = "hb-onboarded";

/** Whether the user has completed (or skipped) first-run onboarding. */
export function hasOnboarded(): boolean {
  return prefStore.getItem(ONBOARDED_KEY) === "1";
}

/** Record that onboarding is done (or clear it to show the flow again). */
export function setOnboarded(done = true): void {
  if (done) {
    prefStore.setItem(ONBOARDED_KEY, "1");
  } else {
    prefStore.removeItem(ONBOARDED_KEY);
  }
}
