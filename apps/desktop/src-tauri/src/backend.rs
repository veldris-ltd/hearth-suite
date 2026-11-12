//! The on-device inference backend wired into the desktop core.
//!
//! Hearth Suite's production inference runtime (local llama.cpp / GGUF) is
//! feature-gated in `ember-bridge` because it needs the native runtime and
//! downloaded model weights. Until a model is configured, the desktop client
//! uses this backend, which returns a single calm, *local* message, there is no
//! network path, preserving the offline-first guarantee.

use futures::stream;
use hearth_ember_bridge::{InferenceBackend, Prompt, TokenStream};

/// A backend used before the user has installed a local model.
pub struct UnconfiguredBackend;

impl InferenceBackend for UnconfiguredBackend {
    fn generate(&self, _prompt: &Prompt, _budget: usize) -> TokenStream {
        let message = "Ember isn't set up yet, add a local model in Settings to enable \
                       on-device help. Nothing you write ever leaves this device."
            .to_owned();
        Box::pin(stream::iter(vec![Ok(message)]))
    }
}
