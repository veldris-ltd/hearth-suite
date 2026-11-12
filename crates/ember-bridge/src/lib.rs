//! Ember bridge, on-device AI for Hearth Suite.
//!
//! Orchestrates local inference (via a llama.cpp/GGUF backend in production)
//! behind a clean async API: `ember.run(task, context, effort)` returns a
//! streaming [`Generation`]. It provides:
//!
//! - **Adaptive model tiering** ([`select_tier`]), Phi-3-mini on constrained
//!   hardware, Nemotron Nano on capable hardware, with a manual override
//!   ([`Ember::with_tier`]) (`AC-AI-2`).
//! - **Prompt assembly** for Writer/Sheets/query [`Task`]s (`AC-AI-4`, `AC-AI-5`).
//! - **Fast/Balanced/Thorough** [`Effort`] mapped to a thinking/token budget
//!   (`AC-AI-3`).
//! - **Optional local RAG** over the user's own [`Corpus`](rag::Corpus)
//!   (`AC-AI-6`).
//! - **Streaming** results via [`TokenStream`].
//!
//! **No document content or telemetry ever leaves the device.** The crate links
//! no networking dependencies; the [`InferenceBackend`] trait is the only
//! boundary, and the production backend runs locally (`AC-AI-1`).
//!
//! ```
//! use futures::executor::block_on;
//! use hearth_ember_bridge::{Context, Effort, Ember, ModelTier, Task};
//! use hearth_ember_bridge::testing::MockBackend;
//!
//! let ember = Ember::with_tier(MockBackend::canned("Hello, locally."), ModelTier::Phi3Mini);
//! let gen = ember.run(Task::Draft, &Context::new("greet the user"), Effort::Fast);
//! assert!(gen.is_device_local());
//! let text = block_on(gen.collect_text()).unwrap();
//! assert!(text.contains("locally"));
//! ```
//!
//! Implemented for P1.7 (`AC-AI-1..6`).

pub mod backend;
pub mod error;
pub mod hardware;
pub mod prompt;
pub mod rag;
pub mod testing;

mod ember;

pub use backend::{Generation, InferenceBackend, TokenStream};
pub use ember::Ember;
pub use error::{Error, Result};
pub use hardware::{select_tier, HardwareProfile, ModelTier};
pub use prompt::{Context, Effort, Prompt, Task};
pub use rag::{Chunk, Corpus};
