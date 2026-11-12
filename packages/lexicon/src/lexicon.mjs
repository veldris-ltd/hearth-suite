// Hearth Suite lexicon core, pure offline dictionary + thesaurus lookup.
//
// No DOM, no network, no I/O: a lexicon is just a function over an in-memory
// entry map. `createLexicon(entries)` is the SEAM, the bundled sample data is
// passed in by `index.ts`, and a future Rust `lexicon` core capability can back
// the same shape over the full WordNet/Wiktionary dataset via FFI without any
// surface change. Unit-tested with `node --test`.

/** Normalise a query to a lookup key: lowercase, trimmed, letters/'/- only. */
export function normalize(word) {
  return String(word ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z'-]/g, "");
}

// Cheap morphological fallbacks so "running"/"calmer"/"boxes" find their base.
const SUFFIX_RULES = [
  ["ies", "y"],
  ["ing", "e"],
  ["ing", ""],
  ["ed", "e"],
  ["ed", ""],
  ["es", ""],
  ["er", ""],
  ["est", ""],
  ["ly", ""],
  ["s", ""],
];

/**
 * Build a lexicon over an entry map: `{ word: { pos?, definitions, synonyms,
 * antonyms? } }`. All lookups are local and synchronous.
 */
export function createLexicon(entries) {
  const map = entries && typeof entries === "object" ? entries : {};

  const direct = (key) => (Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null);

  const get = (word) => {
    const w = normalize(word);
    if (w === "") {
      return null;
    }
    let hit = direct(w);
    let resolved = w;
    if (!hit) {
      for (const [suffix, replacement] of SUFFIX_RULES) {
        if (w.length > suffix.length + 1 && w.endsWith(suffix)) {
          const base = w.slice(0, w.length - suffix.length) + replacement;
          const candidate = direct(base);
          if (candidate) {
            hit = candidate;
            resolved = base;
            break;
          }
        }
      }
    }
    if (!hit) {
      return null;
    }
    return {
      word: resolved,
      pos: hit.pos,
      definitions: Array.isArray(hit.definitions) ? hit.definitions : [],
      synonyms: Array.isArray(hit.synonyms) ? hit.synonyms : [],
      antonyms: Array.isArray(hit.antonyms) ? hit.antonyms : [],
    };
  };

  return {
    lookup: get,
    define: (word) => get(word)?.definitions ?? [],
    synonyms: (word) => get(word)?.synonyms ?? [],
    antonyms: (word) => get(word)?.antonyms ?? [],
    has: (word) => get(word) !== null,
    size: Object.keys(map).length,
  };
}
