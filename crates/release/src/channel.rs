//! Release channels (AC-REL-1).
//!
//! The release service publishes TUF-signed targets metadata per channel. A
//! client fetches the metadata for its channel and verifies it against the same
//! pinned roots ([`crate::TrustedRoots`]); the channel is purely a routing label
//! over independently-signed metadata.

use serde::{Deserialize, Serialize};

/// A release distribution channel.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Channel {
    /// Pre-release / testing.
    Beta,
    /// General availability.
    Stable,
}

impl Channel {
    /// The stable string form (also the metadata path segment).
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Beta => "beta",
            Self::Stable => "stable",
        }
    }

    /// Parse a channel from its string form.
    #[must_use]
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "beta" => Some(Self::Beta),
            "stable" => Some(Self::Stable),
            _ => None,
        }
    }

    /// Every channel.
    #[must_use]
    pub fn all() -> [Channel; 2] {
        [Self::Beta, Self::Stable]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips() {
        for c in Channel::all() {
            assert_eq!(Channel::parse(c.as_str()), Some(c));
        }
        assert_eq!(Channel::parse("nightly"), None);
        assert_ne!(Channel::Beta, Channel::Stable);
    }
}
