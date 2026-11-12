//! Tasks, effort control, and prompt assembly.

use crate::hardware::ModelTier;
use crate::rag::Chunk;

/// System preamble that fixes Ember as a strictly on-device assistant.
const LOCAL_SYSTEM: &str =
    "You are Ember, Hearth Suite's on-device assistant. All processing happens \
locally on this device; no document content or telemetry is ever sent to any server.";

/// The kind of assistance requested.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Task {
    /// Draft new prose from the request.
    Draft,
    /// Summarise the document or selection.
    Summarize,
    /// Rewrite the selection.
    Rewrite,
    /// Continue writing from the document.
    Continue,
    /// Produce a spreadsheet formula and explanation.
    Formula,
    /// Answer a question over the provided context.
    Query,
}

impl Task {
    fn directive(self) -> &'static str {
        match self {
            Self::Draft => "Draft clear, relevant prose for the user's request.",
            Self::Summarize => "Summarise the document concisely.",
            Self::Rewrite => "Rewrite the selection as requested, preserving meaning.",
            Self::Continue => "Continue the document naturally from where it ends.",
            Self::Formula => {
                "Produce a single spreadsheet formula answering the request, then a one-line \
                 plain-language explanation."
            }
            Self::Query => "Answer the question using only the provided context.",
        }
    }
}

/// The user's Fast / Balanced / Thorough effort control.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Effort {
    /// Lowest latency, least depth.
    Fast,
    /// A balance of latency and depth (default).
    #[default]
    Balanced,
    /// Highest depth, most latency.
    Thorough,
}

impl Effort {
    /// The token / thinking budget for this effort level.
    ///
    /// On thinking-capable tiers (Nemotron) this maps to the thinking budget; on
    /// other tiers it caps generation length. Higher effort ⇒ larger budget ⇒
    /// more depth and latency (`AC-AI-3`).
    pub fn budget(self, tier: ModelTier) -> usize {
        let base = match self {
            Self::Fast => 128,
            Self::Balanced => 512,
            Self::Thorough => 2048,
        };
        // Thinking-capable tiers get a larger effective budget for the same control.
        if tier.supports_thinking() {
            base * 2
        } else {
            base
        }
    }
}

/// Inputs for an Ember request.
#[derive(Debug, Clone, Default)]
pub struct Context {
    /// The active document text (may be empty).
    pub document: String,
    /// The current selection, if any.
    pub selection: Option<String>,
    /// The user's natural-language request.
    pub request: String,
    /// Locally-retrieved passages (from [`Corpus`](crate::rag::Corpus)).
    pub retrieved: Vec<Chunk>,
}

impl Context {
    /// Create a context for a request, with no document or retrieval.
    pub fn new(request: impl Into<String>) -> Self {
        Self {
            request: request.into(),
            ..Self::default()
        }
    }

    /// Attach the active document text.
    #[must_use]
    pub fn with_document(mut self, document: impl Into<String>) -> Self {
        self.document = document.into();
        self
    }

    /// Attach the current selection.
    #[must_use]
    pub fn with_selection(mut self, selection: impl Into<String>) -> Self {
        self.selection = Some(selection.into());
        self
    }

    /// Attach locally-retrieved RAG passages.
    #[must_use]
    pub fn with_retrieved(mut self, retrieved: Vec<Chunk>) -> Self {
        self.retrieved = retrieved;
        self
    }
}

/// An assembled prompt ready for the inference backend.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Prompt {
    /// System instruction (role, constraints, task directive).
    pub system: String,
    /// User content (context + request).
    pub user: String,
}

/// Assemble a [`Prompt`] from a task and context.
pub(crate) fn assemble(task: Task, context: &Context) -> Prompt {
    let system = format!("{LOCAL_SYSTEM}\n{}", task.directive());

    let mut user = String::new();
    if !context.document.is_empty() {
        user.push_str("Document:\n");
        user.push_str(&context.document);
        user.push_str("\n\n");
    }
    if let Some(selection) = &context.selection {
        user.push_str("Selection:\n");
        user.push_str(selection);
        user.push_str("\n\n");
    }
    if !context.retrieved.is_empty() {
        user.push_str("Relevant context from your local corpus:\n");
        for chunk in &context.retrieved {
            user.push_str("- ");
            user.push_str(&chunk.text);
            user.push('\n');
        }
        user.push('\n');
    }
    user.push_str("Request: ");
    user.push_str(&context.request);

    Prompt { system, user }
}
