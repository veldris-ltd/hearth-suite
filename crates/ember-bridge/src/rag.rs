//! Optional local retrieval-augmented generation over the user's own corpus.
//!
//! Both indexing and retrieval run entirely on-device against documents the
//! user already has; nothing is embedded or queried over the network
//! (`AC-AI-6`). Scoring is a simple local term-frequency overlap, adequate to
//! surface relevant passages without any external service.

use std::collections::HashMap;

/// A retrieved passage with its relevance score.
#[derive(Debug, Clone, PartialEq)]
pub struct Chunk {
    /// Identifier of the source document.
    pub id: String,
    /// The passage text.
    pub text: String,
    /// Relevance score (higher is more relevant).
    pub score: f32,
}

/// An in-memory, on-device corpus of the user's documents.
#[derive(Debug, Default)]
pub struct Corpus {
    documents: Vec<(String, String)>,
}

impl Corpus {
    /// Create an empty corpus.
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a document (by id and text) to the corpus.
    pub fn add(&mut self, id: impl Into<String>, text: impl Into<String>) {
        self.documents.push((id.into(), text.into()));
    }

    /// The number of indexed documents.
    pub fn len(&self) -> usize {
        self.documents.len()
    }

    /// Whether the corpus is empty.
    pub fn is_empty(&self) -> bool {
        self.documents.is_empty()
    }

    /// Retrieve the top-`k` most relevant passages for `query`, on-device.
    pub fn retrieve(&self, query: &str, k: usize) -> Vec<Chunk> {
        let terms = tokenize(query);
        let mut scored: Vec<Chunk> = self
            .documents
            .iter()
            .map(|(id, text)| Chunk {
                id: id.clone(),
                text: text.clone(),
                score: score(&terms, text),
            })
            .filter(|c| c.score > 0.0)
            .collect();
        // Sort by score descending; ties broken by id for determinism.
        scored.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(a.id.cmp(&b.id))
        });
        scored.truncate(k);
        scored
    }
}

fn tokenize(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(str::to_lowercase)
        .collect()
}

/// Score a document by how many query terms it contains (term frequency).
fn score(query_terms: &[String], document: &str) -> f32 {
    let mut counts: HashMap<String, u32> = HashMap::new();
    for term in tokenize(document) {
        *counts.entry(term).or_insert(0) += 1;
    }
    query_terms
        .iter()
        .map(|t| f32::from(u16::try_from(*counts.get(t).unwrap_or(&0)).unwrap_or(0)))
        .sum()
}
