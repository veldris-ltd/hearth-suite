//! An in-memory inference backend for tests and examples.
//!
//! It performs no I/O of any kind, useful for exercising the orchestration
//! (tiering, prompt assembly, effort, streaming, RAG) without a model or any
//! network. It also records the last prompt it received, so tests can confirm
//! that content was handed only to the local backend.

use std::sync::Mutex;

use futures::stream;

use crate::backend::{InferenceBackend, TokenStream};
use crate::prompt::Prompt;

/// A deterministic, in-memory backend.
pub struct MockBackend {
    reply: String,
    scale_with_budget: bool,
    last_prompt: Mutex<String>,
}

impl MockBackend {
    /// A backend that streams a fixed `reply` (split into word tokens).
    pub fn canned(reply: impl Into<String>) -> Self {
        Self {
            reply: reply.into(),
            scale_with_budget: false,
            last_prompt: Mutex::new(String::new()),
        }
    }

    /// A backend whose output length scales with the effort budget, for testing
    /// that higher effort yields a longer/deeper response.
    pub fn budget_scaled() -> Self {
        Self {
            reply: String::new(),
            scale_with_budget: true,
            last_prompt: Mutex::new(String::new()),
        }
    }

    /// The full prompt (system + user) most recently passed to `generate`.
    pub fn last_prompt(&self) -> String {
        self.last_prompt
            .lock()
            .map(|g| g.clone())
            .unwrap_or_default()
    }
}

impl InferenceBackend for MockBackend {
    fn generate(&self, prompt: &Prompt, budget: usize) -> TokenStream {
        if let Ok(mut last) = self.last_prompt.lock() {
            *last = format!("{}\n{}", prompt.system, prompt.user);
        }

        let tokens: Vec<crate::error::Result<String>> = if self.scale_with_budget {
            let count = (budget / 128).max(1);
            (0..count).map(|i| Ok(format!("t{i} "))).collect()
        } else {
            self.reply
                .split_inclusive(' ')
                .map(|w| Ok(w.to_owned()))
                .collect()
        };

        Box::pin(stream::iter(tokens))
    }
}
