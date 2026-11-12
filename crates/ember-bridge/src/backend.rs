//! The inference backend abstraction and streaming result type.
//!
//! The orchestrator talks only to an [`InferenceBackend`]. The production
//! backend wraps a local llama.cpp/GGUF runtime (feature-gated, since it needs
//! the native runtime and model weights); tests and examples use the in-memory
//! [`MockBackend`](crate::testing::MockBackend). Either way, the backend is the
//! sole boundary, there is no network path.

use std::pin::Pin;

use futures::Stream;

use crate::error::Result;
use crate::hardware::ModelTier;
use crate::prompt::Prompt;

/// A stream of generated text tokens.
pub type TokenStream = Pin<Box<dyn Stream<Item = Result<String>> + Send>>;

/// A local inference backend.
pub trait InferenceBackend: Send + Sync {
    /// Stream a completion for `prompt` under a token/thinking `budget`.
    fn generate(&self, prompt: &Prompt, budget: usize) -> TokenStream;
}

/// Allows sharing a backend (e.g. to inspect it after handing it to `Ember`).
impl<B: InferenceBackend + ?Sized> InferenceBackend for std::sync::Arc<B> {
    fn generate(&self, prompt: &Prompt, budget: usize) -> TokenStream {
        (**self).generate(prompt, budget)
    }
}

/// Allows holding a backend behind a `Box`, e.g. `Ember<Box<dyn InferenceBackend>>`.
impl<B: InferenceBackend + ?Sized> InferenceBackend for Box<B> {
    fn generate(&self, prompt: &Prompt, budget: usize) -> TokenStream {
        (**self).generate(prompt, budget)
    }
}

/// A running generation: streamed tokens plus device-local metadata.
pub struct Generation {
    model: ModelTier,
    device_local: bool,
    stream: TokenStream,
}

impl Generation {
    pub(crate) fn new(model: ModelTier, stream: TokenStream) -> Self {
        // There is no cloud path: every generation is device-local.
        Self {
            model,
            device_local: true,
            stream,
        }
    }

    /// The model tier that produced this generation.
    pub fn model(&self) -> ModelTier {
        self.model
    }

    /// Whether this generation ran entirely on-device (always true).
    ///
    /// The UI uses this to label completions as device-local (`AC-AI-4`).
    pub fn is_device_local(&self) -> bool {
        self.device_local
    }

    /// Consume the generation, yielding its token stream.
    pub fn into_stream(self) -> TokenStream {
        self.stream
    }

    /// Collect the full completion into a string.
    ///
    /// # Errors
    /// Returns an error if the backend yields one mid-stream.
    pub async fn collect_text(self) -> Result<String> {
        use futures::StreamExt;
        let mut stream = self.stream;
        let mut out = String::new();
        while let Some(token) = stream.next().await {
            out.push_str(&token?);
        }
        Ok(out)
    }
}
