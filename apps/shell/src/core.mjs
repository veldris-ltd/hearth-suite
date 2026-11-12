// The Mantel's pure logic: universal local search, result routing, and
// progressive-disclosure configuration. No DOM, no I/O, unit-tested directly
// with `node --test`. The DOM/FFI layer (mantel.ts) builds on top of this.

/** The four modules, in launcher order. */
export const MODULES = [
  { id: "writer", label: "Writer", glyph: "writer", verb: "Write a document" },
  { id: "sheets", label: "Sheets", glyph: "sheets", verb: "Build a spreadsheet" },
  { id: "records", label: "Records", glyph: "records", verb: "Track records" },
  { id: "calendar", label: "Calendar", glyph: "calendar", verb: "Plan your time" },
];

/** Default mapping from a search item's kind to a module. */
export function moduleForKind(kind) {
  switch (kind) {
    case "record":
      return "records";
    case "calendar":
      return "calendar";
    case "document":
    default:
      return "writer";
  }
}

/** The module a result should open in (explicit module wins over kind). */
export function routeForResult(result) {
  return result.module ?? moduleForKind(result.kind);
}

/**
 * Rank items against a query for universal local search. All query terms must
 * match (AND); title matches outrank snippet matches. Returns sorted results.
 */
export function rankResults(query, items) {
  const normalized = query.trim().toLowerCase();
  if (normalized === "") {
    return [];
  }
  const terms = normalized.split(/\s+/);
  return items
    .map((item) => ({ item, score: scoreItem(terms, item) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title))
    .map((entry) => ({ ...entry.item, score: entry.score }));
}

function scoreItem(terms, item) {
  const title = item.title.toLowerCase();
  const haystack = `${title} ${(item.snippet ?? "").toLowerCase()}`;
  let score = 0;
  for (const term of terms) {
    if (!haystack.includes(term)) {
      return 0; // every term must appear somewhere
    }
    score += title.includes(term) ? 2 : 1;
  }
  return score;
}

// Progressive disclosure (AC-UX-MANTEL-1, AC-UX-MANTEL-3): the calm default
// surface shows only goal-oriented sections; advanced controls are revealed on
// demand and never confront a new user.
export const DEFAULT_SECTIONS = ["greeting", "quick-create", "search", "recent"];
export const ADVANCED_SECTIONS = ["seal-management", "sync", "relations"];

// Task Launcher parity (AC-WKS-S1..S6): goal-phrased Tasks that open the right
// module with the right template, each also offering a one-line Ember brief.
export const TASKS = [
  {
    id: "letter",
    label: "Write a letter",
    module: "writer",
    template: "letter",
    glyph: "writer",
    hint: "to my landlord about the boiler",
  },
  {
    id: "budget",
    label: "Plan a budget",
    module: "sheets",
    template: "budget",
    glyph: "sheets",
    hint: "a monthly budget for a family of four",
  },
  {
    id: "addresses",
    label: "Keep an address list",
    module: "records",
    template: "addresses",
    glyph: "records",
    hint: "my book-club members",
  },
  {
    id: "newsletter",
    label: "Make a newsletter",
    module: "writer",
    template: "newsletter",
    glyph: "writer",
    hint: "our street's autumn update",
  },
  {
    id: "resume",
    label: "Build a résumé",
    module: "writer",
    template: "resume",
    glyph: "writer",
    hint: "for a café job",
  },
  {
    id: "schedule",
    label: "Plan your week",
    module: "calendar",
    template: "schedule",
    glyph: "calendar",
    hint: "block focus time in the mornings",
  },
];

// Template gallery (AC-WKS-S6): browsable by category, searchable, previewable.
export const TEMPLATES = [
  {
    id: "letter",
    name: "Personal letter",
    category: "Letters",
    module: "writer",
    description: "A friendly, well-laid-out letter.",
    preview: ["Dear …", "", "Yours, …"],
  },
  {
    id: "formal-letter",
    name: "Formal letter",
    category: "Letters",
    module: "writer",
    description: "A businesslike letter with your address block.",
    preview: ["Your address", "Dear Sir/Madam,", "Yours faithfully,"],
  },
  {
    id: "resume",
    name: "Résumé",
    category: "Work",
    module: "writer",
    description: "A clean one-page résumé.",
    preview: ["Your Name", "Experience", "Education"],
  },
  {
    id: "newsletter",
    name: "Newsletter",
    category: "Home & family",
    module: "writer",
    description: "A simple newsletter with a headline.",
    preview: ["Headline", "News in brief", "What's next"],
  },
  {
    id: "budget",
    name: "Monthly budget",
    category: "Money",
    module: "sheets",
    description: "Income, expenses, and a running total.",
    preview: ["Item", "Amount", "Total"],
  },
  {
    id: "invoice",
    name: "Invoice",
    category: "Money",
    module: "sheets",
    description: "An itemised invoice with totals.",
    preview: ["Description", "Qty", "Price"],
  },
  {
    id: "addresses",
    name: "Address list",
    category: "Lists",
    module: "records",
    description: "Names, emails, and phones, an address book.",
    preview: ["Name", "Email", "Phone"],
  },
  {
    id: "inventory",
    name: "Inventory",
    category: "Lists",
    module: "records",
    description: "Track items, quantities, and where they live.",
    preview: ["Item", "Quantity", "Location"],
  },
  {
    id: "schedule",
    name: "Weekly plan",
    category: "Time",
    module: "calendar",
    description: "Block your week into focus and rest.",
    preview: ["Mon", "Tue", "Wed"],
  },
];

/** A task by id, or null. */
export function taskById(id) {
  return TASKS.find((t) => t.id === id) ?? null;
}

/** A template by id, or null. */
export function templateById(id) {
  return TEMPLATES.find((t) => t.id === id) ?? null;
}

/** The template categories, in first-seen order, prefixed with "All". */
export function templateCategories() {
  const seen = [];
  for (const t of TEMPLATES) {
    if (!seen.includes(t.category)) seen.push(t.category);
  }
  return ["All", ...seen];
}

/** Templates in a category ("All" or undefined returns everything). */
export function templatesByCategory(category) {
  return !category || category === "All"
    ? TEMPLATES
    : TEMPLATES.filter((t) => t.category === category);
}

/** Templates matching a free-text query across name/category/description. */
export function searchTemplates(query) {
  const q = String(query ?? "")
    .trim()
    .toLowerCase();
  if (q === "") return TEMPLATES;
  return TEMPLATES.filter((t) =>
    `${t.name} ${t.category} ${t.description}`.toLowerCase().includes(q),
  );
}

/** Whether a section is an advanced control (hidden by default). */
export function isAdvanced(section) {
  return ADVANCED_SECTIONS.includes(section);
}

// ---- History helpers (AC-WKS-S3: recent items show a date, newest first) ----

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A plain, locale-independent date ("9 Jun 2026") from an ISO 8601 string, or
 * null when the input is missing or unparseable. UTC so it matches stored dates.
 */
export function friendlyDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Order recent Bundles for History: most-recently-touched first. Bundles with
 * no `updatedAt` (e.g. the Rust core before the date seam closes) keep their
 * original order at the end. Pure: returns a new array, never mutates.
 */
export function sortRecentsByDate(recents) {
  return [...(recents ?? [])].sort((a, b) =>
    String(b?.updatedAt ?? "").localeCompare(String(a?.updatedAt ?? "")),
  );
}
