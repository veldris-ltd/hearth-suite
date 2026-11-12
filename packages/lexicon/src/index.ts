/**
 * Hearth Suite lexicon, offline dictionary definitions and thesaurus synonyms.
 *
 * Fully local: never makes a network call. The default `lookup`/`define`/
 * `synonyms` run over a bundled open-licence sample (`data.json`); the
 * production build loads the full WordNet/Wiktionary dataset through the core
 * `lexicon` FFI capability and constructs a {@link Lexicon} with the same shape
 * via {@link createLexicon}. Surfaces (Writer lookup, Mantel utility, Ember
 * elaboration) depend only on this stable interface.
 */

import data from "./data.json";
import { createLexicon, normalize } from "./lexicon.mjs";
import type { Lexicon, LexiconEntry, LexiconRecord } from "./lexicon.mjs";

export { createLexicon, normalize };
export type { Lexicon, LexiconEntry, LexiconRecord };

/** Licence/provenance of the bundled sample dataset. */
export const lexiconLicense: string = data.license;

/**
 * The active lexicon. Starts on the bundled CC0 sample; the client shell swaps
 * it for the core's full dataset via {@link setLexiconSource} once loaded (seam
 * #9). The `lookup`/`define`/… exports read it at call time, so every surface
 * sees the upgrade without re-importing.
 */
let active: Lexicon = createLexicon(data.entries as Record<string, LexiconRecord>);

/**
 * Replace the active lexicon with a larger dataset — the full
 * WordNet/Wiktionary set the core loads through the `lexicon` FFI (seam #9).
 * Ignored when `entries` is empty, so a missing/absent core leaves the bundled
 * sample in place (e.g. the web preview).
 */
export function setLexiconSource(entries: Record<string, LexiconRecord>): void {
  if (entries && Object.keys(entries).length > 0) {
    active = createLexicon(entries);
  }
}

/** Look up a word: definitions, synonyms, antonyms (or null if unknown). */
export const lookup = (word: string): LexiconEntry | null => active.lookup(word);
/** Offline dictionary: the definitions for a word. */
export const define = (word: string): string[] => active.define(word);
/** Thesaurus: synonyms for a word. */
export const synonyms = (word: string): string[] => active.synonyms(word);
/** Antonyms for a word. */
export const antonyms = (word: string): string[] => active.antonyms(word);
/** Whether the active lexicon knows the word. */
export const has = (word: string): boolean => active.has(word);
