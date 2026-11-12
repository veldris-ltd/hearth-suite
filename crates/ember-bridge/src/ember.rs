//! The Ember orchestrator: the clean async API the UI calls.

use crate::backend::{Generation, InferenceBackend};
use crate::hardware::{select_tier, HardwareProfile, ModelTier};
use crate::prompt::{assemble, Context, Effort, Task};

/// On-device AI orchestrator over a chosen [`InferenceBackend`].
pub struct Ember<B: InferenceBackend> {
    backend: B,
    tier: ModelTier,
}

impl<B: InferenceBackend> Ember<B> {
    /// Create an orchestrator, auto-selecting the model tier for this device.
    pub fn new(backend: B) -> Self {
        Self {
            backend,
            tier: select_tier(&HardwareProfile::detect()),
        }
    }

    /// Create an orchestrator with a manually-chosen tier (override, `AC-AI-2`).
    pub fn with_tier(backend: B, tier: ModelTier) -> Self {
        Self { backend, tier }
    }

    /// The model tier in use.
    pub fn model(&self) -> ModelTier {
        self.tier
    }

    /// Run an Ember request, returning a streaming [`Generation`].
    ///
    /// This is the UI-facing entry point: `run(task, context, effort)` assembles
    /// the prompt, applies the effort budget, and streams tokens from the local
    /// backend. No content leaves the device.
    pub fn run(&self, task: Task, context: &Context, effort: Effort) -> Generation {
        let prompt = assemble(task, context);
        let budget = effort.budget(self.tier);
        let stream = self.backend.generate(&prompt, budget);
        Generation::new(self.tier, stream)
    }
}
