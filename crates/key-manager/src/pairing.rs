//! Device pairing.
//!
//! Pairing registers an additional device under a single identity, producing a
//! `DEVICE` row. A short [`PairingCode`] is shown on one device and entered on
//! another to authorize the link; on success a [`Device`] record is created.

use std::time::{SystemTime, UNIX_EPOCH};

use hearth_seal::IdentityId;
use uuid::Uuid;

use crate::error::{Error, Result};

/// A paired device record (`DEVICE` in the ER model).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Device {
    /// Stable device id.
    pub id: Uuid,
    /// The identity this device belongs to.
    pub identity_id: Uuid,
    /// Platform label (e.g. `"windows"`, `"android"`).
    pub platform: String,
    /// Pairing time, seconds since the Unix epoch.
    pub paired_at: u64,
}

impl Device {
    /// Pair a new device to an identity, creating its `DEVICE` record.
    pub fn pair(identity: IdentityId, platform: impl Into<String>) -> Self {
        Self {
            id: Uuid::new_v4(),
            identity_id: Uuid::from_bytes(identity),
            platform: platform.into(),
            paired_at: now_unix(),
        }
    }
}

/// A short, single-use pairing code shown on one device and entered on another.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PairingCode([u8; 5]);

impl PairingCode {
    /// Generate a fresh random pairing code.
    ///
    /// # Errors
    /// Returns an error if the system RNG fails.
    pub fn generate() -> Result<Self> {
        let mut bytes = [0u8; 5];
        getrandom::fill(&mut bytes).map_err(|e| Error::Crypto(format!("rng: {e}")))?;
        Ok(Self(bytes))
    }

    /// The code rendered as a 10-character uppercase hex string for display.
    pub fn display(&self) -> String {
        hex::encode_upper(self.0)
    }

    /// Whether a user-entered string matches this code (case-insensitive).
    pub fn matches(&self, entered: &str) -> bool {
        hex::decode(entered.trim()).is_ok_and(|b| b == self.0)
    }

    /// Complete pairing: if `entered` matches, create the device record.
    ///
    /// # Errors
    /// Returns an error if the entered code does not match.
    pub fn accept(&self, entered: &str, identity: IdentityId, platform: &str) -> Result<Device> {
        if self.matches(entered) {
            Ok(Device::pair(identity, platform))
        } else {
            Err(Error::Crypto("pairing code mismatch".to_owned()))
        }
    }
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}
