// Hearth Suite style sets, the modern heir to Microsoft Works "Easy Formats".
//
// A style set is a NAMED bundle of formatting applied in one tap: character +
// paragraph formatting for Writer, or cell formatting for Sheets. Built-ins
// ship with the design system (token-driven, so they theme); user-created sets
// ("Save this look as a style") are stored per-Bundle. Names are plain language,
// never jargon. Pure logic, no DOM, no I/O beyond an injectable key/value store
//, so it unit-tests with `node --test`.

/** Map a format bundle's token keys to concrete design-system CSS. */
function buildCss(format) {
  const parts = [];
  const f = format ?? {};
  if (f.fontFamily) parts.push(`font-family: var(--hb-font-${f.fontFamily})`);
  if (f.size) parts.push(`font-size: var(--hb-text-${f.size})`);
  if (f.weight) parts.push(`font-weight: var(--hb-weight-${f.weight})`);
  if (f.italic) parts.push("font-style: italic");
  if (f.underline) parts.push("text-decoration: underline");
  if (f.color) parts.push(`color: var(--hb-color-${f.color})`);
  if (f.align) parts.push(`text-align: ${f.align}`);
  if (f.background) parts.push(`background: var(--hb-color-${f.background})`);
  if (f.spaceBefore) parts.push(`margin-block-start: var(--hb-space-${f.spaceBefore})`);
  if (f.spaceAfter) parts.push(`margin-block-end: var(--hb-space-${f.spaceAfter})`);
  return parts.join("; ");
}

/**
 * The built-in style sets, keyed by scope. Plain-language names; token-driven
 * formatting so both themes are covered. `kind` is "block" (whole paragraph /
 * cell) or "char" (a run of selected text).
 */
export const BUILTIN_STYLESETS = [
  // Writer
  {
    id: "letter",
    name: "Letter",
    scope: "writer",
    kind: "block",
    builtin: true,
    format: {
      fontFamily: "sans",
      size: "body",
      weight: "regular",
      align: "start",
      spaceAfter: "3",
    },
  },
  {
    id: "heading",
    name: "Heading",
    scope: "writer",
    kind: "block",
    builtin: true,
    format: {
      fontFamily: "serif",
      size: "h3",
      weight: "semibold",
      color: "text",
      spaceBefore: "4",
      spaceAfter: "2",
    },
  },
  {
    id: "title",
    name: "Title",
    scope: "writer",
    kind: "block",
    builtin: true,
    format: { fontFamily: "serif", size: "h2", weight: "semibold", spaceAfter: "3" },
  },
  {
    id: "emphasis",
    name: "Emphasis",
    scope: "writer",
    kind: "char",
    builtin: true,
    format: { weight: "semibold", color: "primary" },
  },
  {
    id: "quote",
    name: "Quote",
    scope: "writer",
    kind: "block",
    builtin: true,
    format: { italic: true, color: "text-muted", spaceBefore: "2", spaceAfter: "2" },
  },
  {
    id: "caption",
    name: "Caption",
    scope: "writer",
    kind: "char",
    builtin: true,
    format: { size: "caption", color: "text-muted" },
  },
  // Sheets (cell formatting)
  {
    id: "table-money",
    name: "Table Money",
    scope: "sheets",
    kind: "cell",
    builtin: true,
    numberHint: "money",
    format: { align: "end", weight: "medium" },
  },
  {
    id: "table-schedule",
    name: "Table Schedule",
    scope: "sheets",
    kind: "cell",
    builtin: true,
    numberHint: "date",
    format: { align: "start" },
  },
  {
    id: "table-heading",
    name: "Table Heading",
    scope: "sheets",
    kind: "cell",
    builtin: true,
    format: { weight: "semibold", background: "surface-sunken", align: "start" },
  },
  {
    id: "table-total",
    name: "Table Total",
    scope: "sheets",
    kind: "cell",
    builtin: true,
    numberHint: "money",
    format: { weight: "bold", align: "end", color: "text" },
  },
];

/** The CSS for a style set: a literal `css` string wins; else built from tokens. */
export function styleSetCss(set) {
  if (!set) return "";
  if (typeof set.css === "string" && set.css !== "") return set.css;
  return buildCss(set.format);
}

/** A stable, plain id from a plain-language name. */
export function slug(name) {
  return (
    String(name)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "style"
  );
}

/**
 * Build a style set, e.g. from a captured selection. Provide either `css` (a
 * literal style string read off the selection) or a token `format`.
 */
export function makeStyleSet({ name, scope, kind = "char", css, format, builtin = false }) {
  const set = { id: slug(name), name: String(name).trim(), scope, kind, builtin };
  if (css) set.css = css;
  if (format) set.format = format;
  return set;
}

// ---- Per-Bundle persistence -------------------------------------------------
// Stored in a key/value store (localStorage in the client). This is the SEAM
// for the encrypted core store: swap `resolveStore` for an FFI-backed adapter
// and user style sets become vault-encrypted per Bundle like all content.

const keyFor = (bundleId) => `hb-styles:${bundleId}`;

function resolveStore(storage) {
  if (storage) return storage;
  return typeof globalThis !== "undefined" && globalThis.localStorage
    ? globalThis.localStorage
    : null;
}

/** Load this Bundle's user-created style sets (built-ins are not stored). */
export function loadCustomStyleSets(bundleId, storage) {
  const store = resolveStore(storage);
  if (!store) return [];
  try {
    const raw = store.getItem(keyFor(bundleId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Save (insert or replace by id) a user style set for a Bundle. */
export function saveCustomStyleSet(bundleId, set, storage) {
  const store = resolveStore(storage);
  if (!store) return [set];
  const existing = loadCustomStyleSets(bundleId, storage).filter((s) => s.id !== set.id);
  const next = [...existing, set];
  try {
    store.setItem(keyFor(bundleId), JSON.stringify(next));
  } catch {
    /* storage full or unavailable, keep the in-memory result */
  }
  return next;
}

/** Remove a user style set from a Bundle. */
export function removeCustomStyleSet(bundleId, id, storage) {
  const store = resolveStore(storage);
  if (!store) return [];
  const next = loadCustomStyleSets(bundleId, storage).filter((s) => s.id !== id);
  try {
    store.setItem(keyFor(bundleId), JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

/** All style sets available for a Bundle in a scope: built-ins then user sets. */
export function styleSetsFor(bundleId, scope, storage) {
  const builtins = BUILTIN_STYLESETS.filter((s) => s.scope === scope);
  const custom = loadCustomStyleSets(bundleId, storage).filter((s) => s.scope === scope);
  return [...builtins, ...custom];
}
