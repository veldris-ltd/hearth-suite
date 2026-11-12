// Type declarations for the pure lexicon core (lexicon.mjs).

/** A resolved dictionary/thesaurus entry. */
export interface LexiconEntry {
  /** The base word the query resolved to (after normalising/stemming). */
  word: string;
  /** Part of speech, e.g. "noun", "verb", "adjective". */
  pos?: string;
  definitions: string[];
  synonyms: string[];
  antonyms: string[];
}

/** The stored shape of an entry (without the resolved `word`). */
export interface LexiconRecord {
  pos?: string;
  definitions: string[];
  synonyms?: string[];
  antonyms?: string[];
}

/** A local, synchronous dictionary + thesaurus. */
export interface Lexicon {
  lookup(word: string): LexiconEntry | null;
  define(word: string): string[];
  synonyms(word: string): string[];
  antonyms(word: string): string[];
  has(word: string): boolean;
  size: number;
}

export function normalize(word: string): string;
export function createLexicon(entries: Record<string, LexiconRecord>): Lexicon;
