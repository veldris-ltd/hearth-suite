//! Offline dictionary + thesaurus lexicon — the production side of seam #9.
//!
//! A lexicon is a lookup over an in-memory entry map. This crate embeds the same
//! CC0 starter sample the `@hearth/lexicon` package bundles (single source of
//! truth via `include_str!`), so the core can serve the dataset to the client
//! through the `lexicon_dataset` FFI. A production build swaps the embedded file
//! for the full WordNet/Wiktionary dataset (licence-checked) behind the
//! identical shape — no surface change. The normalise + stemming rules mirror
//! the JS core (`packages/lexicon/src/lexicon.mjs`) so both sides resolve a word
//! to the same base.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// The bundled CC0 sample dataset — the JS package's `data.json`, referenced
/// directly so there is exactly one source of truth for the sample.
const SAMPLE: &str = include_str!("../../../packages/lexicon/src/data.json");

/// A stored entry (mirrors the JS `LexiconRecord`): an entry without its
/// resolved key word.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LexiconRecord {
    /// Part of speech, e.g. `"noun"`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pos: Option<String>,
    /// Definitions, most common first.
    #[serde(default)]
    pub definitions: Vec<String>,
    /// Thesaurus synonyms.
    #[serde(default)]
    pub synonyms: Vec<String>,
    /// Antonyms / opposites.
    #[serde(default)]
    pub antonyms: Vec<String>,
}

/// A resolved lookup result (mirrors the JS `LexiconEntry`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LexiconEntry {
    /// The base word the query resolved to (after normalise/stem).
    pub word: String,
    /// Part of speech, if known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pos: Option<String>,
    /// Definitions.
    pub definitions: Vec<String>,
    /// Synonyms.
    pub synonyms: Vec<String>,
    /// Antonyms.
    pub antonyms: Vec<String>,
}

#[derive(Deserialize)]
struct Dataset {
    #[serde(default)]
    entries: BTreeMap<String, LexiconRecord>,
}

// Cheap morphological fallbacks so "running"/"calmer"/"boxes" find their base —
// the same ordered rules as `lexicon.mjs`.
const SUFFIX_RULES: &[(&str, &str)] = &[
    ("ies", "y"),
    ("ing", "e"),
    ("ing", ""),
    ("ed", "e"),
    ("ed", ""),
    ("es", ""),
    ("er", ""),
    ("est", ""),
    ("ly", ""),
    ("s", ""),
];

/// Normalise a query to a lookup key: lowercase, trimmed, `[a-z'-]` only.
#[must_use]
pub fn normalize(word: &str) -> String {
    word.trim()
        .to_lowercase()
        .chars()
        .filter(|c| matches!(c, 'a'..='z' | '\'' | '-'))
        .collect()
}

/// A local, synchronous dictionary + thesaurus over an entry map.
pub struct Lexicon {
    map: BTreeMap<String, LexiconRecord>,
}

impl Lexicon {
    /// Build a lexicon over an entry map.
    #[must_use]
    pub fn from_entries(map: BTreeMap<String, LexiconRecord>) -> Self {
        Self { map }
    }

    /// Parse a dataset document (`{ "entries": { word: record, ... } }`).
    ///
    /// # Errors
    /// Returns a serde error if the JSON is malformed.
    pub fn from_json(json: &str) -> Result<Self, serde_json::Error> {
        let dataset: Dataset = serde_json::from_str(json)?;
        Ok(Self {
            map: dataset.entries,
        })
    }

    /// The bundled CC0 sample lexicon (the offline fallback / shape contract).
    #[must_use]
    pub fn sample() -> Self {
        // The sample is checked in, so parsing cannot fail in practice; fall back
        // to an empty lexicon rather than panicking if it somehow does.
        Self::from_json(SAMPLE).unwrap_or_else(|_| Self {
            map: BTreeMap::new(),
        })
    }

    /// The number of stored entries.
    #[must_use]
    pub fn len(&self) -> usize {
        self.map.len()
    }

    /// Whether the lexicon has no entries.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }

    /// The stored entry map (for the `lexicon_dataset` FFI bulk-load).
    #[must_use]
    pub fn entries(&self) -> &BTreeMap<String, LexiconRecord> {
        &self.map
    }

    /// Look up a word: direct hit, else a stemmed base form, else `None`.
    #[must_use]
    pub fn lookup(&self, word: &str) -> Option<LexiconEntry> {
        let key = normalize(word);
        if key.is_empty() {
            return None;
        }
        if let Some(record) = self.map.get(&key) {
            return Some(resolve(&key, record));
        }
        for (suffix, replacement) in SUFFIX_RULES {
            if key.len() > suffix.len() + 1 && key.ends_with(suffix) {
                let base = format!("{}{replacement}", &key[..key.len() - suffix.len()]);
                if let Some(record) = self.map.get(&base) {
                    return Some(resolve(&base, record));
                }
            }
        }
        None
    }
}

fn resolve(word: &str, record: &LexiconRecord) -> LexiconEntry {
    LexiconEntry {
        word: word.to_owned(),
        pos: record.pos.clone(),
        definitions: record.definitions.clone(),
        synonyms: record.synonyms.clone(),
        antonyms: record.antonyms.clone(),
    }
}

#[cfg(test)]
mod tests {
    //! Mirrors `packages/lexicon/tests/lexicon.test.mjs` against the Rust core,
    //! so both sides of seam #9 resolve words identically.

    use super::*;

    #[test]
    fn bundled_sample_loads_with_a_stated_provenance() {
        let lex = Lexicon::sample();
        assert!(
            lex.len() >= 30,
            "sample has a usable size, got {}",
            lex.len()
        );
        assert!(SAMPLE.contains("CC0"));
        assert!(SAMPLE.contains("WordNet") || SAMPLE.contains("FFI"));
    }

    #[test]
    fn dictionary_lookup_returns_definitions() {
        let lex = Lexicon::sample();
        let entry = lex.lookup("calm").expect("calm is in the sample");
        assert_eq!(entry.word, "calm");
        assert_ne!(entry.definitions, Vec::<String>::new());
        assert!(
            entry.definitions[0].to_lowercase().contains("peaceful")
                || entry.definitions[0].to_lowercase().contains("disturbance")
        );
    }

    #[test]
    fn thesaurus_returns_synonyms_and_antonyms() {
        let lex = Lexicon::sample();
        assert!(lex
            .lookup("warm")
            .unwrap()
            .synonyms
            .contains(&"cosy".to_owned()));
        assert!(lex
            .lookup("warm")
            .unwrap()
            .antonyms
            .contains(&"cold".to_owned()));
    }

    #[test]
    fn morphological_fallback_resolves_inflected_forms() {
        let lex = Lexicon::sample();
        assert_eq!(lex.lookup("calmly").unwrap().word, "calm");
        assert_eq!(lex.lookup("writing").unwrap().word, "write");
        assert_eq!(lex.lookup("helps").unwrap().word, "help");
    }

    #[test]
    fn unknown_words_resolve_to_none_never_panic() {
        let lex = Lexicon::sample();
        assert!(lex.lookup("zzqx").is_none());
        assert!(lex.lookup("").is_none());
        assert!(lex.lookup("   ").is_none());
    }

    #[test]
    fn from_json_is_the_injectable_seam() {
        let custom = Lexicon::from_json(
            r#"{ "entries": { "ember": { "pos": "noun", "definitions": ["A glowing coal."], "synonyms": ["coal", "cinder"] } } }"#,
        )
        .expect("parse");
        assert_eq!(
            custom.lookup("ember").unwrap().definitions[0],
            "A glowing coal."
        );
        assert!(custom
            .lookup("embers")
            .unwrap()
            .synonyms
            .contains(&"cinder".to_owned())); // stemmed
        assert!(custom.lookup("calm").is_none()); // isolated from the sample
    }
}
