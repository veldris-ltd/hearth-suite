//! Recipient public-key exchange via contact card or QR code.
//!
//! A [`ContactCard`] is just the serialized public identity in a compact,
//! copy-pasteable form. Two users with no cloud connection can exchange cards
//! (shown as a QR code or copied as text) and then seal Bundles for each other
//! with no Key Directory involved (`AC-SEC-9`). The same bytes are what an
//! optional Key Directory would publish.

use hearth_seal::PublicIdentity;

use crate::error::{Error, Result};

/// A shareable public-identity payload (contact card / QR code).
#[derive(Clone, PartialEq, Eq)]
pub struct ContactCard {
    bytes: Vec<u8>,
}

impl ContactCard {
    /// Build a contact card from a public identity.
    pub fn from_public(public: &PublicIdentity) -> Self {
        Self {
            bytes: public.to_bytes(),
        }
    }

    /// The raw card bytes (e.g. to encode directly into a QR code).
    pub fn as_bytes(&self) -> &[u8] {
        &self.bytes
    }

    /// Encode the card as a hex string for display or copy-paste.
    pub fn to_hex(&self) -> String {
        hex::encode(&self.bytes)
    }

    /// Parse a card from a hex string.
    ///
    /// # Errors
    /// Returns an error if the string is not valid hex.
    pub fn from_hex(s: &str) -> Result<Self> {
        let bytes = hex::decode(s.trim()).map_err(|e| Error::Contact(e.to_string()))?;
        Ok(Self { bytes })
    }

    /// Parse a card from raw bytes (e.g. decoded from a QR code).
    pub fn from_bytes(bytes: impl Into<Vec<u8>>) -> Self {
        Self {
            bytes: bytes.into(),
        }
    }

    /// Recover the recipient's public identity, ready to seal to.
    ///
    /// # Errors
    /// Returns an error if the card does not contain a valid public identity.
    pub fn public_identity(&self) -> Result<PublicIdentity> {
        PublicIdentity::from_bytes(&self.bytes).map_err(Into::into)
    }
}
