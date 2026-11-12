//! Telemetry policy (AC-OBS-1).
//!
//! Clients are local-first and **emit nothing by default**. Any client telemetry
//! is strictly opt-in, and even then only aggregate, content-free counters. The
//! cloud services run [`TelemetryPolicy::AggregateOptIn`] by deployment choice;
//! the *default*, the value a fresh client holds, is always [`TelemetryPolicy::Off`].

use serde::{Deserialize, Serialize};

/// Whether and how telemetry may be emitted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum TelemetryPolicy {
    /// No telemetry at all. The default for every client (AC-OBS-1).
    #[default]
    Off,
    /// Aggregate, content-free counters only, requires explicit opt-in.
    AggregateOptIn,
}

impl TelemetryPolicy {
    /// Whether any telemetry may be emitted under this policy.
    #[must_use]
    pub fn emits(self) -> bool {
        matches!(self, Self::AggregateOptIn)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clients_are_silent_by_default() {
        assert_eq!(TelemetryPolicy::default(), TelemetryPolicy::Off);
        assert!(!TelemetryPolicy::default().emits());
    }

    #[test]
    fn opt_in_emits() {
        assert!(TelemetryPolicy::AggregateOptIn.emits());
    }
}
