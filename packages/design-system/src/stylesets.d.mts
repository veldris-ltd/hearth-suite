// Type declarations for the pure style-set logic (stylesets.mjs).

/** Where a style set applies. */
export type StyleScope = "writer" | "sheets";

/** What a style set targets. */
export type StyleKind = "block" | "char" | "cell";

/** A token-keyed formatting bundle (used by built-ins). */
export interface StyleFormat {
  fontFamily?: "sans" | "serif" | "mono";
  size?:
    | "display"
    | "h1"
    | "h2"
    | "h3"
    | "h4"
    | "body-lg"
    | "body"
    | "body-sm"
    | "caption"
    | "code"
    | "overline";
  weight?: "regular" | "medium" | "semibold" | "bold";
  italic?: boolean;
  underline?: boolean;
  color?: "text" | "text-muted" | "primary" | "accent";
  align?: "start" | "center" | "end";
  background?: "surface-sunken" | "surface" | "bg";
  spaceBefore?: string;
  spaceAfter?: string;
}

/** A named bundle of formatting applied in one tap. */
export interface StyleSet {
  id: string;
  name: string;
  scope: StyleScope;
  kind: StyleKind;
  builtin?: boolean;
  /** A literal CSS string (captured from a selection), wins over `format`. */
  css?: string;
  /** Token-keyed formatting (built-ins). */
  format?: StyleFormat;
  /** A plain-language number-format hint for Sheets cells (display only). */
  numberHint?: "money" | "date" | "percent" | "plain";
}

/** A minimal key/value store (e.g. localStorage or an injected shim/FFI adapter). */
export interface StyleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const BUILTIN_STYLESETS: StyleSet[];
export function styleSetCss(set: StyleSet | null | undefined): string;
export function slug(name: string): string;
export function makeStyleSet(input: {
  name: string;
  scope: StyleScope;
  kind?: StyleKind;
  css?: string;
  format?: StyleFormat;
  builtin?: boolean;
}): StyleSet;
export function loadCustomStyleSets(bundleId: string, storage?: StyleStorage): StyleSet[];
export function saveCustomStyleSet(
  bundleId: string,
  set: StyleSet,
  storage?: StyleStorage,
): StyleSet[];
export function removeCustomStyleSet(
  bundleId: string,
  id: string,
  storage?: StyleStorage,
): StyleSet[];
export function styleSetsFor(
  bundleId: string,
  scope: StyleScope,
  storage?: StyleStorage,
): StyleSet[];
