//! Hardware detection and adaptive model tiering.

use sysinfo::System;

/// A snapshot of the device's inference-relevant capabilities.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HardwareProfile {
    /// Total system RAM, in megabytes.
    pub ram_mb: u64,
    /// Dedicated GPU VRAM, in megabytes (0 if unknown/none).
    pub vram_mb: u64,
    /// Whether a neural processing unit is present.
    pub has_npu: bool,
}

impl HardwareProfile {
    /// Detect the current device's profile.
    ///
    /// RAM is read from the OS; VRAM and NPU detection are platform-specific and
    /// reported best-effort (callers may override via [`select_tier`] inputs).
    pub fn detect() -> Self {
        let mut sys = System::new();
        sys.refresh_memory();
        let ram_mb = sys.total_memory() / (1024 * 1024);
        Self {
            ram_mb,
            vram_mb: 0,
            has_npu: false,
        }
    }
}

/// The selectable on-device model tiers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelTier {
    /// Phi-3-mini (quantised), the light tier for constrained hardware.
    Phi3Mini,
    /// Nemotron Nano, the capable tier (supports a thinking budget).
    NemotronNano,
}

impl ModelTier {
    /// A human-readable model name.
    pub fn name(self) -> &'static str {
        match self {
            Self::Phi3Mini => "Phi-3-mini (Q4)",
            Self::NemotronNano => "Nemotron Nano",
        }
    }

    /// A hint for the GGUF weights file to load.
    pub fn gguf_hint(self) -> &'static str {
        match self {
            Self::Phi3Mini => "phi-3-mini-4k-instruct-q4.gguf",
            Self::NemotronNano => "nemotron-nano.gguf",
        }
    }

    /// Whether this tier supports an explicit thinking budget.
    pub fn supports_thinking(self) -> bool {
        matches!(self, Self::NemotronNano)
    }

    /// A stable lower-case identifier for the tier (for the binding surface).
    pub fn id(self) -> &'static str {
        match self {
            Self::Phi3Mini => "phi3_mini",
            Self::NemotronNano => "nemotron_nano",
        }
    }

    /// The minimum system RAM (MB) this tier needs to run comfortably.
    ///
    /// Used by mobile clients to keep within memory constraints and to decide
    /// whether a heavier tier is even offerable on the device (`AC-MOB-2`).
    pub fn min_ram_mb(self) -> u64 {
        match self {
            // Phi-3-mini (Q4) is the smallest viable tier, the mobile default.
            Self::Phi3Mini => 4_000,
            Self::NemotronNano => CAPABLE_RAM_MB,
        }
    }

    /// Whether this is the default tier on memory-constrained mobile devices.
    ///
    /// Mobile defaults to the smallest viable Phi tier; heavier tiers are an
    /// explicit, Wi-Fi-gated opt-in download (`AC-MOB-2`).
    pub fn is_mobile_default(self) -> bool {
        matches!(self, Self::Phi3Mini)
    }

    /// Every selectable tier, smallest first.
    pub fn all() -> [ModelTier; 2] {
        [Self::Phi3Mini, Self::NemotronNano]
    }
}

/// RAM threshold (MB) at or above which the capable tier is selected.
const CAPABLE_RAM_MB: u64 = 16_000;
/// VRAM threshold (MB) at or above which the capable tier is selected.
const CAPABLE_VRAM_MB: u64 = 6_000;

/// Select a model tier for the given hardware profile.
///
/// Capable hardware (ample RAM, a sizable GPU, or an NPU) gets Nemotron Nano;
/// constrained hardware gets the lighter Phi tier (`AC-AI-2`).
pub fn select_tier(profile: &HardwareProfile) -> ModelTier {
    if profile.has_npu || profile.vram_mb >= CAPABLE_VRAM_MB || profile.ram_mb >= CAPABLE_RAM_MB {
        ModelTier::NemotronNano
    } else {
        ModelTier::Phi3Mini
    }
}
