//! Human-readable recovery phrases (BIP-39).
//!
//! A recovery phrase encodes the 32-byte master identity seed as 24 words. It
//! is the user-facing backup: restoring from it on a clean install recovers the
//! identity and access to that user's sealed Bundles (`AC-SEC-7`).

use bip39::Mnemonic;

use crate::error::{Error, Result};

/// A BIP-39 recovery phrase (24 words for a 32-byte seed).
#[derive(Clone)]
pub struct RecoveryPhrase(String);

impl RecoveryPhrase {
    /// Encode a 32-byte master seed as a recovery phrase.
    ///
    /// # Errors
    /// Returns [`Error::Phrase`] if the seed cannot be encoded as a mnemonic.
    pub fn from_seed(seed: &[u8; 32]) -> Result<Self> {
        let mnemonic = Mnemonic::from_entropy(seed).map_err(|e| Error::Phrase(e.to_string()))?;
        Ok(Self(mnemonic.to_string()))
    }

    /// Parse and validate a recovery phrase supplied by the user.
    ///
    /// # Errors
    /// Returns an error if the phrase is not a valid BIP-39 mnemonic.
    pub fn parse(phrase: &str) -> Result<Self> {
        Mnemonic::parse(phrase).map_err(|e| Error::Phrase(e.to_string()))?;
        Ok(Self(phrase.trim().to_owned()))
    }

    /// Recover the 32-byte master seed from this phrase.
    ///
    /// # Errors
    /// Returns [`Error::Phrase`] if the phrase is not a valid mnemonic or does
    /// not encode exactly 32 bytes of entropy.
    pub fn to_seed(&self) -> Result<[u8; 32]> {
        let mnemonic = Mnemonic::parse(&self.0).map_err(|e| Error::Phrase(e.to_string()))?;
        mnemonic
            .to_entropy()
            .try_into()
            .map_err(|_| Error::Phrase("phrase does not encode a 32-byte seed".to_owned()))
    }

    /// The phrase as a space-separated string of words.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The number of words in the phrase.
    pub fn word_count(&self) -> usize {
        self.0.split_whitespace().count()
    }
}
